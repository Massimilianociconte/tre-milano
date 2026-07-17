import routeManifest from './indexable-routes.json';
import { SITE } from './site';

export type IndexingStatus = 'draft' | 'ready';
export type SitemapSegment = 'hubs' | 'discovery' | 'editorial' | 'trust' | 'entities';

export type RouteIndexPolicy = {
  path: string;
  segment: SitemapSegment;
  status: IndexingStatus;
  lastmod: string;
  changefreq: 'weekly' | 'monthly';
  priority: number;
};

export const INDEXABLE_ROUTES = routeManifest as RouteIndexPolicy[];

export function normalizeRoutePath(pathname: string) {
  if (pathname === '/') return pathname;
  return `${pathname.replace(/\/+$/, '')}/`;
}

export function getRouteIndexPolicy(pathname: string) {
  const normalizedPath = normalizeRoutePath(pathname);
  return INDEXABLE_ROUTES.find((route) => route.path === normalizedPath);
}

export function isRouteIndexable(pathname: string) {
  return SITE.publicIndexing && getRouteIndexPolicy(pathname)?.status === 'ready';
}
