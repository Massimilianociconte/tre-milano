import { access, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  applicableWidths,
  loadResponsiveConfig,
  projectRoot,
  publicFile,
  sha256File,
  variantPublicPath,
  versionDirectory,
} from './responsive-images-lib.mjs';

const config = await loadResponsiveConfig();
const outputDirectory = versionDirectory(config);
const manifestPath = path.join(outputDirectory, 'manifest.json');
const checkDist = process.argv.includes('--dist');
const failures = [];
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

if (manifest.schemaVersion !== config.schemaVersion) failures.push('schemaVersion manifest non coerente');
if (manifest.assetVersion !== config.assetVersion) failures.push('assetVersion manifest non coerente');
if (!/^[a-f0-9]{64}$/.test(manifest.generationFingerprint ?? '')) failures.push('fingerprint manifest assente o non valido');

const ids = config.images.map(({ id }) => id);
if (new Set(ids).size !== ids.length) failures.push('ID asset duplicati nella configurazione');
if (config.targetWidths.some((width, index) => index > 0 && width <= config.targetWidths[index - 1])) {
  failures.push('targetWidths non strettamente crescenti');
}

const manifestById = new Map((manifest.images ?? []).map((image) => [image.id, image]));
const expectedFilenames = new Set(['manifest.json']);

for (const image of config.images) {
  const sourceFile = publicFile(image.source);
  const sourceMetadata = await sharp(sourceFile).metadata();
  const sourceSha256 = await sha256File(sourceFile);
  if (sourceMetadata.width !== image.width || sourceMetadata.height !== image.height) {
    failures.push(`${image.id}: metadati sorgente divergenti`);
  }
  const record = manifestById.get(image.id);
  if (!record) {
    failures.push(`${image.id}: voce manifest mancante`);
    continue;
  }
  if (record.sourceSha256 !== sourceSha256) failures.push(`${image.id}: hash sorgente obsoleto`);
  if (record.sourceWidth !== image.width || record.sourceHeight !== image.height) failures.push(`${image.id}: dimensioni sorgente manifest errate`);

  const expected = new Set();
  for (const width of applicableWidths(config, image)) {
    for (const format of Object.keys(config.formats)) expected.add(`${width}:${format}`);
  }
  const actual = new Set();
  for (const variant of record.variants ?? []) {
    const key = `${variant.width}:${variant.format}`;
    if (actual.has(key)) failures.push(`${image.id}: variante duplicata ${key}`);
    actual.add(key);
    if (variant.width > image.width) failures.push(`${image.id}: upscale rilevato a ${variant.width}px`);
    const expectedPath = variantPublicPath(config, image, variant.width, variant.format);
    if (variant.path !== expectedPath) failures.push(`${image.id}: path non canonico ${variant.path}`);
    const file = publicFile(variant.path);
    expectedFilenames.add(path.basename(file));
    let metadata;
    try {
      metadata = await sharp(file).metadata();
    } catch {
      failures.push(`${image.id}: file illeggibile ${variant.path}`);
      continue;
    }
    const expectedFormat = variant.format === 'avif' ? 'heif' : variant.format;
    if (metadata.format !== expectedFormat) failures.push(`${variant.path}: formato ${metadata.format}, atteso ${expectedFormat}`);
    if (metadata.width !== variant.width || metadata.height !== variant.height) failures.push(`${variant.path}: dimensioni file divergenti`);
    const fileStat = await stat(file);
    if (fileStat.size !== variant.bytes) failures.push(`${variant.path}: byte size divergente`);
    if (await sha256File(file) !== variant.sha256) failures.push(`${variant.path}: hash divergente`);
    if (checkDist) {
      const distFile = path.join(projectRoot, 'dist', variant.path.replace(/^\/+/, ''));
      try {
        await access(distFile);
        if (await sha256File(distFile) !== variant.sha256) failures.push(`${variant.path}: copia dist divergente`);
      } catch {
        failures.push(`${variant.path}: copia dist assente`);
      }
    }
  }
  for (const key of expected) if (!actual.has(key)) failures.push(`${image.id}: variante mancante ${key}`);
  for (const key of actual) if (!expected.has(key)) failures.push(`${image.id}: variante inattesa ${key}`);
  manifestById.delete(image.id);
}

for (const id of manifestById.keys()) failures.push(`${id}: asset manifest non configurato`);
for (const filename of await readdir(outputDirectory)) {
  if (!expectedFilenames.has(filename)) failures.push(`file responsive inatteso ${filename}`);
}

if (failures.length) {
  console.error(`Audit responsive media fallito (${failures.length}):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

const variantCount = manifest.images.reduce((total, image) => total + image.variants.length, 0);
console.log(`Audit responsive media: ${manifest.images.length} sorgenti, ${variantCount} varianti, nessun upscale${checkDist ? ', copie dist verificate' : ''}.`);
