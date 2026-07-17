import type { APIRoute } from 'astro';
import { SITE } from '@/config/site';

export const GET: APIRoute = ({ site }) => {
  const base = site || new URL(SITE.url);
  const preview = `User-agent: *\nDisallow: /\n\n# Anteprima con fixture: indicizzazione intenzionalmente disattivata.\n`;
  // /cerca/ remains crawlable so engines can read its explicit noindex.
  const privatePaths = 'Disallow: /preferiti/\nDisallow: /profilo/\nDisallow: /api/';
  const production = `User-agent: *\nAllow: /\n${privatePaths}\n\nUser-agent: OAI-SearchBot\nAllow: /\n${privatePaths}\n\nUser-agent: ChatGPT-User\nAllow: /\n${privatePaths}\n\n# Il crawler di training è gestito separatamente dalla ricerca.\nUser-agent: GPTBot\nDisallow: /\n\nSitemap: ${new URL('sitemap-index.xml', base).href}\n`;
  return new Response(SITE.preview ? preview : production, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
