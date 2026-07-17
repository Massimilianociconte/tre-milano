# TRE Milano — pacchetto legale e privacy (bozze)

Ultimo aggiornamento: 16 luglio 2026  
Stato: **bozze operative, non parere legale e non approvate per il go-live**.

## 1. Perimetro verificato

Le bozze distinguono il flusso pubblico effettivo dalle integrazioni già versionate ma non ancora attivate:

- sito Astro static-first ospitato su Netlify;
- nessun account, database utenti, pagamento, newsletter o prenotazione interna;
- preferiti, profilo di gusto e ultimo podio in `localStorage`;
- handoff della ricerca in `sessionStorage` e rimozione dopo la lettura;
- geolocalizzazione foreground solo su comando, tenuta nello stato React e non inviata al backend;
- eventi analytics locali tramite `CustomEvent`, senza trasporto, cookie o storage;
- moduli di correzione e claim ricevuti da Netlify Forms;
- una Netlify Function same-origin per l’interpretazione opzionale delle query complesse con DeepSeek;
- catalogo attuale composto da fixture, non da locali reali;
- migrazioni Supabase/Postgres/PostGIS e API same-origin per catalogo, filtri, schede e claim presenti nel repository, ma non applicate a un progetto remoto;
- API database fail-closed: senza credenziali server restituiscono `503` e non ricadono sulle fixture;
- endpoint claim Supabase e Cloudflare Turnstile predisposti ma non collegati al modulo pubblico, che resta Netlify Forms;
- job giornaliero predisposto per rate limit, retention, code di aggiornamento e sospensione dei record stantii.

Qualsiasi nuova integrazione modifica il perimetro e richiede aggiornamento di inventario, informativa e, quando applicabile, meccanismi di consenso prima del deploy.

## 2. Pagine predisposte

| URL | Scopo | Stato di indicizzazione |
| --- | --- | --- |
| `/privacy/` | informativa generale su navigazione, ricerca, posizione, storage, moduli e fornitori | `noindex`; bozza |
| `/cookie-policy/` | inventario cookie e tecnologie sul terminale; regole per un futuro CMP | `noindex`; bozza |
| `/termini/` | natura informativa, ranking, terzi, IP, responsabilità e reclami | `noindex`; bozza |
| `/informativa-dati/` | informativa ex art. 13 per correzioni, claim, rimozioni e reclami | `noindex`; bozza |
| `/correzioni/` | segnalazione fattuale via Netlify Forms | `noindex`; pratica manuale |
| `/rivendica-scheda/` | claim, aggiornamento, rimozione e diritti media via Netlify Forms | `noindex`; pratica manuale |
| `/fonti/` | policy editoriale pubblica di provenance, licenze e freschezza | `noindex` fino al catalogo reale |
| `/redazione/` | responsabilità editoriale e conflitti | `noindex` finché identità e credenziali non sono reali |

## 3. Campi obbligatori da completare

Non pubblicare le bozze come definitive finché non sono sostituiti tutti i placeholder:

1. denominazione/nome del titolare e forma giuridica;
2. sede, codice fiscale e P. IVA;
3. email privacy, email/PEC reclami e contatto editoriale;
4. DPO, rappresentante o referente privacy se applicabile;
5. responsabile editoriale, autori/revisori, competenze e conflitti;
6. legge applicabile e foro, preservando i diritti inderogabili dei consumatori;
7. elenco definitivo di responsabili e sub-responsabili;
8. meccanismo e documenti del trasferimento per ogni paese terzo;
9. retention effettiva dei log Netlify e delle submission;
10. procedura interna per diritti, data breach, cancellazione, reclami e takedown;
11. progetto Supabase, regione UE, DPA, sub-responsabili, backup e restore test;
12. configurazione e privacy assessment Cloudflare Turnstile se il claim API sostituirà Forms.

Questi valori non sono segreti tecnici, ma dati legali pubblici. È preferibile gestirli come configurazione validata al build; l’assenza deve impedire l’indicizzazione delle pagine definitive.

## 4. Matrice dei trattamenti proposta

