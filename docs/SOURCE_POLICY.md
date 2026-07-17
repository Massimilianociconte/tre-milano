# TRE Milano — Source & Provenance Policy

Versione 0.1 — 16 luglio 2026  
Owner proposto: Data Steward + Responsabile editoriale  
Stato: policy e implementazione locale versionate; database remoto, fonti e job non ancora attivati.

## 1. Principio

TRE Milano pubblica un dato operativo solo se può spiegare **chi lo ha fornito, quando è stato osservato, a quali condizioni può essere usato e quanto è affidabile**. La provenienza è per campo, non soltanto per scheda.

## 2. Fonti ammissibili

Ordine orientativo, da valutare per tipo di campo e freschezza:

1. registri ed enti pubblici, nel perimetro e con licenza applicabile;
2. Open Data/API ufficiali, inclusi dataset del Comune di Milano con la licenza indicata nei metadati;
3. sito, menu, booking e canali ufficiali del locale;
4. comunicazioni del titolare verificate;
5. osservazione editoriale originale e datata;
6. provider commerciali/API con contratto e diritti adeguati;
7. segnalazioni pubbliche come trigger, mai come prova unica.

### Fonti non ammesse

- scraping in violazione di termini, `robots.txt`, rate limit o misure di accesso;
- pagine dietro login/paywall/CAPTCHA aggirato;
- copie di database o media senza licenza;
- testi di recensioni, foto e username di utenti senza autorizzazione;
- fonti senza URL/ID, data o responsabile verificabile;
- dati personali non necessari o contatti privati;
- output generativo usato come prova fattuale di un locale.

## 3. Contratto minimo di provenance

Ogni valore normalizzato deve essere collegato a una osservazione immutabile con:

```text
source_id
source_type            institutional | official | open_data | editorial | licensed | report
source_name
source_url_or_record_id
license_or_terms_id
retrieved_at
published_at           nullable
observed_value
normalized_value
transformation_version
confidence
verification_status    unverified | corroborated | verified | disputed | expired
verified_at             nullable
verified_by             nullable
valid_until             nullable
evidence_hash
```

Il record di scheda punta al valore attivo, ma non cancella le osservazioni precedenti. Un cambio di fonte produce una nuova revisione.

## 4. Pipeline di acquisizione

1. **Registro fonte:** owner, licenza, limiti, quota, contatto, regione e DPA se applicabile.
2. **Fetch rispettoso:** API prima di crawling; user agent identificabile; rate limit; retry con backoff e jitter; circuit breaker.
3. **Raw limitato:** checksum sempre; payload grezzo solo quando licenza/termini e necessità lo consentono, con retention per fonte e cancellazione automatica.
4. **Normalizzazione:** Unicode, telefono E.164, email/domain, URL canonico, indirizzo e categorie controllate.
5. **Geocodifica:** provider/licenza registrati; precisione e confidence separate; nessuna coordinata inventata.
6. **Entity resolution:** candidate match e merge assistito; nessun merge automatico con conflitti forti.
7. **Validazione:** schema, range, Milano boundary, duplicati, contatti, orari e anomalie.
8. **Scoring:** completezza distinta da affidabilità e freschezza.
9. **Moderazione:** automatic publish solo per regole approvate; dati critici/conflitti richiedono umano.
10. **Audit:** batch, conteggi, errori, retry, scarti, decisione e rollback.

## 5. Deduplicazione e identità

La chiave non è il nome. Il matching combina:

- nome normalizzato e alias;
- indirizzo normalizzato e civico;
- coordinate con soglia dichiarata;
- telefono E.164;
- dominio e social ufficiali;
- identificatori delle fonti;
- stato storico, trasferimenti e insegna precedente.

I candidati ricevono un punteggio e reason code. Un merge ad alta confidenza può essere proposto; conflitti su telefono, dominio, civico o stato richiedono revisione. Ogni merge deve essere reversibile.

## 6. Freschezza e qualità

Soglie iniziali da calibrare su dati reali:

| Campo | Finestra massima proposta | Azione alla scadenza |
| --- | --- | --- |
| stato, orari, prenotazione, telefono/URL operativo | 30–90 giorni | CTA/ranking sospesi se critico |
| menu e prezzi | 90 giorni | mostrare stima/data o rimuovere |
| servizi, dehors, terrazza, accessibilità | 180 giorni | marcare non verificato |
| identità, indirizzo, coordinate | 365 giorni o evento | nuova verifica/merge review |
| metriche aggregate | secondo contratto/licenza | data fonte visibile; scadenza |

`quality_score`, `completeness_score`, `freshness_score` e `editorial_confidence` restano separati. Nessun punteggio estetico può compensare un dato operativo non verificato.

