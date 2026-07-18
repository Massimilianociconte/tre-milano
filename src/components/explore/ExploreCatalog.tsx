import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { catalogLocalVisualFor } from '@/components/discovery/catalog-venue-adapter';
import type { CatalogSort, CatalogVenueSummary } from '@/domain/catalog-api';
import { hasCatalogSearchPrivacyRisk } from '@/search/interpretation-contract';

type WeeklyHour = {
  weekday: number;
  sequence?: number;
  opensAt: string | null;
  closesAt: string | null;
  closesNextDay: boolean;
  closed: boolean;
};

type ExploreVenue = CatalogVenueSummary & { weeklyHours?: WeeklyHour[] };

type ExploreResponse = {
  data: ExploreVenue[];
  pagination: { nextCursor: string | null; hasMore: boolean };
};

type FacetOption = { slug: string; name: string; count: number };
type SubcategoryFacetOption = FacetOption & { categorySlug: string };
type PriceFacet = { level: number; count: number };
type ExploreFacets = {
  total: number;
  categories: FacetOption[];
  subcategories: SubcategoryFacetOption[];
  neighborhoods: FacetOption[];
  services: FacetOption[];
  priceLevels: PriceFacet[];
};

type ViewMode = 'gallery' | 'map';
type GeoState = 'idle' | 'requesting' | 'active' | 'denied' | 'unavailable';
type Coordinates = { latitude: number; longitude: number };

function approximateCoordinates(coords: Coordinates): Coordinates {
  return {
    latitude: Math.round(coords.latitude * 1_000) / 1_000,
    longitude: Math.round(coords.longitude * 1_000) / 1_000,
  };
}

const FALLBACK_CATEGORIES: FacetOption[] = [
  { slug: 'ristorante', name: 'Ristoranti', count: 0 },
  { slug: 'altro', name: 'Altri luoghi', count: 0 },
  { slug: 'pasticceria', name: 'Pasticcerie', count: 0 },
  { slug: 'caffe', name: 'Caffè e bar', count: 0 },
  { slug: 'gelateria', name: 'Gelaterie', count: 0 },
  { slug: 'cocktail-bar', name: 'Cocktail bar', count: 0 },
  { slug: 'rooftop', name: 'Rooftop', count: 0 },
  { slug: 'club', name: 'Club', count: 0 },
  { slug: 'hotel', name: 'Hotel', count: 0 },
];

const FALLBACK_NEIGHBORHOODS: FacetOption[] = [
  { slug: 'brera', name: 'Brera', count: 0 },
  { slug: 'duomo', name: 'Duomo', count: 0 },
  { slug: 'navigli', name: 'Navigli', count: 0 },
  { slug: 'porta-romana', name: 'Porta Romana', count: 0 },
  { slug: 'porta-venezia', name: 'Porta Venezia', count: 0 },
  { slug: 'porta-garibaldi', name: 'Porta Garibaldi', count: 0 },
  { slug: 'isola', name: 'Isola', count: 0 },
  { slug: 'quadrilatero-della-moda', name: 'Quadrilatero della moda', count: 0 },
];

const SERVICE_LABELS: Record<string, string> = {
  'accesso-sedia-rotelle': 'Accesso in sedia a rotelle',
  'bagno-accessibile': 'Bagno accessibile',
  'tavoli-esterni': 'Spazi esterni',
  terrazza: 'Terrazza',
  prenotazione: 'Prenotazione',
  'musica-live': 'Musica dal vivo',
  'opzioni-vegane': 'Opzioni vegane',
  'opzioni-senza-glutine': 'Senza glutine',
  parcheggio: 'Parcheggio',
  'wheelchair-access': 'Accesso in sedia a rotelle',
  'accessible-bathroom': 'Bagno accessibile',
  'outdoor-seating': 'Spazi esterni',
  terrace: 'Terrazza',
  reservations: 'Prenotazione',
  'live-music': 'Musica dal vivo',
  'vegan-options': 'Opzioni vegane',
  'gluten-free-options': 'Senza glutine',
  'pet-friendly': 'Pet friendly',
  parking: 'Parcheggio',
  wifi: 'Wi-Fi',
};

const ATMOSPHERE_FILTERS = [
  { value: 'elegante', label: 'Elegante', query: 'elegante' },
  { value: 'intimo', label: 'Intimo', query: 'intimo' },
  { value: 'tranquillo', label: 'Tranquillo', query: 'tranquillo' },
  { value: 'panoramico', label: 'Panoramico', query: 'panoramico' },
  { value: 'romantico', label: 'Romantico', query: 'romantico' },
  { value: 'creativo', label: 'Creativo', query: 'creativo' },
  { value: 'vivace', label: 'Vivace', query: 'vivace' },
] as const;

