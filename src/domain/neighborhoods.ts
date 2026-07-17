/**
 * Canonical, single-source neighborhood taxonomy shared by the local intent
 * parser, the remote interpretation contract and the last-podium snapshot
 * validation. Names must match the catalog `neighborhoods.name` values: the
 * candidate-expansion API derives the request slug from the same name.
 *
 * Aliases are matched after `normaliseItalian`, so they are written already
 * lowercased and without accents or apostrophes. Keep every alias unambiguous:
 * an alias must identify exactly one zone.
 */
export const NEIGHBORHOOD_LEXICON = [
  { value: 'Brera', aliases: ['brera'] },
  { value: 'Navigli', aliases: ['navigli', 'naviglio grande', 'naviglio pavese'] },
  { value: 'Darsena', aliases: ['darsena'] },
  { value: 'Porta Ticinese', aliases: ['porta ticinese', 'ticinese', 'colonne di san lorenzo'] },
  { value: 'Porta Romana', aliases: ['porta romana'] },
  { value: 'Duomo', aliases: ['duomo', 'piazza duomo', 'galleria vittorio emanuele'] },
  { value: 'Isola', aliases: ['isola'] },
  { value: 'Moscova', aliases: ['moscova'] },
  { value: 'Porta Venezia', aliases: ['porta venezia'] },
  { value: 'Monumentale', aliases: ['monumentale', 'cimitero monumentale', 'porta volta'] },
  {
    value: 'Quadrilatero della moda',
    aliases: ['quadrilatero della moda', 'quadrilatero', 'montenapoleone', 'monte napoleone', 'via della spiga'],
  },
  {
    value: 'Porta Garibaldi',
    aliases: ['porta garibaldi', 'garibaldi', 'corso como', 'porta nuova', 'gae aulenti'],
  },
  { value: 'Sempione', aliases: ['sempione', 'parco sempione', 'arco della pace'] },
  { value: 'Tortona', aliases: ['tortona', 'zona tortona'] },
  { value: 'NoLo', aliases: ['nolo'] },
  { value: 'Cinque Vie', aliases: ['cinque vie', '5 vie'] },
  { value: 'Magenta', aliases: ['magenta', 'corso magenta', 'conciliazione'] },
  { value: 'Sarpi', aliases: ['sarpi', 'paolo sarpi', 'chinatown'] },
  { value: 'Bicocca', aliases: ['bicocca'] },
  { value: 'Lambrate', aliases: ['lambrate'] },
  { value: 'Sant’Ambrogio', aliases: ['sant ambrogio'] },
  { value: 'Città Studi', aliases: ['citta studi', 'piola'] },
] as const;

export type NeighborhoodName = (typeof NEIGHBORHOOD_LEXICON)[number]['value'];

export const NEIGHBORHOOD_NAMES = NEIGHBORHOOD_LEXICON.map(
  (entry) => entry.value,
) as readonly NeighborhoodName[];
