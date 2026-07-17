# TRE Milano — Audit legale e di conformità

Data: 17 luglio 2026. Basato sul codice versionato e sul comportamento osservabile della preview. **Questo documento non è un parere legale**: le sezioni marcate ⚖️ richiedono validazione di un avvocato o consulente privacy prima del go-live indicizzabile.

## 1. Perimetro fattuale del trattamento (verificato sul codice)

| Aspetto | Stato reale |
|---|---|
| Account utente | **Assenti**: nessuna registrazione, login, password o identificatore lato server |
| Preferiti, profilo di gusto, ultimo podio | Solo `localStorage` del dispositivo; cancellabili in-app |
| Cookie | **Nessun cookie applicativo** (`document.cookie` non usato); niente pixel/SDK/analytics remoti |
| Geolocalizzazione | Solo foreground, su azione esplicita, `enableHighAccuracy:false`, mai persistita né trasmessa |
| Query di ricerca | Parser locale di default; solo query complesse senza indicatori di dati personali possono raggiungere DeepSeek (server-side, con guardia privacy e timeout) |
| Analytics | Contratto locale a `CustomEvent`, **senza trasporto remoto** |
| Moduli | Netlify Forms (correzioni, rivendicazioni) con honeypot e allowlist campi |
| Rate limiting API | Hash dell'IP con segreto server, bucket a breve scadenza |
| Catalogo | Dati di attività economiche con provenance per campo e data di verifica |

## 2. Inventario cookie e storage (audit)

| Chiave | Tipo | Finalità | Durata | Esente da consenso? |
|---|---|---|---|---|
| `tre-saved-venues` | localStorage | preferiti richiesti dall'utente | fino a rimozione | ⚖️ qualificazione tecnica da confermare |
| `tre-milano:taste-profile:v1` | localStorage | preferenze esplicite | fino a disattivazione | ⚖️ idem |
| `tre-milano:last-podium:v1` | localStorage | continuità del podio | 4 ore | sì (funzione richiesta) |
| handoff ricerca | sessionStorage | passaggio query senza URL | lettura singola | sì |
| Cache service worker | Cache Storage | shell offline | versione build | sì |
| **Cookie** | — | — | — | **nessuno presente** |

Conclusione operativa: **nessun banner cookie è dovuto** nella configurazione attuale (Linee guida Garante 10/6/2021: il banner serve per strumenti non tecnici; mostrarne uno "formale" sarebbe fuorviante). Il vincolo è documentato in `/cookie-policy/`; l'introduzione di qualunque strumento opzionale richiede prima un centro preferenze con blocco preventivo.

## 3. Registro fornitori (art. 28/30 GDPR)

| Fornitore | Ruolo | Trattamenti | Trasferimenti | Stato contrattuale |
|---|---|---|---|---|
| Netlify, Inc. | responsabile | hosting, CDN, Functions, Forms | possibili extra-UE (DPF/SCC) | ⚖️ DPA da archiviare |
| Supabase, Inc. | responsabile | Postgres/PostGIS catalogo (regione UE) | sub-responsabili da censire | ⚖️ DPA da archiviare |
| Hangzhou DeepSeek AI Co., Ltd. | responsabile/titolare autonomo (da qualificare) | interpretazione query complesse | **RPC** — trattamento in Cina dichiarato | ⚖️ **blocco go-live**: TIA + base art. 44 ss. mancanti |
| Cloudflare, Inc. | responsabile (futuro) | Turnstile anti-abuso (non attivo) | da verificare | non attivo |
| GitHub, Inc. | infrastruttura | repository sorgente (no dati utenti) | n/a | — |

## 4. Basi giuridiche (sintesi; dettaglio in /privacy/)

- Erogazione funzioni richieste: art. 6.1.b / 6.1.f GDPR.
- Sicurezza e anti-abuso: art. 6.1.f (+ 6.1.c ove applicabile).
- Moduli correzione/claim: art. 6.1.b o 6.1.f ⚖️ da confermare sul flusso definitivo.
- Catalogo con contatti professionali pubblici: art. 6.1.f ⚖️ con bilanciamento documentato (LIA) da redigere.
- Nessun trattamento basato su consenso attivo oggi (niente da revocare); la revoca diventa rilevante solo con strumenti opzionali futuri.

