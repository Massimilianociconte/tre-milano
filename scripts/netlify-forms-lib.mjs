export const correctionFormName = 'tre-correzione';
export const correctionSuccessPath = '/correzioni/inviata/';
export const claimFormName = 'tre-rivendicazione';
export const claimSuccessPath = correctionSuccessPath;

export const correctionFieldNames = [
  'form-name',
  'bot-field',
  'pagina',
  'tipo-correzione',
  'dettaglio',
  'fonte',
  'email',
  'consenso-privacy',
];

export const correctionTypeAllowlist = [
  'identita',
  'indirizzo-zona',
  'orari-stato',
  'prezzi',
  'descrizione-atmosfera',
  'accessibilita-servizi',
  'media-diritti',
  'altro-verificabile',
];

export const claimFieldNames = [
  'form-name',
  'bot-field',
  'scheda',
  'tipo-richiesta',
  'ruolo',
  'nome-richiedente',
  'impresa',
  'email-professionale',
  'sito-ufficiale',
  'dettaglio',
  'dichiarazione-autorita',
  'presa-visione-privacy',
];

export const claimRequestTypeAllowlist = [
  'rivendicazione',
  'aggiornamento',
  'rimozione',
  'diritti-media',
];

export const claimRoleAllowlist = [
  'titolare',
  'legale-rappresentante',
  'delegato',
  'titolare-diritti',
];

export function parseAttributes(tag) {
  const attributes = new Map();
  const source = tag
    .replace(/^<[^\s>]+\s*/i, '')
    .replace(/\/?\s*>$/, '');
  const attributePattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match = attributePattern.exec(source);
  while (match !== null) {
    attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
    match = attributePattern.exec(source);
  }
  return attributes;
}

function findNamedForm(html, formName) {
  const forms = html.match(/<form\b[^>]*>[\s\S]*?<\/form>/gi) ?? [];
  return forms.find((form) => {
    const openingTag = form.match(/^<form\b[^>]*>/i)?.[0];
    return openingTag && parseAttributes(openingTag).get('name') === formName;
  });
}

function namedFields(form) {
  const fields = new Map();
  for (const tag of form.match(/<(?:input|select|textarea)\b[^>]*>/gi) ?? []) {
    const attributes = parseAttributes(tag);
    const name = attributes.get('name');
    if (!name) continue;
    const existing = fields.get(name) ?? [];
    existing.push({ attributes, tag, tagName: tag.match(/^<([a-z]+)/i)?.[1].toLowerCase() });
    fields.set(name, existing);
  }
  return fields;
}

function requireAttribute(failures, field, attribute, expectedValue) {
  if (!field.attributes.has(attribute)) {
    failures.push(`${field.attributes.get('name')}: attributo ${attribute} mancante`);
    return;
  }
  if (expectedValue !== undefined && field.attributes.get(attribute).toLowerCase() !== expectedValue) {
    failures.push(`${field.attributes.get('name')}: ${attribute} non valido`);
  }
}

function rejectAttribute(failures, field, attribute) {
  if (field.attributes.has(attribute)) failures.push(`${field.attributes.get('name')}: ${attribute} non deve essere presente`);
}

