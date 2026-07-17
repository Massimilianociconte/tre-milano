import { access, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  applicableWidths,
  loadResponsiveConfig,
  projectRoot,
  publicFile,
  sha256File,
  sha256Text,
  stableJson,
  variantPublicPath,
  versionDirectory,
} from './responsive-images-lib.mjs';

const config = await loadResponsiveConfig();
const outputDirectory = versionDirectory(config);
const manifestFile = path.join(outputDirectory, 'manifest.json');

const sources = [];
for (const image of config.images) {
  const sourceFile = publicFile(image.source);
  const metadata = await sharp(sourceFile).metadata();
  if (metadata.width !== image.width || metadata.height !== image.height) {
    throw new Error(`${image.id}: dimensioni sorgente ${metadata.width}x${metadata.height}, attese ${image.width}x${image.height}.`);
  }
  sources.push({
    ...image,
    sourceFile,
    sourceSha256: await sha256File(sourceFile),
  });
}

const generationFingerprint = sha256Text(stableJson({
  schemaVersion: config.schemaVersion,
  assetVersion: config.assetVersion,
  targetWidths: config.targetWidths,
  formats: config.formats,
  sharpVersion: sharp.versions.sharp,
  sources: sources.map(({ id, source, sourceSha256, width, height }) => ({ id, source, sourceSha256, width, height })),
}));

async function manifestIsCurrent() {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  } catch {
    return false;
  }
  if (manifest.generationFingerprint !== generationFingerprint) return false;
  for (const image of manifest.images ?? []) {
    for (const variant of image.variants ?? []) {
      const file = publicFile(variant.path);
      try {
        await access(file);
        if (await sha256File(file) !== variant.sha256) return false;
      } catch {
        return false;
      }
    }
  }
  return true;
}

await mkdir(outputDirectory, { recursive: true });
if (await manifestIsCurrent()) {
  console.log(`Responsive media ${config.assetVersion}: già aggiornati (${generationFingerprint.slice(0, 12)}).`);
  process.exit(0);
}

const manifestImages = [];
const expectedFiles = new Set(['manifest.json']);

for (const image of sources) {
  const variants = [];
  for (const width of applicableWidths(config, image)) {
    const pipeline = sharp(image.sourceFile)
      .rotate()
      .resize({ width, withoutEnlargement: true, fit: 'inside' })
      .toColourspace('srgb');
    const encoders = {
      avif: pipeline.clone().avif(config.formats.avif),
      webp: pipeline.clone().webp(config.formats.webp),
    };
    const encoded = await Promise.all(Object.entries(encoders).map(async ([format, encoder]) => {
      const { data, info } = await encoder.toBuffer({ resolveWithObject: true });
      const publicPath = variantPublicPath(config, image, width, format);
      const filename = path.basename(publicPath);
      await writeFile(path.join(outputDirectory, filename), data);
      expectedFiles.add(filename);
      return {
        format,
        width: info.width,
        height: info.height,
        path: publicPath,
        bytes: info.size,
        sha256: sha256Text(data),
      };
    }));
    variants.push(...encoded.sort((left, right) => left.format.localeCompare(right.format)));
  }
  manifestImages.push({
    id: image.id,
    source: image.source,
    aliases: image.aliases,
    sourceWidth: image.width,
    sourceHeight: image.height,
    sourceSha256: image.sourceSha256,
    variants,
  });
}

const manifest = {
  schemaVersion: config.schemaVersion,
  assetVersion: config.assetVersion,
  generator: 'scripts/generate-responsive-images.mjs',
  generatorVersion: 1,
  sharpVersion: sharp.versions.sharp,
  generationFingerprint,
  targetWidths: config.targetWidths,
  formats: Object.keys(config.formats),
  images: manifestImages,
};

await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

for (const filename of await readdir(outputDirectory)) {
  if (!expectedFiles.has(filename)) await unlink(path.join(outputDirectory, filename));
}

const variantCount = manifestImages.reduce((total, image) => total + image.variants.length, 0);
const relativeOutput = path.relative(projectRoot, outputDirectory);
console.log(`Responsive media ${config.assetVersion}: generati ${variantCount} file in ${relativeOutput}.`);