## 5. Trasparenza del ranking e piattaforme

- Parametri principali pubblicati in `/metodologia/#parametri` (Dir. 2005/29/CE mod. 2019/2161; d.lgs. 26/2023; Reg. 2019/1150 ove il claim flow instauri un rapporto piattaforma-business ⚖️ da qualificare quando il claim API sarà attivo).
- Indipendenza commerciale dichiarata nei Termini §3; nessuna sponsorizzazione attiva.
- DSA (Reg. 2022/2065): oggi il servizio non ospita contenuti generati dagli utenti pubblicati (i moduli non sono pubblicati automaticamente); percorso segnalazioni presente in `/correzioni/`. ⚖️ Rivalutare la qualificazione se verranno pubblicate recensioni/UGC.

## 6. Diritti degli interessati — attuazione tecnica

| Diritto | Attuazione |
|---|---|
| Accesso/portabilità | dati locali esportabili dalla pagina Profilo; nessun dato server riferito all'utente |
| Rettifica | `/correzioni/` per dati di catalogo; ⚖️ SLA di risposta da definire |
| Cancellazione | in-app per dati locali; `/rivendica-scheda/` per schede; retention moduli documentata |
| Opposizione | percorso correzioni/claim per contatti professionali in catalogo |
| Reclamo | link al Garante in `/privacy/` |

## 7. Diritti su immagini e contenuti

- Solo asset proprietari o placeholder di categoria (`SOURCE_POLICY.md`); nessuna fotografia di terzi importata.
- Manifest media con hash e diritti registrati in DB (`imageRights` con `rightsStatus`/`rightsHolder`).
- Percorso takedown: `/correzioni/` (Termini §7-8).

## 8. Rischi residui ordinati per severità ⚖️

1. **DeepSeek — trasferimento extra-UE senza TIA/base art. 44 ss.**: l'integrazione è tecnicamente attiva in preview noindex; NON promuovere a produzione senza parere. Mitigazioni già in essere: guardia privacy pre-invio, no logging query, fallback locale.
2. **Titolare non valorizzato** in privacy/termini (placeholder): blocca qualunque valore vincolante dei testi.
3. **LIA per catalogo/contatti professionali** non redatta.
4. **DPA Netlify/Supabase** non archiviati formalmente nel registro.
5. **Qualificazione esenzione consenso** per localStorage persistente (preferiti/profilo) da confermare.
6. **Retention effettive dei log fornitori** non allineate contrattualmente.
7. **P2B**: dormiente finché il claim API non è pubblico; da rivalutare al cutover.

## 9. Checklist di pubblicazione (gate legale)

- [ ] Valorizzare titolare, sede, contatti, PEC in `/privacy/`, `/termini/`, `/informativa-dati/`
- [ ] Parere legale su: DeepSeek (o disattivazione), LIA catalogo, esenzione storage, testi finali
- [ ] Archiviare DPA Netlify + Supabase; censire sub-responsabili
- [ ] Definire SLA correzioni/claim e responsabile interno
- [ ] Rimuovere `noindex` dalle pagine legali SOLO dopo i punti sopra
- [ ] Ripetere l'audit storage sul dominio definitivo (header, strumenti aggiunti da fornitori)
- [ ] Versionare la data di approvazione nei footer delle pagine legali

## 10. Fonti normative

- Reg. (UE) 2016/679 (GDPR) — eur-lex.europa.eu/legal-content/it/TXT/?uri=CELEX:32016R0679
- Dir. 2002/58/CE (ePrivacy) e d.lgs. 196/2003 come mod. d.lgs. 101/2018 (art. 122 cookie)
- Linee guida cookie Garante 10 giugno 2021 (doc. web 9677876)
- Reg. (UE) 2019/1150 (P2B) — trasparenza ranking piattaforme-business
- Dir. (UE) 2019/2161 (Omnibus) e d.lgs. 26/2023 — trasparenza ranking verso consumatori
- Reg. (UE) 2022/2065 (DSA)
- Codice del Consumo (d.lgs. 206/2005), in part. pratiche commerciali scorrette
- EDPB Guidelines 05/2020 (consenso), 07/2020 (titolare/responsabile), Racc. 01/2020 (misure supplementari trasferimenti)
