/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_SITE_MODE?: 'preview' | 'production';
  readonly PUBLIC_SITE_URL?: string;
  readonly PUBLIC_DATA_MODE?: 'fixture' | 'gold';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