export function validateCorrectionFormHtml(html) {
  const failures = [];
  const form = findNamedForm(html, correctionFormName);
  if (!form) return [`form ${correctionFormName} non trovato`];

  const openingTag = form.match(/^<form\b[^>]*>/i)[0];
  const formAttributes = parseAttributes(openingTag);
  if ((formAttributes.get('method') ?? '').toLowerCase() !== 'post') failures.push('method del form deve essere POST');
  if (formAttributes.get('action') !== correctionSuccessPath) failures.push(`action del form deve essere ${correctionSuccessPath}`);
  if ((formAttributes.get('data-netlify') ?? '').toLowerCase() !== 'true') failures.push('data-netlify="true" mancante');
  if (formAttributes.get('netlify-honeypot') !== 'bot-field') failures.push('honeypot del form non valido');

  const fields = namedFields(form);
  const expectedNames = new Set(correctionFieldNames);
  for (const name of correctionFieldNames) {
    const matches = fields.get(name) ?? [];
    if (matches.length === 0) failures.push(`campo ${name} mancante`);
    if (matches.length > 1) failures.push(`campo ${name} duplicato`);
  }
  for (const name of fields.keys()) {
    if (!expectedNames.has(name)) failures.push(`campo inatteso ${name}`);
  }

  const field = (name) => fields.get(name)?.[0];
  const formName = field('form-name');
  if (formName) {
    requireAttribute(failures, formName, 'type', 'hidden');
    if (formName.attributes.get('value') !== correctionFormName) failures.push('valore form-name non valido');
  }

  const honeypot = field('bot-field');
  if (honeypot) {
    if (honeypot.attributes.get('tabindex') !== '-1') failures.push('honeypot deve avere tabindex="-1"');
    if ((honeypot.attributes.get('autocomplete') ?? '').toLowerCase() !== 'off') failures.push('honeypot deve disattivare autocomplete');
    rejectAttribute(failures, honeypot, 'required');
  }

  const page = field('pagina');
  if (page) {
    requireAttribute(failures, page, 'type', 'text');
    requireAttribute(failures, page, 'required');
    if (page.attributes.get('maxlength') !== '500') failures.push('pagina: maxlength non valido');
  }

  const correctionType = field('tipo-correzione');
  if (correctionType) {
    if (correctionType.tagName !== 'select') failures.push('tipo-correzione deve essere un select');
    requireAttribute(failures, correctionType, 'required');
    const selectMatch = form.match(/<select\b[^>]*name=(?:"tipo-correzione"|'tipo-correzione'|tipo-correzione)[^>]*>[\s\S]*?<\/select>/i);
    const options = (selectMatch?.[0].match(/<option\b[^>]*>/gi) ?? [])
      .map((option) => parseAttributes(option).get('value'))
      .filter(Boolean);
    if (JSON.stringify(options) !== JSON.stringify(correctionTypeAllowlist)) {
      failures.push('allowlist tipo-correzione non valida');
    }
  }

  const detail = field('dettaglio');
  if (detail) {
    if (detail.tagName !== 'textarea') failures.push('dettaglio deve essere un textarea');
    requireAttribute(failures, detail, 'required');
    if (detail.attributes.get('minlength') !== '20') failures.push('dettaglio: minlength non valido');
    if (detail.attributes.get('maxlength') !== '1500') failures.push('dettaglio: maxlength non valido');
  }

  const source = field('fonte');
  if (source) {
    requireAttribute(failures, source, 'type', 'url');
    rejectAttribute(failures, source, 'required');
  }

  const email = field('email');
  if (email) {
    requireAttribute(failures, email, 'type', 'email');
    rejectAttribute(failures, email, 'required');
  }

  const consent = field('consenso-privacy');
  if (consent) {
    requireAttribute(failures, consent, 'type', 'checkbox');
    requireAttribute(failures, consent, 'required');
    if (consent.attributes.get('value') !== 'accetto') failures.push('consenso-privacy: valore non valido');
  }

  if (!/<a\b[^>]*href=(?:"\/privacy\/"|'\/privacy\/'|\/privacy\/)[^>]*>/i.test(form)) {
    failures.push('link alla privacy mancante');
  }
  if (/<input\b[^>]*type=(?:"file"|'file'|file)[^>]*>/i.test(form)) failures.push('file upload non consentito');
  if (/data-netlify-recaptcha|recaptcha/i.test(form)) failures.push('reCAPTCHA non previsto');

  const readableCopy = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  if (!readableCopy.includes('verifica')) failures.push('copy di moderazione/verifica mancante');
  if (!readableCopy.includes('ranking')) failures.push('copy sulla neutralità del ranking mancante');

  return failures;
}

function selectValues(form, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const selectMatch = form.match(new RegExp(`<select\\b[^>]*name=(?:"${escapedName}"|'${escapedName}'|${escapedName})[^>]*>[\\s\\S]*?<\\/select>`, 'i'));
  return (selectMatch?.[0].match(/<option\b[^>]*>/gi) ?? [])
    .map((option) => parseAttributes(option).get('value'))
    .filter(Boolean);
}

function validateCheckbox(failures, field, expectedName) {
  if (!field) return;
  requireAttribute(failures, field, 'type', 'checkbox');
  requireAttribute(failures, field, 'required');
  if (field.attributes.get('value') !== 'confermo') failures.push(`${expectedName}: valore non valido`);
}

