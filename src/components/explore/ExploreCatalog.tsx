import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isPublicHttpsUrl } from '@/domain/venue';
import { SITE } from '@/config/site';

type ExploreVenue = {
  id: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  category: { slug: string; name: string };
  neighborhood: { slug: string; name: string } | null;
  formattedAddress: string;
  price: { level: number | null };
  verification: { maturity: 'bronze' | 'silver' | 'gold' | 'platinum'; verifiedAt: string | null };
};

type ExploreResponse = {
  data: ExploreVenue[];
  pagination: { nextCursor: string | null; hasMore: boolean };
};

const CATEGORIES = [
  { slug: '', label: 'Tutte le categorie' },
  { slug: 'ristorante', label: 'Ristoranti' },
  { slug: 'cocktail-bar', label: 'Cocktail bar' },
  { slug: 'caffe', label: 'Caffè e bar' },
  { slug: 'pasticceria', label: 'Pasticcerie' },
  { slug: 'gelateria', label: 'Gelaterie' },
  { slug: 'enoteca', label: 'Enoteche' },
  { slug: 'pub', label: 'Pub e birrerie' },
  { slug: 'rooftop', label: 'Rooftop' },
  { slug: 'club', label: 'Club' },
  { slug: 'hotel', label: 'Hotel' },
];

const NEIGHBORHOODS = [
  { slug: '', label: 'Tutta Milano' },
  { slug: 'brera', label: 'Brera' },
  { slug: 'duomo', label: 'Duomo' },
  { slug: 'navigli', label: 'Navigli' },
  { slug: 'porta-ticinese', label: 'Porta Ticinese' },
  { slug: 'porta-romana', label: 'Porta Romana' },
  { slug: 'porta-venezia', label: 'Porta Venezia' },
  { slug: 'porta-garibaldi', label: 'Porta Garibaldi' },
  { slug: 'isola', label: 'Isola' },
  { slug: 'monumentale', label: 'Monumentale' },
  { slug: 'quadrilatero-della-moda', label: 'Quadrilatero della moda' },
  { slug: 'sarpi', label: 'Sarpi' },
  { slug: 'nolo', label: 'NoLo' },
  { slug: 'magenta', label: 'Magenta' },
  { slug: 'citta-studi', label: 'Città Studi' },
  { slug: 'bicocca', label: 'Bicocca' },
  { slug: 'lambrate', label: 'Lambrate' },
  { slug: 'sempione', label: 'Sempione' },
];

const CATALOG_API_ENABLED = isPublicHttpsUrl(SITE.url);
const PAGE_SIZE = 24;

function isExploreVenue(value: unknown): value is ExploreVenue {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const category = v.category as Record<string, unknown> | undefined;
  const verification = v.verification as Record<string, unknown> | undefined;
  return typeof v.id === 'string'
    && typeof v.slug === 'string'
    && typeof v.name === 'string'
    && Boolean(category) && typeof category?.name === 'string'
    && typeof v.formattedAddress === 'string'
    && Boolean(verification)
    && ['bronze', 'silver', 'gold', 'platinum'].includes(String(verification?.maturity));
}