const OCCASION_FILTERS = [
  { value: 'aperitivo', label: 'Aperitivo', query: 'aperitivo' },
  { value: 'cena', label: 'Cena', query: 'cena' },
  { value: 'pranzo', label: 'Pranzo', query: 'pranzo' },
  { value: 'dopo-cena', label: 'Dopo cena', query: 'dopo cena' },
  { value: 'brunch', label: 'Brunch', query: 'brunch' },
  { value: 'colazione', label: 'Colazione', query: 'colazione' },
  { value: 'evento-privato', label: 'Evento privato', query: 'eventi privati' },
] as const;

const ACCESSIBILITY_SERVICES = new Set([
  'accesso-sedia-rotelle', 'bagno-accessibile', 'wheelchair-access', 'accessible-bathroom',
]);
const DIETARY_SERVICES = new Set([
  'opzioni-vegane', 'opzioni-senza-glutine', 'vegan-options', 'gluten-free-options',
]);

// Il catalogo è sempre same-origin. In sviluppo va eseguito tramite Netlify
// Dev; se le Functions non sono disponibili mostriamo lo stato di errore
// esplicito senza sostituire i dati con fixture.
const CATALOG_API_ENABLED = true;
const PAGE_SIZE = 24;
const ALLOWED_SORTS = new Set<CatalogSort>(['relevance', 'distance', 'price', 'rating', 'quality', 'name', 'newest']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFacetOption(value: unknown): value is FacetOption {
  return isRecord(value)
    && typeof value.slug === 'string'
    && typeof value.name === 'string'
    && Number.isFinite(Number(value.count));
}

function isSubcategoryFacetOption(value: unknown): value is SubcategoryFacetOption {
  return isFacetOption(value)
    && typeof (value as Record<string, unknown>).categorySlug === 'string';
}

function parseFacets(value: unknown): ExploreFacets | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  const data = value.data;
  const categories = Array.isArray(data.categories) ? data.categories.filter(isFacetOption) : [];
  const subcategories = Array.isArray(data.subcategories)
    ? data.subcategories.filter(isSubcategoryFacetOption)
    : [];
  const neighborhoods = Array.isArray(data.neighborhoods) ? data.neighborhoods.filter(isFacetOption) : [];
  const services = Array.isArray(data.services) ? data.services.filter(isFacetOption) : [];
  const priceLevels = Array.isArray(data.priceLevels)
    ? data.priceLevels.flatMap((item) => isRecord(item) && Number.isInteger(Number(item.level)) && Number.isFinite(Number(item.count))
      ? [{ level: Number(item.level), count: Number(item.count) }]
      : [])
    : [];
  const total = Number(data.total);
  return {
    total: Number.isFinite(total) && total >= 0 ? total : 0,
    categories,
    subcategories,
    neighborhoods,
    services,
    priceLevels,
  };
}

function isExploreVenue(value: unknown): value is ExploreVenue {
  if (!isRecord(value) || !isRecord(value.category) || !isRecord(value.verification)
    || !isRecord(value.location) || !isRecord(value.price)) return false;
  return typeof value.id === 'string'
    && typeof value.slug === 'string'
    && typeof value.name === 'string'
    && typeof value.category.slug === 'string'
    && typeof value.category.name === 'string'
    && typeof value.formattedAddress === 'string'
    && Number.isFinite(Number(value.location.latitude))
    && Number.isFinite(Number(value.location.longitude))
    && typeof value.openNow === 'boolean'
    && ['unverified', 'pending', 'verified', 'disputed', 'rejected'].includes(String(value.verification.status))
    && ['bronze', 'silver', 'gold', 'platinum'].includes(String(value.verification.maturity));
}

function formatDistance(value: number | null) {
  if (value === null) return null;
  if (value < 1_000) return `${Math.max(10, Math.round(value / 10) * 10)} m`;
  return `${(value / 1_000).toLocaleString('it-IT', { maximumFractionDigits: 1 })} km`;
}

function formatService(slug: string) {
  return SERVICE_LABELS[slug] ?? slug.replace(/-/g, ' ');
}

function openingState(venue: ExploreVenue): 'open' | 'closed' | 'unknown' {
  const schedule = venue.weeklyHours;
  if (!Array.isArray(schedule) || !schedule.length) return 'unknown';
  return venue.openNow ? 'open' : 'closed';
}

