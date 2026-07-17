import type { Venue } from '../domain/venue';

export type CuratedCollectionDefinition = {
  id: string;
  status: 'preview' | 'published';
  title: string;
  description: string;
  guideHref: string;
  minItems: number;
  venueSlugs: string[];
};

export const CURATED_COLLECTIONS: CuratedCollectionDefinition[] = [
  {
    id: 'milano-by-night',
    status: 'preview',
    title: 'Milano by Night',
    description: 'Una traccia curata per leggere la città dopo il tramonto, tra terrazze, cocktail bar e tavoli raccolti.',
    guideHref: '/guide/milano-di-sera/',
    minItems: 5,
    venueSlugs: ['quota-ventuno', 'lume-brera', 'sala-nove', 'corte-naviglio', 'ombra-moscova'],
  },
];

export function validateProductionCollections(definitions: CuratedCollectionDefinition[], catalog: Venue[]) {
  const errors: string[] = [];
  const published = definitions.filter((collection) => collection.status === 'published');
  if (!published.length) errors.push('Manca almeno una collezione editoriale con status published.');

  const slugs = new Set(catalog.filter((venue) => venue.recommendationEligible && !venue.fixtureOnly).map((venue) => venue.slug));
  for (const collection of published) {
    const uniqueSlugs = new Set(collection.venueSlugs);
    if (uniqueSlugs.size !== collection.venueSlugs.length) errors.push(`${collection.id}: contiene slug duplicati.`);
    if (uniqueSlugs.size < collection.minItems) errors.push(`${collection.id}: richiede almeno ${collection.minItems} venue.`);
    for (const slug of uniqueSlugs) {
      if (!slugs.has(slug)) errors.push(`${collection.id}: slug Gold mancante o non raccomandabile: ${slug}.`);
    }
  }
  return errors;
}

export function assertProductionCollections(definitions: CuratedCollectionDefinition[], catalog: Venue[]) {
  const errors = validateProductionCollections(definitions, catalog);
  if (errors.length) throw new Error(`Build pubblica bloccata: collezioni editoriali incomplete.\n${errors.map((error) => `- ${error}`).join('\n')}`);
}
