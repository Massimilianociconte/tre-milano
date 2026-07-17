# Quality gates browser

La Definition of Done locale e CI usa Chromium e non dipende dal deploy Netlify.

## Comandi

```bash
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
pnpm quality:lighthouse
pnpm quality:ci
pnpm media:generate
pnpm media:audit
```

Playwright genera una build production-like e la serve con `astro preview` sulla porta dedicata `127.0.0.1:4178`, senza riusare server di sviluppo manuali o cache HMR. Ripete l'intera suite a 360, 768 e 1440 px. Copre il podio visuale 2–1–3 mantenendo l'ordine DOM semantico 1–2–3, la ricerca, lo stato vuoto safety-critical, la sostituzione isolata di una card, il percorso tastiera/Escape, il fallback Web Share → Clipboard del venue passport, l’assenza di CTA operative nelle fixture, gli errori console e axe WCAG 2.0/2.1 A/AA. Axe blocca ogni violazione `critical` o `serious`.

Lighthouse CI usa la build statica e due run desktop. Blocca regressioni sotto 0,80 di performance e 0,90 per accessibilità, best practices e SEO, oltre i budget FCP 2 s, LCP 3,5 s, CLS 0,1 e TBT 300 ms. L'audit `is-crawlable` è escluso soltanto perché la preview fixture è intenzionalmente `noindex`; deve essere riattivato per il dominio Gold.

Il gate media parte dagli originali JPG locali e genera una matrice AVIF/WebP versionata alle sole larghezze 480/768/1200/1600 non superiori alla sorgente. Il manifest contiene hash e metadati verificabili; il test controlla inoltre che una seconda esecuzione sia realmente idempotente. `pnpm build` blocca file mancanti, formati o dimensioni divergenti, hash obsoleti, varianti inattese, upscaling e copie assenti da `dist/`.

Non sono usati `sleep` o retry temporali applicativi: le attese osservano URL, DOM, focus e stato React. Un unico retry è abilitato solo in CI e conserva trace/screenshot diagnostici. Gli artefatti vanno in `/tmp/tre-milano-playwright` e `/tmp/tre-milano-lhci`; le directory fallback nel repository sono ignorate.

Limiti espliciti: il gate automatizzato copre Chromium, non sostituisce Safari/iOS, Firefox, dispositivi fisici, rete mobile reale o la convalida Core Web Vitals sul dominio finale. I limiti Lighthouse sono volutamente abbastanza larghi da assorbire la variabilità di un runner CI, ma restano bloccanti.
