# TRE Milano — Design System

Sistema visivo unico per web, PWA e wrapper mobile. Fonte: `src/styles/global.css` (token in `:root`) + componenti Astro/React. Nessun kit UI esterno.

## Principi

1. **Milano contemporanea, non cliché**: eleganza editoriale (serif display), superfici avorio, navy profondo, oro champagne come accento raro.
2. **Gerarchia prima della decorazione**: ogni pagina ha un solo fuoco primario; l'oro non supera mai ~10% della superficie.
3. **Leggibilità come vincolo duro**: nessun testo informativo sotto 0.5rem (8px) su mobile; target touch ≥44px; contrasto AA.
4. **Fail-visible**: stati vuoti, di errore e di caricamento sono progettati, non lasciati al caso (skeleton shell, empty state con azione).

## Token

| Token | Valore | Uso |
|---|---|---|
| `--navy` | `#0b1320` | testo primario, CTA primarie, footer |
| `--navy-soft` | `#172334` | superfici scure secondarie |
| `--espresso` | `#2b211b` | preview bar, accenti caldi scuri |
| `--ivory` | `#f7f5f1` | fondo pagina |
| `--surface` | `#fffdf9` | card e superfici elevate |
| `--gold` / `--gold-ink` | `#c8a96e` / `#85612f` | accento; `gold-ink` per testo accessibile su chiaro |
| `--stone` / `--taupe` / `--line` | grigi caldi | bordi, divider, testo secondario |
| `--muted` | `#68645e` | testo secondario |
| `--error` | `#7d2d2d` | stati di errore |
| `--font-display` | Playfair Display | H1–H2 editoriali, numeri "editoriali" |
| `--font-sans` | Inter | UI, corpo, label |
| `--radius-sm/md/lg` | 0.5 / 0.85 / 1.15rem | raggio coerente; pill = 999px solo per chip |
| `--shadow-card/float` | ombre navy a bassa opacità | mai ombre nere pesanti |
| `--shell` | min(1200px, 100vw−48px) | griglia contenuti |

## Tipografia

- Display: Playfair, `clamp` fluido, line-height ≤1.1 per i titoli.
- UI: Inter 400–650; label uppercase con letter-spacing 0.08–0.19em **solo** ≥0.55rem.
- Corpo: 0.9375rem/1.55.
- Mobile: i `clamp()` dei componenti hanno floor ≥0.5rem (label) e ≥0.58rem (valori).

## Podio (gerarchia 2–1–3)

- Griglia fissa tre colonne, colonna centrale più larga (~20%) e card più alta: il n.1 domina senza cancellare 2 e 3.
- Corona trilobata (clip-path condiviso) + medaglione numerato; il n.3 è marcato "Wildcard" nel disclosure.
- ≤760px: i fatti (Spesa / A piedi) passano da 2 colonne a righe piene per evitare overflow; i nomi lunghi wrappano (`overflow-wrap: anywhere`).
- Basi sempre allineate (`align-items: end`), nessun carousel.

## Stati interattivi

- `:focus-visible`: outline 3px `--gold-ink`, offset 3px, ovunque.
- Hover: transizioni 150–260ms `ease`; niente animazioni che spostino layout (CLS 0).
- `prefers-reduced-motion: reduce` disattiva transizioni non essenziali.
- Skeleton: shell `--surface` con shimmer sottile; mai spinner full-page.

## Regole anti-pattern

- Non introdurre nuovi colori fuori token; non usare oro pieno come fondo di grandi aree.
- Non scendere sotto i floor tipografici né sotto 44px di target.
- Non aggiungere ombre con opacità >15% o blur >50px.
- Un solo CTA primario per vista; le CTA secondarie sono outline/testo.
- Icone: solo il set inline `Icon` (stroke 1.6, 24px viewBox); non mischiare set esterni.
