# Venue action layer

Il venue passport separa i fatti editoriali dalle azioni operative. La presenza di `officialUrl`, `telephone` o `geo` nella scheda non genera automaticamente una CTA: ogni azione deve essere dichiarata in `publication.actions` e superare il proprio gate.

## Contratto

Le azioni consentite sono soltanto:

- `official`: URL del sito, identico a `publication.officialUrl`;
- `menu`: URL pubblico HTTPS del menu;
- `reservation`: URL pubblico HTTPS della prenotazione;
- `telephone`: numero italiano E.164 `+39…`, identico a `publication.telephone`;
- `directions`: coordinate finite nell’area di Milano, identiche a `publication.geo`.

Ogni record contiene provenance obbligatoria: fonte `official` o `editorial`, `sourceUrl` HTTPS pubblico, `checkedAt`, `validUntil` con finestra massima di 90 giorni e confidence almeno `0.70`. Host di esempio, localhost, IP privati, dati scaduti, incoerenti o incompleti bloccano la pubblicabilità dell’intera venue; il client riceve soltanto le azioni già filtrate.

Le fixture restano sempre non pubblicabili e non ricevono CTA operative, anche se un payload accidentale contiene `publication.actions`. `Condividi` è l’unica azione sempre disponibile perché condivide la pagina corrente, senza trasformare dati fixture in informazioni operative.

## Navigazione esterna

`Naviga` usa il formato universale Google Maps Directions documentato da Google:

`https://www.google.com/maps/dir/?api=1&destination=LATITUDE,LONGITUDE&travelmode=walking`

Riferimento primario: [Google Maps URLs — Directions action](https://developers.google.com/maps/documentation/urls/get-started#directions-action).

TRE inserisce soltanto la destinazione verificata. Il link non contiene `origin`, coordinate di sessione o posizione dell’utente; l’eventuale scelta dell’origine avviene dopo l’apertura nel provider esterno.

## Rendering e fallback

Il server costruisce un payload client minimale dopo `getVerifiedVenuePublicationActions`; provenance e campi scartati non vengono serializzati nell’isola React. Gli URL esterni aprono una nuova scheda con `noopener noreferrer`; `Chiama` usa `tel:`. `Condividi` prova prima Web Share, poi Clipboard API e, se entrambe non sono disponibili, espone il link in un campo selezionabile.

