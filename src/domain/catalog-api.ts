export const CATALOG_API_VERSION = 'tre-catalog-v1' as const;

export type CatalogSort = 'relevance' | 'distance' | 'price' | 'rating' | 'quality' | 'name' | 'newest';
export type CatalogVerificationStatus = 'unverified' | 'pending' | 'verified' | 'disputed' | 'rejected';

export type CatalogVenueWeeklyHour = {
  weekday: number;
  sequence: number;
  opensAt: string | null;
  closesAt: string | null;
  closesNextDay: boolean;
  closed: boolean;
  verifiedAt: string;
  validUntil: string | null;
};

export type CatalogFacetOption = { slug: string; name: string; count: number };
export type CatalogSubcategoryFacetOption = CatalogFacetOption & { categorySlug: string };

export type CatalogFacets = {
  total: number;
  categories: CatalogFacetOption[];
  subcategories: CatalogSubcategoryFacetOption[];
  neighborhoods: CatalogFacetOption[];
  services: CatalogFacetOption[];
  priceLevels: Array<{ level: number; count: number }>;
};

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
  /** Optional during the rolling migration from the previous list projection. */
  weeklyHours?: CatalogVenueWeeklyHour[];
  /** Verified official website used as provenance for the weekly schedule. */
  hoursSourceUrl?: string | null;
  verification: {
    /** Null only during a rolling deploy against the previous RPC projection. */
    status: CatalogVerificationStatus | null;
    maturity: 'bronze' | 'silver' | 'gold' | 'platinum';
    qualityScore: number;
    confidenceScore: number;
    verifiedAt: string | null;
  };
  /** Authoritative database gate: only true records may enter recommendation ranking. */
  recommendationEligible: boolean;
  /** Evaluated server-side from verified weekly hours and dated exceptions. */
  openNow: boolean;
  distanceMeters: number | null;
};

export type CatalogListResponse = {
  version: typeof CATALOG_API_VERSION;
  data: CatalogVenueSummary[];
  pagination: { nextCursor: string | null; limit: number; hasMore: boolean };
  meta: { sort: CatalogSort; generatedAt: string };
};

export type CatalogFacetsResponse = {
  version: typeof CATALOG_API_VERSION;
  data: CatalogFacets;
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