| Trattamento | Dati | Finalità | Base proposta da confermare | Destinatari | Retention proposta |
| --- | --- | --- | --- | --- | --- |
| delivery e sicurezza | IP, user agent, URL, timestamp, esito | consegna, sicurezza, abuso | art. 6.1.f / 6.1.c ove applicabile | Netlify e sub-responsabili | minima necessaria; valore Netlify da verificare |
| funzioni locali | preferiti, profilo, podio, filtri | funzione richiesta e continuità | art. 6.1.b o f + verifica ePrivacy | nessun destinatario applicativo | preferiti/profilo fino a rimozione; podio 4 ore; handoff sessione |
| geolocalizzazione | coordinate precise foreground | stimare distanza dall’utente | permesso browser; base GDPR da confermare se dato personale trattato dal titolare | nessuno: stato volatile nel client | memoria pagina |
| query complessa | testo query, metadati tecnici della chiamata | classificare l’intento | art. 6.1.b/f da confermare; evitare dati personali | Netlify Function, DeepSeek | nessun log query TRE; retention DeepSeek da contrattualizzare |
| catalogo/API attivi in preview | query, filtri, bbox, eventuale origine geografica, hash IP per rate limit | ricerca testuale/geografica, sicurezza | art. 6.1.b/f; minimizzazione | Netlify Functions, Supabase | bucket hash: doppio della finestra; parametri non salvati nelle tabelle catalogo |
| dati dei locali | dati commerciali, contatti professionali pubblici, fonti e provenance | catalogo verificabile e aggiornato | art. 6.1.f con LIA; art. 6.1.c ove applicabile | Supabase se attivato, redazione, fonti contrattualizzate | per utilità, accuratezza, attribuzione e contestazioni; freshness per campo |
| correzione | scheda, dettaglio, fonte, email facoltativa | verificare accuratezza | art. 6.1.b/f | Netlify Forms, redazione | 12 mesi dalla chiusura |
| claim/rimozione | identità professionale, ruolo, impresa, contatti, richiesta | verificare legittimazione e diritti | art. 6.1.b/f/c secondo il caso | Netlify Forms, redazione, consulenti | 24 mesi dalla chiusura, salvo controversia |
| claim API predisposto | nome, ruolo, email, telefono/sito facoltativi, richiesta, URL evidenza, hash IP+email | claim/takedown e anti-abuso | art. 6.1.b/f/c; la checkbox è presa visione | Netlify Function, Supabase, Turnstile se attivati | default 365 giorni dalla ricezione, configurabile 30–1.095; purge giornaliero |
| esercizio diritti | identità minima, richiesta, risposta | adempiere al GDPR e difendere i diritti | art. 6.1.c/f | autorizzati, consulenti, autorità | periodo definito dalla procedura legale |

Il consenso non va usato come base generica per moduli che non possono essere gestiti senza trattamento: la checkbox è presa visione. Il consenso resta riservato a finalità davvero opzionali e separabili.

## 5. Fornitori e trasferimenti

### Netlify

- Ruolo contrattuale da confermare per hosting, CDN, Functions e Forms.
- DPA, elenco sub-responsabili, regioni, log e retention devono essere acquisiti e archiviati.
- Netlify dichiara trasferimenti internazionali e l’uso, secondo i casi, di SCC e Data Privacy Framework.
- Le submission contenenti PII devono essere cancellate attivamente; Netlify raccomanda una gestione periodica.

### DeepSeek

- L’API key resta esclusivamente server-side.
- L’informativa DeepSeek dichiara raccolta degli input e trattamento/conservazione nella Repubblica Popolare Cinese.
- La privacy policy DeepSeek precisa che il developer della downstream application deve informare i propri utenti.
- L’interprete è tecnicamente attivo nella preview `noindex`; prima di promozione e go-live servono determinazione dei ruoli, accordo applicabile, base del trasferimento, transfer impact assessment, misure supplementari, retention, processo diritti e valutazione di un provider alternativo UE/SEE.
- Il privacy guard e la minimizzazione del prompt riducono il rischio, ma non sostituiscono la base giuridica o il meccanismo di trasferimento.

### Supabase — catalogo attivo nella preview

- Service-role key esclusivamente nelle Netlify Functions e nella pipeline amministrativa; nessuna chiave database nel browser.
- Il progetto remoto e la regione primaria UE sono configurati; restano da archiviare/approvare DPA vigente, sub-responsabili, SCC/TIA ove necessarie, ruoli, backup, restore e policy di log prima del go-live definitivo.
- Il codice forza RLS, revoca accesso `anon/authenticated` e usa RPC service-only; queste misure non sostituiscono il controllo contrattuale e organizzativo.
- I claim API hanno retention tecnica iniziale di 365 giorni, configurabile tra 30 e 1.095. Il maintenance giornaliero elimina record scaduti; serve una procedura per pratiche aperte, controversie e legal hold.
- I payload grezzi delle fonti sono conservabili solo se i termini lo permettono e la source abilita esplicitamente `retainRaw`; default tecnico 30 giorni, poi purge giornaliero.

### Cloudflare Turnstile — predisposto, non attivo nel form pubblico

- Il client pubblico dovrà usare una site key, mentre la secret key resta server-only e la verifica Siteverify è obbligatoria.
- Prima del cutover: hostname limitati, ambienti separati, DPA/trasferimenti verificati e link al Turnstile Privacy Addendum nell’informativa/modulo.
- Turnstile tratta segnali tecnici per distinguere richieste umane e automatizzate; non va descritto come assenza totale di trattamento solo perché non usa un CAPTCHA tradizionale.

