import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  claimFieldNames,
  claimFormName,
  correctionFieldNames,
  correctionFormName,
  validateClaimFormHtml,
  validateCorrectionFormHtml,
  validateCorrectionSuccessHtml,
} from './netlify-forms-lib.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const formPath = path.join(projectRoot, 'dist/correzioni/index.html');
const claimPath = path.join(projectRoot, 'dist/rivendica-scheda/index.html');
const successPath = path.join(projectRoot, 'dist/correzioni/inviata/index.html');
const failures = [];

try {
  failures.push(...validateCorrectionFormHtml(await readFile(formPath, 'utf8')));
} catch (error) {
  failures.push(`pagina form compilata non leggibile: ${error.message}`);
}

try {
  failures.push(...validateClaimFormHtml(await readFile(claimPath, 'utf8')));
} catch (error) {
  failures.push(`pagina claim compilata non leggibile: ${error.message}`);
}

try {
  failures.push(...validateCorrectionSuccessHtml(await readFile(successPath, 'utf8')));
} catch (error) {
  failures.push(`pagina di conferma compilata non leggibile: ${error.message}`);
}

if (failures.length) {
  console.error(`Audit Netlify Forms fallito (${failures.length}):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log(`Audit Netlify Forms: ${correctionFormName} (${correctionFieldNames.length} campi) e ${claimFormName} (${claimFieldNames.length} campi), honeypot, allowlist e conferma noindex verificati.`);
