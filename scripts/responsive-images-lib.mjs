import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const configPath = path.join(projectRoot, 'src/config/responsive-images.json');

export async function loadResponsiveConfig() {
  return JSON.parse(await readFile(configPath, 'utf8'));
}

export function publicFile(publicPath) {
  return path.join(projectRoot, 'public', publicPath.replace(/^\/+/, ''));
}

export function versionDirectory(config, root = path.join(projectRoot, 'public')) {
  return path.join(root, 'images', 'responsive', config.assetVersion);
}

export function variantPublicPath(config, image, width, format) {
  return `/images/responsive/${config.assetVersion}/${image.id}-${width}.${format}`;
}

export function applicableWidths(config, image) {
  return config.targetWidths.filter((width) => width <= image.width);
}

export async function sha256File(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex');
}