export function validateClaimFormHtml(html) {
  const failures = [];
  const form = findNamedForm(html, claimFormName);
  if (!form) return [`form ${claimFormName} non trovato`];

  const openingTag = form.match(/^<form\b[^>]*>/i)[0];
  const formAttributes = parseAttributes(openingTag);
  if ((formAttributes.get('method') ?? '').toLowerCase() !== 'post') failures.push('claim: method del form deve essere POST');
  if (formAttributes.get('action') !== claimSuccessPath) failures.push(`claim: action del form deve essere ${claimSuccessPath}`);
  if ((formAttributes.get('data-netlify') ?? '').toLowerCase() !== 'true') failures.push('claim: data-netlify="true" mancante');
  if (formAttributes.get('netlify-honeypot') !== 'bot-field') failures.push('claim: honeypot del form non valido');

  const fields = namedFields(form);
  const expectedNames = new Set(claimFieldNames);
  for (const name of claimFieldNames) {
    const matches = fields.get(name) ?? [];
    if (matches.length === 0) failures.push(`claim: campo ${name} mancante`);
    if (matches.length > 1) failures.push(`claim: campo ${name} duplicato`);
  }
  for (const name of fields.keys()) {
    if (!expectedNames.has(name)) failures.push(`claim: campo inatteso ${name}`);
  }

  const field = (name) => fields.get(name)?.[0];
  const formName = field('form-name');
  if (formName) {
    requireAttribute(failures, formName, 'type', 'hidden');
    if (formName.attributes.get('value') !== claimFormName) failures.push('claim: valore form-name non valido');
  }

  const honeypot = field('bot-field');
  if (honeypot) {
    if (honeypot.attributes.get('tabindex') !== '-1') failures.push('claim: honeypot deve avere tabindex="-1"');
    if ((honeypot.attributes.get('autocomplete') ?? '').toLowerCase() !== 'off') failures.push('claim: honeypot deve disattivare autocomplete');
    rejectAttribute(failures, honeypot, 'required');
  }

  const card = field('scheda');
  if (card) {
    requireAttribute(failures, card, 'type', 'text');
    requireAttribute(failures, card, 'required');
    if (card.attributes.get('maxlength') !== '500') failures.push('scheda: maxlength non valido');
  }

  const requestType = field('tipo-richiesta');
  if (requestType) {
    if (requestType.tagName !== 'select') failures.push('tipo-richiesta deve essere un select');
    requireAttribute(failures, requestType, 'required');
    if (JSON.stringify(selectValues(form, 'tipo-richiesta')) !== JSON.stringify(claimRequestTypeAllowlist)) {
      failures.push('allowlist tipo-richiesta non valida');
    }
  }

  const role = field('ruolo');
  if (role) {
    if (role.tagName !== 'select') failures.push('ruolo deve essere un select');
    requireAttribute(failures, role, 'required');
    if (JSON.stringify(selectValues(form, 'ruolo')) !== JSON.stringify(claimRoleAllowlist)) {
      failures.push('allowlist ruolo non valida');
    }
  }

  for (const [name, maximum] of [['nome-richiedente', '120'], ['impresa', '160']]) {
    const value = field(name);
    if (!value) continue;
    requireAttribute(failures, value, 'type', 'text');
    requireAttribute(failures, value, 'required');
    if (value.attributes.get('maxlength') !== maximum) failures.push(`${name}: maxlength non valido`);
  }

  const professionalEmail = field('email-professionale');
  if (professionalEmail) {
    requireAttribute(failures, professionalEmail, 'type', 'email');
    requireAttribute(failures, professionalEmail, 'required');
    if (professionalEmail.attributes.get('maxlength') !== '254') failures.push('email-professionale: maxlength non valido');
  }

  const officialSite = field('sito-ufficiale');
  if (officialSite) {
    requireAttribute(failures, officialSite, 'type', 'url');
    rejectAttribute(failures, officialSite, 'required');
    if (officialSite.attributes.get('maxlength') !== '500') failures.push('sito-ufficiale: maxlength non valido');
  }

  const detail = field('dettaglio');
  if (detail) {
    if (detail.tagName !== 'textarea') failures.push('claim: dettaglio deve essere un textarea');
    requireAttribute(failures, detail, 'required');
    if (detail.attributes.get('minlength') !== '30') failures.push('claim dettaglio: minlength non valido');
    if (detail.attributes.get('maxlength') !== '2000') failures.push('claim dettaglio: maxlength non valido');
  }

  validateCheckbox(failures, field('dichiarazione-autorita'), 'dichiarazione-autorita');
  validateCheckbox(failures, field('presa-visione-privacy'), 'presa-visione-privacy');

  if (!/<a\b[^>]*href=(?:"\/informativa-dati\/"|'\/informativa-dati\/'|\/informativa-dati\/)[^>]*>/i.test(form)) {
    failures.push('claim: link alla informativa dati mancante');
  }
  if (/<input\b[^>]*type=(?:"file"|'file'|file)[^>]*>/i.test(form)) failures.push('claim: file upload non consentito');
  if (/data-netlify-recaptcha|recaptcha/i.test(form)) failures.push('claim: reCAPTCHA non previsto');

  const readableCopy = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  if (!readableCopy.includes('verifica')) failures.push('claim: copy di verifica mancante');
  if (!readableCopy.includes('ranking')) failures.push('claim: copy sulla neutralità del ranking mancante');

  return failures;
}

export function validateCorrectionSuccessHtml(html) {
  const failures = [];
  const robotsMeta = (html.match(/<meta\b[^>]*>/gi) ?? []).find((tag) => {
    const attributes = parseAttributes(tag);
    return (attributes.get('name') ?? '').toLowerCase() === 'robots';
  });
  const robotsContent = robotsMeta ? (parseAttributes(robotsMeta).get('content') ?? '').toLowerCase() : '';
  if (!robotsContent.split(',').map((value) => value.trim()).includes('noindex')) {
    failures.push('pagina di conferma priva di meta robots noindex');
  }

  const headings = html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi) ?? [];
  if (headings.length !== 1) failures.push(`pagina di conferma: atteso un solo h1, trovati ${headings.length}`);
  const readableCopy = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  if (!readableCopy.includes('segnalazione ricevuta')) failures.push('conferma di ricezione mancante');
  if (!readableCopy.includes('non modifica automaticamente')) failures.push('copy sulla non pubblicazione automatica mancante');
  if (!readableCopy.includes('ranking')) failures.push('copy sulla neutralità del ranking mancante nella conferma');

  return failures;
}