## 6. Consenso e tecnologie sul dispositivo

Il codice non attiva categorie opzionali; non viene quindi mostrato un banner senza scopo. La Cookie Policy censisce localStorage, sessionStorage e Cache Storage.

Se vengono introdotti analytics non esenti, profilazione, marketing, embed traccianti o fingerprinting, il deploy deve essere bloccato finché un CMP non garantisce:

- blocco preventivo;
- `Rifiuta` e `Accetta` equivalenti;
- scelta granulare senza preselezioni;
- prova di versione/categorie della scelta;
- revoca facile e permanente accesso al centro preferenze;
- aggiornamento contestuale della Cookie Policy;
- privacy by design/default e verifica periodica.

## 7. Claim, correzione e notice-and-action

I due flussi sono separati:

- **correzione**: chiunque segnala un fatto; email facoltativa; nessuna modifica automatica;
- **claim/rimozione**: richiede ruolo, impresa ed email professionale; nessun file pubblico; verifica tramite canale proporzionato.

La procedura interna deve assegnare un ID pratica, registrare fonti e decisione, sospendere rapidamente rischi plausibili, prevedere replica e appello e separare moderazione da ranking commerciale. L’applicabilità degli articoli 16 e 20 del Digital Services Act deve essere valutata dal legale in base al ruolo effettivo del servizio, ai contenuti ospitati e alle dimensioni. Le bozze non dichiarano una qualifica DSA non ancora determinata.

## 8. Diritti e data breach

Prima del go-live devono esistere:

- registro delle richieste ex artt. 15–22 GDPR e scadenziario;
- verifica d’identità proporzionata, senza raccolta automatica di documenti;
- cancellazione coordinata da Netlify Forms, archivi e backup applicabili;
- valutazione e procedura breach ai sensi degli artt. 33–34;
- registro dei trattamenti e nomine/autorizzazioni;
- canale per reclamo al Garante e autorità giudiziaria.

## 9. Gate legale per il go-live

La revisione è superata solo con evidenze, non con una variabile:

- [ ] titolare e contatti pubblici verificati;
- [ ] privacy, cookie e termini approvati e versionati;
- [ ] DPA e subprocessors Netlify archiviati;
- [ ] Supabase creato in regione UE, DPA/subprocessors/trasferimenti e restore test approvati;
- [ ] Turnstile disattivato oppure widget, DPA, hostname, privacy notice e Siteverify approvati;
- [ ] routine di cancellazione Forms attiva e testata;
- [ ] DeepSeek disattivato oppure trasferimento/contratto/DPIA-TIA approvati;
- [ ] inventario browser sul dominio reale privo di tracker inattesi;
- [ ] procedura claim/takedown con owner e SLA interni;
- [ ] media rights ledger completo;
- [ ] catalogo reale con licenze e provenance;
- [ ] responsabilità editoriale nominativa;
- [ ] test di esercizio diritti e cancellazione end-to-end;
- [ ] controllo DSA e consumer law sul modello definitivo.

## 10. Fonti ufficiali consultate

- [GDPR — Regolamento (UE) 2016/679](https://eur-lex.europa.eu/legal-content/it/TXT/?uri=CELEX:32016R0679)
- [Garante — Linee guida cookie e altri strumenti di tracciamento, 10 giugno 2021](https://www.garanteprivacy.it/web/guest/home/docweb/-/docweb-display/docweb/9677876)
- [Garante — esercizio dei diritti e reclamo](https://www.garanteprivacy.it/it/home/diritti/come-agire-per-tutelare-i-tuoi-dati-personali)
- [Commissione europea — regole sui trasferimenti internazionali](https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/rules-international-data-transfers_en)
- [Commissione europea — Standard Contractual Clauses](https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/standard-contractual-clauses-scc_en)
- [Digital Services Act — Regolamento (UE) 2022/2065](https://eur-lex.europa.eu/eli/reg/2022/2065/oj)
- [Netlify Privacy Statement](https://www.netlify.com/privacy/)
- [Netlify Forms — gestione delle submission](https://docs.netlify.com/manage/forms/submissions/)
- [DeepSeek Privacy Policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html)
- [DeepSeek Open Platform Terms](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html)
- [Supabase Data Processing Addendum, versione 1 giugno 2026](https://supabase.com/downloads/docs/Supabase%2BDPA%2B260601.pdf)
- [Supabase — regioni disponibili](https://supabase.com/docs/guides/platform/regions)
- [Supabase — shared responsibility e SOC 2](https://supabase.com/docs/guides/security/soc-2-compliance)
- [Cloudflare Turnstile Privacy Addendum](https://www.cloudflare.com/en-in/turnstile-privacy-policy/)
- [Cloudflare Data Processing Addendum](https://www.cloudflare.com/en-gb/cloudflare-customer-dpa/)
