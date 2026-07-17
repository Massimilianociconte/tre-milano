import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimRequestTypeAllowlist,
  claimRoleAllowlist,
  correctionTypeAllowlist,
  validateClaimFormHtml,
  validateCorrectionFormHtml,
  validateCorrectionSuccessHtml,
} from './netlify-forms-lib.mjs';

const options = correctionTypeAllowlist.map((value) => `<option value="${value}">${value}</option>`).join('');
const validForm = `
  <form name="tre-correzione" method="POST" action="/correzioni/inviata/" data-netlify="true" netlify-honeypot="bot-field">
    <input type="hidden" name="form-name" value="tre-correzione">
    <input name="bot-field" tabindex="-1" autocomplete="off">
    <input type="text" name="pagina" required maxlength="500">
    <select name="tipo-correzione" required><option value="">Scegli</option>${options}</select>
    <textarea name="dettaglio" required minlength="20" maxlength="1500"></textarea>
    <input type="url" name="fonte">
    <input type="email" name="email">
    <input type="checkbox" name="consenso-privacy" value="accetto" required>
    <a href="/privacy/">Privacy</a>
    La segnalazione apre una verifica e non modifica il ranking.
  </form>`;

const validSuccess = `
  <!doctype html><html><head><meta name="robots" content="noindex, nofollow"></head>
  <body><h1>Segnalazione ricevuta.</h1><p>L'invio non modifica automaticamente la scheda o il ranking.</p></body></html>`;

const claimRequestOptions = claimRequestTypeAllowlist.map((value) => `<option value="${value}">${value}</option>`).join('');
const claimRoleOptions = claimRoleAllowlist.map((value) => `<option value="${value}">${value}</option>`).join('');
const validClaimForm = `
  <form name="tre-rivendicazione" method="POST" action="/correzioni/inviata/" data-netlify="true" netlify-honeypot="bot-field">
    <input type="hidden" name="form-name" value="tre-rivendicazione">
    <input name="bot-field" tabindex="-1" autocomplete="off">
    <input type="text" name="scheda" required maxlength="500">
    <select name="tipo-richiesta" required><option value="">Scegli</option>${claimRequestOptions}</select>
    <select name="ruolo" required><option value="">Scegli</option>${claimRoleOptions}</select>
    <input type="text" name="nome-richiedente" required maxlength="120">
    <input type="text" name="impresa" required maxlength="160">
    <input type="email" name="email-professionale" required maxlength="254">
    <input type="url" name="sito-ufficiale" maxlength="500">
    <textarea name="dettaglio" required minlength="30" maxlength="2000"></textarea>
    <input type="checkbox" name="dichiarazione-autorita" value="confermo" required>
    <input type="checkbox" name="presa-visione-privacy" value="confermo" required>
    <a href="/informativa-dati/">Informativa dati</a>
    La rivendicazione apre una verifica e non modifica automaticamente il ranking.
  </form>`;

test('form di correzione Netlify statico valido', () => {
  assert.deepEqual(validateCorrectionFormHtml(validForm), []);
});

test('audit intercetta honeypot, action e raccolta inattesa', () => {
  const broken = validForm
    .replace('netlify-honeypot="bot-field"', 'netlify-honeypot="website"')
    .replace('action="/correzioni/inviata/"', 'action="/grazie.html"')
    .replace('</form>', '<input name="telefono"></form>');
  const failures = validateCorrectionFormHtml(broken);
  assert.ok(failures.some((failure) => failure.includes('honeypot')));
  assert.ok(failures.some((failure) => failure.includes('action')));
  assert.ok(failures.some((failure) => failure.includes('campo inatteso telefono')));
});

test('audit intercetta un campo obbligatorio assente e una allowlist alterata', () => {
  const broken = validForm
    .replace('<textarea name="dettaglio" required minlength="20" maxlength="1500"></textarea>', '')
    .replace('<option value="prezzi">prezzi</option>', '<option value="claim-libero">claim-libero</option>');
  const failures = validateCorrectionFormHtml(broken);
  assert.ok(failures.some((failure) => failure.includes('campo dettaglio mancante')));
  assert.ok(failures.some((failure) => failure.includes('allowlist')));
});

test('pagina di conferma richiede noindex e copy non automatico', () => {
  assert.deepEqual(validateCorrectionSuccessHtml(validSuccess), []);
  const broken = validSuccess
    .replace('noindex, nofollow', 'index, follow')
    .replace('non modifica automaticamente', 'aggiorna subito');
  const failures = validateCorrectionSuccessHtml(broken);
  assert.ok(failures.some((failure) => failure.includes('noindex')));
  assert.ok(failures.some((failure) => failure.includes('non pubblicazione automatica')));
});

test('form di rivendicazione Netlify statico valido', () => {
  assert.deepEqual(validateClaimFormHtml(validClaimForm), []);
});

test('audit claim blocca campi extra, file e allowlist alterate', () => {
  const broken = validClaimForm
    .replace('<option value="rimozione">rimozione</option>', '<option value="pubblica-subito">pubblica-subito</option>')
    .replace('</form>', '<input type="file" name="documento"><input name="telefono"></form>');
  const failures = validateClaimFormHtml(broken);
  assert.ok(failures.some((failure) => failure.includes('allowlist tipo-richiesta')));
  assert.ok(failures.some((failure) => failure.includes('campo inatteso documento')));
  assert.ok(failures.some((failure) => failure.includes('campo inatteso telefono')));
  assert.ok(failures.some((failure) => failure.includes('file upload')));
});

test('audit claim richiede dichiarazioni, limiti e informativa dedicata', () => {
  const broken = validClaimForm
    .replace('name="dichiarazione-autorita" value="confermo" required', 'name="dichiarazione-autorita" value="forse"')
    .replace('maxlength="254"', 'maxlength="500"')
    .replace('href="/informativa-dati/"', 'href="/privacy/"');
  const failures = validateClaimFormHtml(broken);
  assert.ok(failures.some((failure) => failure.includes('dichiarazione-autorita: attributo required mancante')));
  assert.ok(failures.some((failure) => failure.includes('dichiarazione-autorita: valore non valido')));
  assert.ok(failures.some((failure) => failure.includes('email-professionale: maxlength non valido')));
  assert.ok(failures.some((failure) => failure.includes('informativa dati')));
});