## 7. Chiusure, trasferimenti e conflitti

- Una chiusura plausibile imposta `recommendation_suspended` in attesa di verifica.
- Chiusura confermata: rimozione da ranking e CTA; pagina storica solo se utile e correttamente marcata.
- Trasferimento: nuovo indirizzo/versione, non sovrascrittura priva di storia.
- Contestazione media o identità: sospensione del campo contestato quando il rischio è plausibile.
- Claim del titolare: nuova fonte `official_claim`, non override automatico.

## 8. Recensioni e metriche

TRE Milano può mostrare solo aggregati consentiti dal contratto/licenza, con fonte, scala, volume e data. Non si combinano medie eterogenee senza una metodologia pubblica. Testi, autori e immagini dei recensori non vengono importati per impostazione predefinita.

## 9. Immagini e marchi

Ogni asset deve avere un ledger con owner, tipo di diritto, licenza/autorizzazione, fonte master, hash, trasformazioni, scadenza e usi consentiti. Marchi e loghi vengono usati soltanto in modo informativo, senza suggerire endorsement.

### Asset hero Duomo — ledger iniziale

- Tipo: asset editoriale originale, **AI-generated**, non fotografia documentale.
- Data generazione e revisione: 16 luglio 2026.
- Master locale non pubblicato: `~/.codex/generated_images/019f6a66-3cf0-7402-92af-348801edd750/exec-247406c5-4340-4af4-834a-f26aedfc5bb1.png`.
- SHA-256 master: `72c8de4c58494954ed93ffafdd6af8fb0fdd7a9f6d12d1c8e86b27426dd17678`.
- Derivato JPG: `public/images/hero-milano.jpg`, SHA-256 `4375c7e145d4a7a879ee3eb6a53826d5c4c2005f5aa384e6b37763811194bd1b`.
- Derivato WebP: `public/images/hero-milano.webp`, SHA-256 `a971bca98bc3df3fd90b430b3210bb124d55bbf728079d7eb1346b3503a28838`.
- Controllo: revisione visiva umana di prospettiva, proporzioni del Duomo, assenza di testo/loghi di terzi e resa responsive.
- Limite d’uso: immagine d’atmosfera per TRE Milano; **non** prova l’esistenza di una terrazza, una vista, un servizio o un locale reale.
- Gate successivo: registrare tool/modello, prompt originale, reviewer nominativo e decisione di approvazione nell’asset ledger di produzione.

## 10. Logging, retry e sicurezza

- Log strutturati senza body personali per default.
- ID batch/correlation, source ID, contatori e reason code; query e credenziali redatte.
- Retry soltanto per errori transient con limite e dead-letter queue.
- Segreti server-side e rotazione; nessuna service key nel client.
- Rate limit per fonte e API pubblica; protezione da enumerazione/esportazione massiva.
- Backup e restore testati; cancellazione coerente con licenze e richieste privacy.

## 11. Revisione manuale

La coda deve mostrare prima/dopo, fonti in conflitto, confidence, età e reason code. Il moderatore approva, rifiuta, unisce, separa, sospende o chiede evidenza. Ogni decisione registra autore, data e motivazione; le azioni ad alto impatto richiedono revisione a due persone.

## 12. Stato dell’implementazione e fonti non ancora importate

Le migrazioni `20260716215041`–`20260716215043` implementano schema PostGIS, provenance per campo, candidate dedupe, code, import run/error, retention e source registry. Gli adapter partono `enabled=false`, i record importati restano `draft/unverified/bronze` e il catalogo remoto non esiste ancora: presenza del codice non equivale a raccolta, licenza o pubblicazione.

Il registro iniziale contiene tre dataset amministrativi del Comune di Milano, OpenStreetMap e fatti da canali ufficiali. Prima di abilitare una fonte devono essere verificati URL/versione del dataset, licenza, attribuzione, uso commerciale e derivativo, data snapshot, qualità, privacy, quota e limiti di riuso. Le anagrafiche amministrative entrano come osservazioni e non provano automaticamente insegna commerciale o apertura corrente.

- [Portale Open Data del Comune di Milano](https://dati.comune.milano.it/)
- [Licenze del Portale del Dato](https://dati.comune.milano.it/web/portale-del-dato/governo-dei-dati/licenze)
- siti e API ufficiali dei locali, previa verifica delle condizioni;
- fonti istituzionali e provider contrattualizzati da registrare prima dell’uso.

Al 16 luglio 2026 il catalogo applicativo resta dimostrativo: source registry e allowlist sono un controllo preventivo, non prova di acquisizione, licenza o verifica di uno specifico record.