export default function ExploreCatalog() {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [category, setCategory] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [venues, setVenues] = useState<ExploreVenue[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error' | 'offline'>(
    CATALOG_API_ENABLED ? 'loading' : 'offline',
  );
  const requestRef = useRef(0);

  const load = useCallback(async (append: boolean, afterCursor: string | null) => {
    if (!CATALOG_API_ENABLED) return;
    const requestId = ++requestRef.current;
    setStatus('loading');
    try {
      const url = new URL('/api/catalog', window.location.origin);
      url.searchParams.set('include_unverified', '1');
      url.searchParams.set('limit', String(PAGE_SIZE));
      url.searchParams.set('sort', submittedQuery ? 'relevance' : 'quality');
      if (submittedQuery) url.searchParams.set('q', submittedQuery);
      if (category) url.searchParams.set('category', category);
      if (neighborhood) url.searchParams.set('neighborhood', neighborhood);
      if (afterCursor) url.searchParams.set('cursor', afterCursor);
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(String(response.status));
      const payload = (await response.json()) as ExploreResponse;
      if (requestId !== requestRef.current) return;
      const rows = Array.isArray(payload.data) ? payload.data.filter(isExploreVenue) : [];
      setVenues((current) => (append ? [...current, ...rows] : rows));
      setCursor(payload.pagination?.nextCursor ?? null);
      setHasMore(Boolean(payload.pagination?.hasMore));
      setStatus('ready');
    } catch {
      if (requestId !== requestRef.current) return;
      setStatus('error');
    }
  }, [submittedQuery, category, neighborhood]);

  useEffect(() => {
    load(false, null);
  }, [load]);

  const summary = useMemo(() => {
    if (status !== 'ready') return '';
    if (!venues.length) return 'Nessun locale trovato con questi filtri.';
    return `${venues.length}${hasMore ? '+' : ''} locali${submittedQuery ? ` per “${submittedQuery}”` : ''}`;
  }, [status, venues.length, hasMore, submittedQuery]);

  return (
    <section className="explore" aria-label="Esplora il catalogo dei locali di Milano">
      <form
        className="explore__filters"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmittedQuery(query.trim());
        }}
      >
        <label className="explore__search">
          <span className="sr-only">Cerca per nome o parola chiave</span>
          <input
            type="search"
            value={query}
            maxLength={120}
            placeholder="Nome o parola chiave…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">Categoria</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {CATEGORIES.map((item) => <option key={item.slug} value={item.slug}>{item.label}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">Quartiere</span>
          <select value={neighborhood} onChange={(event) => setNeighborhood(event.target.value)}>
            {NEIGHBORHOODS.map((item) => <option key={item.slug} value={item.slug}>{item.label}</option>)}
          </select>
        </label>
        <button type="submit">Cerca</button>
      </form>

      <p className="explore__summary" role="status">{summary}</p>

      {status === 'offline' ? (
        <div className="explore__empty">
          <strong>Catalogo esplorabile non disponibile in questa anteprima locale.</strong>
          <p>Il browser del catalogo richiede le API collegate del deploy pubblico.</p>
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="explore__empty">
          <strong>Catalogo momentaneamente non raggiungibile.</strong>
          <p>Riprova tra qualche istante; nessun dato viene inventato in sostituzione.</p>
          <button type="button" onClick={() => load(false, null)}>Riprova</button>
        </div>
      ) : null}

      <ul className="explore__grid">
        {status === 'loading' && !venues.length
          ? Array.from({ length: 9 }, (_, index) => (
            <li key={`skeleton-${index}`} className="explore-card explore-card--skeleton" aria-hidden="true">
              <div className="explore-card__body">
                <span className="explore-skeleton explore-skeleton--badge" />
                <span className="explore-skeleton explore-skeleton--title" />
                <span className="explore-skeleton explore-skeleton--line" />
                <span className="explore-skeleton explore-skeleton--line explore-skeleton--short" />
              </div>
            </li>
          ))
          : venues.map((venue) => {
            const verified = venue.verification.maturity === 'gold' || venue.verification.maturity === 'platinum';
            return (
              <li key={venue.id} className={`explore-card${verified ? ' explore-card--verified' : ''}`}>
                <a className="explore-card__body" href={`/locale/?slug=${encodeURIComponent(venue.slug)}`}>
                  <span className={`explore-card__badge${verified ? ' is-verified' : ''}`}>
                    {verified ? 'Verificato' : 'Da verificare · fonte 2023'}
                  </span>
                  <h3>{venue.name.toLocaleLowerCase('it-IT')}</h3>
                  <p className="explore-card__meta">
                    {venue.category.name}
                    {' · '}
                    {venue.neighborhood?.name ?? 'Milano'}
                    {venue.price.level ? ` · ${'€'.repeat(venue.price.level)}` : ''}
                  </p>
                  <p className="explore-card__address">{venue.formattedAddress}</p>
                </a>
              </li>
            );
          })}
      </ul>

      {status === 'ready' && hasMore && cursor ? (
        <div className="explore__more">
          <button type="button" onClick={() => load(true, cursor)}>Mostra altri locali</button>
        </div>
      ) : null}
      {status === 'loading' && venues.length ? <p className="explore__loading">Carico altri locali…</p> : null}
    </section>
  );
}