function visualFor(venue: ExploreVenue) {
  if (venue.primaryImage) {
    try {
      const source = new URL(venue.primaryImage.url);
      if (source.hostname === 'glalvaiuhrohrvauuwcp.supabase.co'
        && source.pathname.startsWith('/storage/v1/object/public/venue-media/')) {
        return {
          path: `/.netlify/images?url=${encodeURIComponent(source.href)}&w=900&h=1124&fit=cover&fm=webp&q=82`,
          alt: venue.primaryImage.alt,
          width: 900,
          height: 1124,
          caption: 'Immagine approvata del locale',
        };
      }
    } catch {
      // Un URL non valido o fuori dall'origine media autorizzata non viene reso.
    }
  }
  if (!['gold', 'platinum'].includes(venue.verification.maturity)) return null;
  const fallback = catalogLocalVisualFor(
    venue.category.name,
    venue.category.slug,
    venue.name,
    venue.primaryImage,
    typeof window === 'undefined' ? undefined : window.location.origin,
  );
  return fallback ? { ...fallback, caption: 'Visual editoriale di categoria' } : null;
}

function compactOptions(options: FacetOption[], fallback: FacetOption[]) {
  return options.length ? options.filter((item) => item.count > 0) : fallback;
}

export default function ExploreCatalog() {
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [queryWarning, setQueryWarning] = useState<string | null>(null);
  const [category, setCategory] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [atmosphere, setAtmosphere] = useState('');
  const [occasion, setOccasion] = useState('');
  const [service, setService] = useState('');
  const [accessibility, setAccessibility] = useState('');
  const [dietary, setDietary] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [openNow, setOpenNow] = useState(false);
  const [sort, setSort] = useState<CatalogSort>('quality');
  const [view, setView] = useState<ViewMode>('gallery');
  const [origin, setOrigin] = useState<Coordinates | null>(null);
  const [geoState, setGeoState] = useState<GeoState>('idle');
  const [facets, setFacets] = useState<ExploreFacets | null>(null);
  const [venues, setVenues] = useState<ExploreVenue[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error' | 'offline'>(
    CATALOG_API_ENABLED ? 'idle' : 'offline',
  );
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialSort = params.get('sort') as CatalogSort | null;
    setCategory(params.get('category') ?? '');
    setSubcategory(params.get('subcategory') ?? '');
    setNeighborhood(params.get('neighborhood') ?? '');
    setAtmosphere(params.get('atmosphere') ?? '');
    setOccasion(params.get('occasion') ?? '');
    setService(params.get('service') ?? '');
    setAccessibility(params.get('accessibility') ?? '');
    setDietary(params.get('dietary') ?? '');
    setPriceMax(params.get('price_max') ?? '');
    setVerifiedOnly(params.get('verified') === '1');
    setOpenNow(params.get('open') === '1');
    setView(params.get('view') === 'map' ? 'map' : 'gallery');
    if (initialSort && ALLOWED_SORTS.has(initialSort)) setSort(initialSort);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || !CATALOG_API_ENABLED) return;
    const controller = new AbortController();
    void fetch('/api/catalog/facets?include_unverified=1', {
      headers: { Accept: 'application/json' }, credentials: 'same-origin', signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) return;
      const parsed = parseFacets(await response.json());
      if (parsed) setFacets(parsed);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [hydrated]);

  const load = useCallback(async (append: boolean, afterCursor: string | null) => {
    if (!CATALOG_API_ENABLED || !hydrated) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setStatus('loading');
    if (!append) setVenues([]);
    try {
      const url = new URL('/api/catalog', window.location.origin);
      url.searchParams.set('include_unverified', verifiedOnly ? '0' : '1');
      url.searchParams.set('limit', String(PAGE_SIZE));
      url.searchParams.set('sort', origin ? 'distance' : sort);
      const atmosphereQuery = ATMOSPHERE_FILTERS.find((item) => item.value === atmosphere)?.query;
      const occasionQuery = OCCASION_FILTERS.find((item) => item.value === occasion)?.query;
      const semanticQuery = [submittedQuery, atmosphereQuery, occasionQuery].filter(Boolean).join(' ');
      if (semanticQuery) url.searchParams.set('q', semanticQuery);
      if (category) url.searchParams.set('category', category);
      if (subcategory) url.searchParams.set('subcategory', subcategory);
      if (neighborhood) url.searchParams.set('neighborhood', neighborhood);
      [service, accessibility, dietary].filter(Boolean).forEach((slug) => {
        url.searchParams.append('service', slug);
      });
      if (priceMax) url.searchParams.set('price_max', priceMax);
      if (openNow) url.searchParams.set('open_now', '1');
      if (origin) {
        url.searchParams.set('lat', String(origin.latitude));
        url.searchParams.set('lng', String(origin.longitude));
        url.searchParams.set('radius_m', '15000');
      }
      if (afterCursor) url.searchParams.set('cursor', afterCursor);
      const response = await fetch(url, {
        headers: { Accept: 'application/json' }, credentials: 'same-origin', signal: controller.signal,
      });
      if (!response.ok) throw new Error(String(response.status));
      const payload = (await response.json()) as ExploreResponse;
      const rows = Array.isArray(payload.data) ? payload.data.filter(isExploreVenue) : [];
      setVenues((current) => append ? [...current, ...rows] : rows);
      setCursor(payload.pagination?.nextCursor ?? null);
      setHasMore(Boolean(payload.pagination?.hasMore));
      setSelectedId((current) => append && current ? current : rows[0]?.id ?? null);
      setStatus('ready');
    } catch {
      if (controller.signal.aborted) return;
      setStatus('error');
    }
  }, [
    accessibility,
    atmosphere,
    category,
    dietary,
    hydrated,
    neighborhood,
    occasion,
    openNow,
    origin,
    priceMax,
    service,
    sort,
    subcategory,
    submittedQuery,
    verifiedOnly,
  ]);

  useEffect(() => {
    void load(false, null);
    return () => requestRef.current?.abort();
  }, [load]);

  useEffect(() => {
    if (!hydrated) return;
    const url = new URL(window.location.href);
    const values: Record<string, string> = {
      category,
      subcategory,
      neighborhood,
      atmosphere,
      occasion,
      service,
      accessibility,
      dietary,
      price_max: priceMax,
      verified: verifiedOnly ? '1' : '',
      open: openNow ? '1' : '',
      sort: sort === 'quality' ? '' : sort,
      view: view === 'map' ? 'map' : '',
    };
    Object.entries(values).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    });
    // Le parole libere possono rivelare preferenze personali: restano nello
    // stato della pagina e non vengono persistite in address bar o history.
    url.searchParams.delete('q');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, [
    accessibility,
    atmosphere,
    category,
    dietary,
    hydrated,
    neighborhood,
    occasion,
    openNow,
    priceMax,
    service,
    sort,
    subcategory,
    verifiedOnly,
    view,
  ]);

  const visibleVenues = venues;
  const selectedVenue = visibleVenues.find((venue) => venue.id === selectedId) ?? visibleVenues[0] ?? null;
  const categories = compactOptions(facets?.categories ?? [], FALLBACK_CATEGORIES);
  const subcategories = (facets?.subcategories ?? [])
    .filter((item) => item.count > 0 && (!category || item.categorySlug === category));
  const neighborhoods = compactOptions(facets?.neighborhoods ?? [], FALLBACK_NEIGHBORHOODS);
  const allServices = (facets?.services ?? []).filter((item) => item.count > 0);
  const accessibilityServices = allServices.filter((item) => ACCESSIBILITY_SERVICES.has(item.slug));
  const dietaryServices = allServices.filter((item) => DIETARY_SERVICES.has(item.slug));
  const services = allServices.filter((item) => (
    !ACCESSIBILITY_SERVICES.has(item.slug) && !DIETARY_SERVICES.has(item.slug)
  ));
  const availablePriceLevels = (facets?.priceLevels ?? []).filter((item) => item.count > 0);

  const summary = useMemo(() => {
    if (status !== 'ready') return '';
    if (!visibleVenues.length) return openNow
      ? 'Nessun locale risulta aperto ora con orari verificati nell’intero catalogo.'
      : 'Nessun locale trovato con questi filtri.';
    const total = !verifiedOnly && facets?.total ? facets.total : null;
    const noActiveFilter = !submittedQuery && !category && !subcategory && !neighborhood
      && !atmosphere && !occasion && !service && !accessibility && !dietary && !priceMax
      && !openNow && !origin;
    const prefix = total && noActiveFilter
      ? `${total.toLocaleString('it-IT')} locali nel catalogo`
      : visibleVenues.length === 1 && !hasMore
        ? '1 locale trovato'
        : `${visibleVenues.length}${hasMore ? '+' : ''} locali trovati`;
    return `${prefix}${submittedQuery ? ` per “${submittedQuery}”` : ''}`;
  }, [
    accessibility,
    atmosphere,
    category,
    dietary,
    facets?.total,
    hasMore,
    neighborhood,
    occasion,
    openNow,
    origin,
    priceMax,
    service,
    status,
    subcategory,
    submittedQuery,
    verifiedOnly,
    visibleVenues.length,
  ]);

  const resetFilters = () => {
    setQuery('');
    setSubmittedQuery('');
    setQueryWarning(null);
    setCategory('');
    setSubcategory('');
    setNeighborhood('');
    setAtmosphere('');
    setOccasion('');
    setService('');
    setAccessibility('');
    setDietary('');
    setPriceMax('');
    setVerifiedOnly(false);
    setOpenNow(false);
    setSort('quality');
    setOrigin(null);
    setGeoState('idle');
  };

  const requestLocation = () => {
    if (origin) {
      setOrigin(null);
      setGeoState('idle');
      return;
    }
    if (!navigator.geolocation) {
      setGeoState('unavailable');
      return;
    }
    setGeoState('requesting');
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      // Circa 110 m di risoluzione: sufficiente per la distanza urbana senza
      // inoltrare al provider coordinate GPS più precise del necessario.
      const next = approximateCoordinates({ latitude: coords.latitude, longitude: coords.longitude });
      const isMilan = next.latitude >= 45.35 && next.latitude <= 45.58 && next.longitude >= 8.98 && next.longitude <= 9.34;
      if (!isMilan) {
        setGeoState('unavailable');
        return;
      }
      setOrigin(next);
      setGeoState('active');
    }, (error) => setGeoState(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable'), {
      enableHighAccuracy: false, timeout: 6_000, maximumAge: 300_000,
    });
  };

  return (
    <section className="explore" aria-label="Esplora il catalogo dei locali di Milano" aria-busy={status === 'loading'}>
      <div className="explore__toolbar">
        <form className="explore__filters" onSubmit={(event) => {
          event.preventDefault();
          const nextQuery = query.normalize('NFKC').replace(/\s+/gu, ' ').trim();
          if (nextQuery && hasCatalogSearchPrivacyRisk(nextQuery)) {
            setQueryWarning('Per proteggere la tua privacy, cerca un luogo o una caratteristica senza inserire nomi, contatti o indirizzi personali.');
            return;
          }
          setQueryWarning(null);
          setSubmittedQuery(nextQuery);
        }}>
          <div className="explore__filters-heading">
            <span><small>Curatela urbana</small><strong>Trova il tuo prossimo luogo</strong></span>
            <button className="explore__reset" type="button" onClick={resetFilters}>Azzera filtri</button>
          </div>
          <label className="explore__field explore__search">
            <span>Nome o parola chiave</span>
            <span className="explore__input-wrap"><i aria-hidden="true">⌕</i><input type="search" value={query} maxLength={120} aria-describedby={queryWarning ? 'explore-query-warning' : undefined} placeholder="Es. terrazza, jazz, cena…" onChange={(event) => { setQuery(event.target.value); setQueryWarning(null); }} /></span>
          </label>
          {queryWarning ? <p id="explore-query-warning" className="explore__query-warning" role="alert">{queryWarning}</p> : null}
          <label className="explore__field">
            <span>Categoria</span>
            <select aria-label="Categoria" value={category} onChange={(event) => { setCategory(event.target.value); setSubcategory(''); }}>
              <option value="">Tutte</option>
              {categories.map((item) => <option key={item.slug} value={item.slug}>{item.name}{item.count ? ` · ${item.count}` : ''}</option>)}
            </select>
          </label>
          <label className="explore__field">
            <span>Sottocategoria</span>
            <select aria-label="Sottocategoria" value={subcategory} onChange={(event) => setSubcategory(event.target.value)} disabled={!subcategories.length}>
              <option value="">{subcategories.length ? 'Tutte le sottocategorie' : 'Nessun dato disponibile'}</option>
              {subcategories.map((item) => <option key={item.slug} value={item.slug}>{item.name} · {item.count}</option>)}
            </select>
          </label>
          <label className="explore__field">
            <span>Quartiere</span>
            <select aria-label="Quartiere" value={neighborhood} onChange={(event) => setNeighborhood(event.target.value)}>
              <option value="">Tutta Milano</option>
              {neighborhoods.map((item) => <option key={item.slug} value={item.slug}>{item.name}{item.count ? ` · ${item.count}` : ''}</option>)}
            </select>
          </label>
          <label className="explore__field">
            <span>Atmosfera editoriale</span>
            <select aria-label="Atmosfera" value={atmosphere} onChange={(event) => setAtmosphere(event.target.value)}>
              <option value="">Qualsiasi atmosfera</option>
              {ATMOSPHERE_FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label className="explore__field">
            <span>Occasione editoriale</span>
            <select aria-label="Occasione" value={occasion} onChange={(event) => setOccasion(event.target.value)}>
              <option value="">Qualsiasi occasione</option>
              {OCCASION_FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label className="explore__field">
            <span>Servizio verificato</span>
            <select aria-label="Servizio verificato" value={service} onChange={(event) => setService(event.target.value)} disabled={!services.length}>
              <option value="">{services.length ? 'Qualsiasi servizio' : 'Nessun dato disponibile'}</option>
              {services.map((item) => <option key={item.slug} value={item.slug}>{formatService(item.slug)} · {item.count}</option>)}
            </select>
          </label>
          <label className="explore__field">
            <span>Accessibilità verificata</span>
            <select aria-label="Accessibilità" value={accessibility} onChange={(event) => setAccessibility(event.target.value)} disabled={!accessibilityServices.length}>
              <option value="">{accessibilityServices.length ? 'Qualsiasi requisito' : 'Dati in verifica'}</option>
              {accessibilityServices.map((item) => <option key={item.slug} value={item.slug}>{formatService(item.slug)} · {item.count}</option>)}
            </select>
          </label>
          <label className="explore__field">
            <span>Opzioni alimentari verificate</span>
            <select aria-label="Opzioni alimentari" value={dietary} onChange={(event) => setDietary(event.target.value)} disabled={!dietaryServices.length}>
              <option value="">{dietaryServices.length ? 'Qualsiasi opzione' : 'Dati in verifica'}</option>
              {dietaryServices.map((item) => <option key={item.slug} value={item.slug}>{formatService(item.slug)} · {item.count}</option>)}
            </select>
          </label>
          <label className="explore__field">
            <span>Fascia di prezzo</span>
            <select aria-label="Fascia di prezzo" value={priceMax} onChange={(event) => setPriceMax(event.target.value)} disabled={!availablePriceLevels.length}>
              <option value="">{availablePriceLevels.length ? 'Qualsiasi' : 'Prezzi non sufficienti'}</option>
              {availablePriceLevels.map((item) => <option key={item.level} value={item.level}>Fino a {'€'.repeat(item.level)} · {item.count}</option>)}
            </select>
          </label>
          <p className="explore__filter-disclosure">Atmosfera e occasione interrogano soltanto i segnali editoriali presenti. Accessibilità, dieta e servizi compaiono solo quando verificati nella scheda.</p>
          <fieldset className="explore__checks">
            <legend>Affidabilità</legend>
            <label><input type="checkbox" checked={verifiedOnly} onChange={(event) => setVerifiedOnly(event.target.checked)} /><span>Solo verificati</span></label>
            <label><input type="checkbox" checked={openNow} onChange={(event) => setOpenNow(event.target.checked)} /><span>Aperti ora</span></label>
          </fieldset>
          <button className="explore__submit" type="submit">Cerca nel catalogo <span aria-hidden="true">→</span></button>
        </form>
      </div>

      <div className="explore__catalog-head">
        <div>
          <p className="editorial-eyebrow">Archivio dei luoghi</p>
          <h2>La città, stanza per stanza.</h2>
          <p className="explore__summary" role="status" aria-live="polite">{summary || (status === 'loading' ? 'Aggiorno la selezione…' : '')}</p>
        </div>
        <div className="explore__catalog-actions">
          <button type="button" className={`explore__geo${origin ? ' is-active' : ''}`} onClick={requestLocation} disabled={geoState === 'requesting'}>
            <span aria-hidden="true">◇</span>{geoState === 'requesting' ? 'Localizzo…' : origin ? 'Distanza attiva' : 'Vicino a me'}
          </button>
          <label className="explore__sort"><span className="sr-only">Ordina locali</span><select value={sort} disabled={Boolean(origin)} onChange={(event) => setSort(event.target.value as CatalogSort)}>
            <option value="quality">Qualità del record</option>
            <option value="relevance">Rilevanza</option>
            <option value="name">Nome A–Z</option>
            <option value="newest">Più recenti</option>
            <option value="price">Prezzo crescente</option>
            <option value="rating">Valutazione e popolarità</option>
            {origin ? <option value="distance">Distanza</option> : null}
          </select></label>
          <div className="explore__view-switch" aria-label="Vista catalogo">
            <button type="button" aria-pressed={view === 'gallery'} onClick={() => setView('gallery')}>Griglia</button>
            <button type="button" aria-pressed={view === 'map'} onClick={() => setView('map')}>Mappa</button>
          </div>
        </div>
      </div>
      {geoState === 'denied' || geoState === 'unavailable' ? <p className="explore__geo-note" role="status">Posizione non disponibile. Il catalogo continua senza salvare coordinate.</p> : null}

      {status === 'offline' ? <div className="explore__empty"><strong>Catalogo non disponibile in questa anteprima locale.</strong><p>Il browser richiede le API collegate del deploy pubblico.</p></div> : null}
      {status === 'error' ? <div className="explore__empty" role="alert"><strong>Catalogo momentaneamente non raggiungibile.</strong><p>Riprova tra qualche istante; nessun dato viene inventato in sostituzione.</p><button type="button" onClick={() => load(false, null)}>Riprova</button></div> : null}

      <div className={`explore__results explore__results--${view}`}>
        {view === 'map' && visibleVenues.length ? (
          <ExploreMap venues={visibleVenues} selectedId={selectedVenue?.id ?? null} onSelect={(id) => {
            setSelectedId(id);
            document.getElementById(`explore-venue-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }} />
        ) : null}
        <ul className="explore__grid">
          {status === 'loading' && !venues.length ? Array.from({ length: 9 }, (_, index) => (
            <li key={`skeleton-${index}`} className="explore-card explore-card--skeleton" aria-hidden="true"><div className="explore-card__media explore-skeleton" /><div className="explore-card__body"><span className="explore-skeleton explore-skeleton--badge" /><span className="explore-skeleton explore-skeleton--title" /><span className="explore-skeleton explore-skeleton--line" /><span className="explore-skeleton explore-skeleton--short" /></div></li>
          )) : visibleVenues.map((venue, index) => {
            const verified = venue.verification.status === 'verified';
            const visual = visualFor(venue);
            const open = openingState(venue);
            const distance = formatDistance(venue.distanceMeters);
            const selected = selectedVenue?.id === venue.id;
            return (
              <li id={`explore-venue-${venue.id}`} key={venue.id} className={`explore-card${verified ? ' explore-card--verified' : ''}${selected ? ' is-selected' : ''}`} onMouseEnter={() => setSelectedId(venue.id)}>
                {visual ? <figure className="explore-card__media"><img src={visual.path} alt={visual.alt} width={visual.width} height={visual.height} loading={index < 4 ? 'eager' : 'lazy'} /><figcaption>{visual.caption}</figcaption></figure> : <div className="explore-card__index" aria-hidden="true"><span>{String(index + 1).padStart(2, '0')}</span><i>Milano</i></div>}
                <a className="explore-card__body" href={`/locale/?slug=${encodeURIComponent(venue.slug)}`} onFocus={() => setSelectedId(venue.id)}>
                  <span className={`explore-card__badge${verified ? ' is-verified' : ''}`}>{verified ? 'Verificato dalla redazione' : 'Open data · da verificare'}</span>
                  <h3>{venue.name}</h3>
                  <p className="explore-card__meta">{venue.category.name}<span aria-hidden="true">·</span>{venue.neighborhood?.name ?? 'Milano'}</p>
                  <p className="explore-card__address">{venue.formattedAddress}</p>
                  <div className="explore-card__facts">
                    <span>{venue.price.level ? '€'.repeat(venue.price.level) : 'Prezzo n.d.'}</span>
                    {open !== 'unknown' ? <span className={`is-${open}`}>{open === 'open' ? 'Aperto ora' : 'Chiuso ora'}</span> : <span>Orari n.d.</span>}
                    {distance ? <span>{distance}</span> : null}
                  </div>
                  {venue.services.length ? <p className="explore-card__services">{venue.services.slice(0, 3).map(formatService).join(' · ')}</p> : null}
                  <span className="explore-card__cta">Apri il venue passport <b aria-hidden="true">↗</b></span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>

      {status === 'ready' && !visibleVenues.length ? <div className="explore__empty"><strong>Nessun luogo corrisponde a tutti i filtri.</strong><p>Prova ad ampliare zona, prezzo o stato di verifica. I dati mancanti non vengono trasformati in corrispondenze.</p><button type="button" onClick={resetFilters}>Azzera filtri</button></div> : null}
      {status === 'ready' && hasMore && cursor ? <div className="explore__more"><button type="button" onClick={() => load(true, cursor)}>Carica altri luoghi <span aria-hidden="true">↓</span></button></div> : null}
      {status === 'loading' && venues.length ? <p className="explore__loading" role="status">Carico altri locali…</p> : null}
    </section>
  );
}

function ExploreMap({ venues, selectedId, onSelect }: { venues: ExploreVenue[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const [expandedCluster, setExpandedCluster] = useState<string | null>(null);
  const bounds = useMemo(() => {
    const latitudes = venues.map((venue) => venue.location.latitude);
    const longitudes = venues.map((venue) => venue.location.longitude);
    const minLat = Math.min(...latitudes); const maxLat = Math.max(...latitudes);
    const minLng = Math.min(...longitudes); const maxLng = Math.max(...longitudes);
    return { minLat: minLat - 0.008, maxLat: maxLat + 0.008, minLng: minLng - 0.012, maxLng: maxLng + 0.012 };
  }, [venues]);
  const markerGroups = useMemo(() => {
    const groups = new Map<string, Array<{ venue: ExploreVenue; index: number }>>();
    venues.forEach((venue, index) => {
      const key = `${venue.location.latitude.toFixed(3)}:${venue.location.longitude.toFixed(3)}`;
      groups.set(key, [...(groups.get(key) ?? []), { venue, index }]);
    });
    return [...groups.entries()].map(([key, entries]) => {
      const latitude = entries.reduce((sum, entry) => sum + entry.venue.location.latitude, 0) / entries.length;
      const longitude = entries.reduce((sum, entry) => sum + entry.venue.location.longitude, 0) / entries.length;
      const left = 5 + 90 * ((longitude - bounds.minLng) / Math.max(0.001, bounds.maxLng - bounds.minLng));
      const top = 5 + 90 * (1 - ((latitude - bounds.minLat) / Math.max(0.001, bounds.maxLat - bounds.minLat)));
      return { key, entries, left, top };
    });
  }, [bounds, venues]);
  const selected = venues.find((venue) => venue.id === selectedId) ?? venues[0];
  useEffect(() => {
    const selectedGroup = markerGroups.find((group) => group.entries.length > 1
      && group.entries.some((entry) => entry.venue.id === selected?.id));
    if (selectedGroup) setExpandedCluster(selectedGroup.key);
  }, [markerGroups, selected?.id]);
  return (
    <section className="explore-map" aria-label="Mappa dei locali caricati">
      <div className="explore-map__canvas">
        <div className="explore-map__roads" aria-hidden="true" />
        {markerGroups.flatMap((group) => {
          if (group.entries.length === 1) {
            const [{ venue, index }] = group.entries;
            return [<button key={venue.id} type="button" className={`explore-map__marker${venue.id === selected?.id ? ' is-selected' : ''}`} style={{ left: `${group.left}%`, top: `${group.top}%`, '--marker-order': index } as React.CSSProperties} onClick={() => onSelect(venue.id)} aria-label={`Seleziona ${venue.name}, marker ${index + 1}`} aria-pressed={venue.id === selected?.id}><span>{index + 1}</span></button>];
          }
          if (expandedCluster !== group.key) {
            return [<button key={`cluster-${group.key}`} type="button" className="explore-map__marker explore-map__marker--cluster" style={{ left: `${group.left}%`, top: `${group.top}%` }} onClick={() => { setExpandedCluster(group.key); onSelect(group.entries[0].venue.id); }} aria-label={`Espandi ${group.entries.length} locali in questa zona`} aria-expanded="false"><span>{group.entries.length}</span></button>];
          }
          const radius = Math.min(8, 3.8 + group.entries.length * 0.45);
          const expanded = group.entries.map(({ venue, index }, position) => {
            const angle = -Math.PI / 2 + (position * Math.PI * 2) / group.entries.length;
            const left = Math.min(96, Math.max(4, group.left + Math.cos(angle) * radius));
            const top = Math.min(94, Math.max(6, group.top + Math.sin(angle) * radius));
            return <button key={venue.id} type="button" className={`explore-map__marker${venue.id === selected?.id ? ' is-selected' : ''}`} style={{ left: `${left}%`, top: `${top}%`, '--marker-order': index } as React.CSSProperties} onClick={() => onSelect(venue.id)} aria-label={`Seleziona ${venue.name}, marker ${index + 1}`} aria-pressed={venue.id === selected?.id}><span>{index + 1}</span></button>;
          });
          return [<button key={`cluster-${group.key}`} type="button" className="explore-map__marker explore-map__marker--cluster is-expanded" style={{ left: `${group.left}%`, top: `${group.top}%` }} onClick={() => setExpandedCluster(null)} aria-label={`Raggruppa ${group.entries.length} locali in questa zona`} aria-expanded="true"><span>×</span></button>, ...expanded];
        })}
        <span className="explore-map__label explore-map__label--north">MILANO NORD</span>
        <span className="explore-map__label explore-map__label--center">CENTRO</span>
        <span className="explore-map__label explore-map__label--south">NAVIGLI</span>
      </div>
      {selected ? <article className="explore-map__preview"><span className="editorial-eyebrow">Selezione sulla mappa</span><h3>{selected.name}</h3><p>{selected.category.name} · {selected.neighborhood?.name ?? 'Milano'}</p><address>{selected.formattedAddress}</address><a href={`/locale/?slug=${encodeURIComponent(selected.slug)}`}>Apri la scheda <span aria-hidden="true">↗</span></a></article> : null}
      <p className="explore-map__disclosure">Mappa editoriale dei risultati caricati. Le coordinate provengono dalle fonti dichiarate nelle singole schede.</p>
    </section>
  );
}
