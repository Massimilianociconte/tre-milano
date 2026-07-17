const siteUrl = import.meta.env.PUBLIC_SITE_URL || 'https://tre-milano.example';
const siteMode = import.meta.env.PUBLIC_SITE_MODE || 'preview';
const dataMode = import.meta.env.PUBLIC_DATA_MODE || 'fixture';

function isPublicHttpsUrl(value: string) {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLocaleLowerCase('en-US');
    return parsed.protocol === 'https:'
      && !hostname.endsWith('.example')
      && !hostname.endsWith('.test')
      && !hostname.endsWith('.invalid')
      && !hostname.endsWith('.local')
      && !['localhost', '127.0.0.1', '0.0.0.0', 'example.com', 'example.org', 'example.net'].includes(hostname);
  } catch {
    return false;
  }
}

const publicIndexing = siteMode === 'production' && dataMode === 'gold' && isPublicHttpsUrl(siteUrl);

export const SITE = {
  name: 'TRE Milano',
  shortName: 'TRE',
  url: siteUrl,
  locale: 'it_IT',
  language: 'it-IT',
  preview: !publicIndexing,
  publicIndexing,
  siteMode,
  dataMode,
  description:
    'Tre scelte motivate per decidere dove andare a Milano, filtrate per momento, distanza, budget e atmosfera.',
};
