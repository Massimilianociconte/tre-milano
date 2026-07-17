import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

function parseEnv(source) {
  const values = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function loadPublicEnv(projectRoot, mode = 'production') {
  const values = {};
  for (const filename of ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`]) {
    const filepath = path.join(projectRoot, filename);
    if (existsSync(filepath)) Object.assign(values, parseEnv(readFileSync(filepath, 'utf8')));
  }
  return { ...values, ...process.env };
}
