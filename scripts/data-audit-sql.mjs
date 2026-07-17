import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

function findMatchingParen(sql, openingIndex) {
  let depth = 0;
  let quote = null;
  for (let index = openingIndex; index < sql.length; index += 1) {
    const char = sql[index];
    if (quote) {
      if (char === quote && sql[index - 1] !== '\\') quote = null;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char === '(') depth += 1;
    if (char === ')' && --depth === 0) return index;
  }
  return -1;
}

function splitTopLevel(value) {
  const pieces = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === quote && value[index - 1] !== '\\') quote = null;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === ',' && depth === 0) { pieces.push(value.slice(start, index)); start = index + 1; }
  }
  pieces.push(value.slice(start));
  return pieces;
}

export function auditMigrationSql(files) {
  const failures = [];
  const versions = new Map();
  for (const file of files) {
    const version = path.basename(file.path).match(/^(\d+)_/)?.[1];
    if (version) {
      if (versions.has(version)) failures.push(`Versione migrazione duplicata ${version}: ${versions.get(version)} / ${file.path}`);
      versions.set(version, file.path);
    }
    const tablePattern = /create\s+table\s+(?:if\s+not\s+exists\s+)?([\w.]+)\s*\(/gi;
    let match = tablePattern.exec(file.sql);
    while (match) {
      const open = file.sql.indexOf('(', match.index);
      const close = findMatchingParen(file.sql, open);
      if (close < 0) { failures.push(`${file.path}: CREATE TABLE ${match[1]} senza parentesi chiusa`); break; }
      const seen = new Set();
      for (const definition of splitTopLevel(file.sql.slice(open + 1, close))) {
        const normalized = definition.trim();
        if (!normalized || /^(constraint|primary|foreign|unique|check|exclude)\b/i.test(normalized)) continue;
        const column = normalized.match(/^"?([a-z_][a-z0-9_]*)"?\s+/i)?.[1]?.toLowerCase();
        if (!column) continue;
        if (seen.has(column)) failures.push(`${file.path}: colonna duplicata ${match[1]}.${column}`);
        seen.add(column);
      }
      tablePattern.lastIndex = close + 1;
      match = tablePattern.exec(file.sql);
    }
    const nonEmpty = file.sql.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (let index = 1; index < nonEmpty.length; index += 1) {
      if (nonEmpty[index].startsWith('where ') && nonEmpty[index] === nonEmpty[index - 1]) {
        failures.push(`${file.path}: clausola WHERE duplicata: ${nonEmpty[index]}`);
      }
    }
    if ((file.sql.match(/where ve\.venue_id = v\.id and ve\.exception_date/gi) || []).length > 1) {
      failures.push(`${file.path}: filtro hourExceptions duplicato`);
    }
  }
  return failures;
}

export async function loadMigrations(directory = 'supabase/migrations') {
  const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  return Promise.all(names.map(async (name) => ({ path: path.join(directory, name), sql: await readFile(path.join(directory, name), 'utf8') })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const failures = auditMigrationSql(await loadMigrations());
  if (failures.length) {
    failures.forEach((failure) => {
      console.error(failure);
    });
    process.exitCode = 1;
  }
  else console.info('Migrazioni SQL: versioni univoche, CREATE TABLE e filtri mirati validi.');
}
