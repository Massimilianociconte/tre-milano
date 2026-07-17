import { describe, expect, it } from 'vitest';
import { venues } from '../data/venues';
import { validateProductionCollections, type CuratedCollectionDefinition } from './collections';

describe('gate collezioni editoriali', () => {
  it('non permette una production senza collezioni pubblicate', () => {
    expect(validateProductionCollections([], venues)).toContain('Manca almeno una collezione editoriale con status published.');
  });

  it('rifiuta slug mancanti, fixture e collezioni sotto il minimo', () => {
    const definition: CuratedCollectionDefinition = {
      id: 'night',
      status: 'published',
      title: 'Night',
      description: 'Test',
      guideHref: '/guide/',
      minItems: 2,
      venueSlugs: ['lume-brera', 'inesistente'],
    };
    const errors = validateProductionCollections([definition], venues);
    expect(errors.some((error) => error.includes('lume-brera'))).toBe(true);
    expect(errors.some((error) => error.includes('inesistente'))).toBe(true);
  });
});
