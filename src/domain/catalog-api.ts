export const CATALOG_API_VERSION = 'tre-catalog-v1' as const;

export type CatalogSort = 'relevance' | 'distance' | 'price' | 'rating' | 'quality';

export type CatalogVenueSummary = {
  id: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  category: { slug: string; name: string };
  subcategorySlug: string | null;
  neighborhood: { slug: string; name: string } | null;
  municipality: number | null;
  location: { latitude: number; longitude: number };
  formattedAddress: string;
  price: { level: number | null; averageSpendCents: number | null; currency: 'EUR' };
  ratings: Array<{
    sourceKey: string;
    sourceName: string;
    value: number;
    scale: number;
    count: number;
    observedAt: string;
    sourceUrl: string;
  }>;
  primaryImage: { url: string; alt: string } | null;
  services: string[];
  verification: {
    maturity: 'bronze' | 'silver' | 'gold' | 'platinum';
    qualityScore: number;
    confidenceScore: number;
    verifiedAt: string | null;
  };
  distanceMeters: number | null;
};

export type CatalogListResponse = {
  version: typeof CATALOG_API_VERSION;
  data: CatalogVenueSummary[];
  pagination: { nextCursor: string | null; limit: number; hasMore: boolean };
  meta: { sort: CatalogSort; generatedAt: string };
};

export type CatalogDetailResponse = {
  version: typeof CATALOG_API_VERSION;
  data: Record<string, unknown>;
};

export type CatalogProblem = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  requestId?: string;
};
