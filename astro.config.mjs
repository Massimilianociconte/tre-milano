import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { loadPublicEnv } from './scripts/load-public-env.mjs';
import { venues } from './src/data/venues.ts';
import { assertProductionCatalog } from './src/domain/catalog-validation.ts';
import { assertProductionCollections, CURATED_COLLECTIONS } from './src/config/collections.ts';

const fallbackSite = 'https://tre-milano.example';
const mode = process.env.NODE_ENV === 'development' ? 'development' : 'production';
const env = loadPublicEnv(process.cwd(), mode);
const site = env.PUBLIC_SITE_URL || fallbackSite;
const requestedPublicBuild = env.PUBLIC_SITE_MODE === 'production' && env.PUBLIC_DATA_MODE === 'gold';

if (requestedPublicBuild) {
  const parsedSite = new URL(site);
  const hostname = parsedSite.hostname.toLowerCase();
  const isSafePublicHost = parsedSite.protocol === 'https:'
    && !hostname.endsWith('.example')
    && !hostname.endsWith('.test')
    && !hostname.endsWith('.invalid')
    && !hostname.endsWith('.local')
    && !['localhost', '127.0.0.1', '0.0.0.0', 'example.com', 'example.org', 'example.net'].includes(hostname);
  if (!isSafePublicHost) {
    throw new Error('Build pubblica bloccata: PUBLIC_SITE_URL deve essere un dominio HTTPS reale prima di abilitare production + gold.');
  }
  assertProductionCatalog(venues);
  assertProductionCollections(CURATED_COLLECTIONS, venues);
}

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'always',
  integrations: [react()],
  vite: {
    build: {
      cssMinify: true,
    },
  },
});
