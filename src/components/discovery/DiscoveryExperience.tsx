import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createAnalyticsDispatcher, type WildcardDimension } from '@/analytics/events';
import { SITE } from '@/config/site';
import { venues as catalogVenues } from '@/data/venues';
import { buildSessionTravelEstimates, isWithinMilanDiscoveryArea } from '@/domain/discovery-location';
import { FAVORITES_STORAGE_KEY } from '@/domain/favorites';
import {
  clearLastPodium,
  type LastPodiumSnapshotV1,
  lastPodiumIntentToOverrides,
  readLastPodium,
  writeLastPodium,
} from '@/domain/last-podium';
import {
  isTasteProfileActive,
  parseTasteProfile,
  readTasteProfile,
  TASTE_PROFILE_CHANGE_EVENT,
  TASTE_PROFILE_STORAGE_KEY,
  type TasteProfile,
  type TasteProfileChangeDetail,
  tasteProfileSignalCount,
} from '@/domain/taste-profile';
import { type DiscoveryCoordinates, isPublicHttpsUrl, type RankedVenue, type Venue } from '@/domain/venue';
import { applyRankingOverrides, parseIntent, type RankingContext, type RankingOverrides, rankVenues } from '@/ranking/rank';
import {
  hasSearchPrivacyRisk,
  interpretationToRankingOverrides,
  isSearchInterpretationResponseV1,
  SEARCH_INTERPRETATION_VERSION,
  type SearchInterpretationFallbackReason,
  shouldUseRemoteInterpretation,
  validateSearchQuery,
} from '@/search/interpretation-contract';
import {
  buildCatalogCandidateRequestUrl,
  catalogPayloadToVenues,
  fetchCatalogCandidatePages,
  parseCatalogVenuePayload,
} from './catalog-venue-adapter';
import {
  buildIntentChips,
  buildIntentRemovalOverrides,
  getLocalSuggestions,
  type IntentChip,
  type LocalSuggestion,
} from './intent-ui';

type Props = {
  initialQuery?: string;
  compact?: boolean;
};

type PodiumSnapshot = {
  contextKey: string;
  results: RankedVenue[];
};

type FeedbackCode = 'represents_me' | 'too_far' | 'quieter';
type GeolocationStatus = 'idle' | 'requesting' | 'active' | 'denied' | 'outside-milan' | 'error' | 'unsupported';
type InterpretationStatus = 'idle' | 'local' | 'loading' | 'deepseek' | 'fallback' | 'privacy';
type CatalogStatus = 'loading' | 'live' | 'preview';
type CatalogFallbackReason = 'offline' | 'unavailable' | 'empty' | 'invalid';

type CatalogState = {
  status: CatalogStatus;
  venues: Venue[];
  fallbackReason?: CatalogFallbackReason;
};

type RemoteInterpretation = {
  query: string;
  overrides: RankingOverrides;
};

const quickIntents = ['Aperitivo', 'Cena romantica', 'Vista Duomo', 'Tranquillo'];
const locations = ['Milano', 'Brera', 'Duomo', 'Navigli', 'Porta Romana', 'Porta Venezia', 'Monumentale', 'Quadrilatero della moda'];
const budgets = [30, 40, 60];
const SEARCH_HANDOFF_STORAGE_KEY = 'tre-milano:search-handoff:v1';
const CATALOG_REQUEST_LIMIT = 50;
// A plain `astro preview` has no Netlify Functions. Requiring a configured,
// real HTTPS origin keeps local/static QA free of expected 404 noise while the
// linked Netlify build still boots the live catalog in preview mode.
const CATALOG_API_ENABLED = isPublicHttpsUrl(SITE.url);
const feedbackOptions: Array<{ code: FeedbackCode; label: string }> = [
  { code: 'represents_me', label: 'Mi rappresenta' },
  { code: 'too_far', label: 'Troppo lontano' },
  { code: 'quieter', label: 'Più tranquillo' },
];

function shortVerifiedAt(date: string) {
  return new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' })
    .format(new Date(`${date}T12:00:00Z`))
    .replace('.', '');
}

const ANALYTICS_DIVERGENCES = new Set<WildcardDimension>(['categoria', 'zona', 'occasione', 'atmosfera', 'caratteristica']);

/*
 * Cost guard dell'interprete remoto: la stessa query nella stessa sessione di
 * pagina non deve produrre due chiamate DeepSeek. La cache vive solo in
 * memoria (nessuna persistenza del testo della query, coerente con la privacy
 * policy) ed è limitata alle risposte deterministiche riutilizzabili.
 */
type InterpretationCacheEntry =
  | { kind: 'deepseek'; overrides: RankingOverrides }
  | { kind: 'local_sufficient' };
const INTERPRETATION_CACHE_LIMIT = 30;
const interpretationCache = new Map<string, InterpretationCacheEntry>();

function rememberInterpretation(query: string, entry: InterpretationCacheEntry) {
  interpretationCache.delete(query);
  interpretationCache.set(query, entry);
  if (interpretationCache.size > INTERPRETATION_CACHE_LIMIT) {
    const oldest = interpretationCache.keys().next().value;
    if (oldest !== undefined) interpretationCache.delete(oldest);
  }
}
const MILAN_MAP_BOUNDS = { west: 9.14, east: 9.24, south: 45.44, north: 45.51 } as const;

type MapPosition = { left: number; top: number };

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function buildMapPositions(results: RankedVenue[]): Map<string, MapPosition> {
  const positions = new Map<string, MapPosition>();
  const occupied: MapPosition[] = [];
  const collisionOffsets = [
    { left: 0, top: 0 },
    { left: 18, top: -10 },
    { left: -18, top: 10 },
    { left: 18, top: 12 },
    { left: -18, top: -12 },
    { left: 0, top: 18 },
  ];

  results.forEach((venue, index) => {
    const longitudeProgress = (venue.discoveryLocation.longitude - MILAN_MAP_BOUNDS.west)
      / (MILAN_MAP_BOUNDS.east - MILAN_MAP_BOUNDS.west);
    const latitudeProgress = (venue.discoveryLocation.latitude - MILAN_MAP_BOUNDS.south)
      / (MILAN_MAP_BOUNDS.north - MILAN_MAP_BOUNDS.south);
    const projected = {
      left: clamp(12 + (longitudeProgress * 76), 10, 88),
      top: clamp(12 + ((1 - latitudeProgress) * 66), 10, 78),
    };
    const candidates = collisionOffsets.map((offset) => ({
      left: clamp(projected.left + offset.left, 10, 88),
      top: clamp(projected.top + offset.top, 10, 78),
    }));
    const next = candidates.find((candidate) => occupied.every((position) => (
      // Vertical percentages represent fewer pixels than horizontal ones in
      // the landscape map, hence the small aspect-ratio correction.
      Math.hypot(position.left - candidate.left, (position.top - candidate.top) * 0.72) >= 16
    ))) ?? candidates[index % candidates.length];

    positions.set(venue.id, next);
    occupied.push(next);
  });

  return positions;
}

/*
 * The accepted mockup uses one architectural crown, not a circular badge:
 * broad shoulders rise from two quiet shelves and meet a navy leaf-shaped
 * crest. The three paths share the same anchors so clip, fill and outline
 * remain optically continuous at every card width.
 */
const PODIUM_CROWN_GEOMETRY = {
  hero: {
    clip: 'M 0 .28 C 0 .23 .02 .20 .055 .20 H .27 C .30 .08 .36 .04 .41 .20 C .43 .05 .465 .005 .5 .005 C .535 .005 .57 .05 .59 .20 C .64 .04 .70 .08 .73 .20 H .945 C .98 .20 1 .23 1 .28 V 1 H 0 Z',
    outline: 'M .5 28 C .5 23 2 20 5.5 20 H 27 C 30 8 36 4 41 20 C 43 5 46.5 .5 50 .5 C 53.5 .5 57 5 59 20 C 64 4 70 8 73 20 H 94.5 C 98 20 99.5 23 99.5 28 V 99.5 H .5 Z',
    cap: 'M 41 20 C 43 5 46.5 .5 50 .5 C 53.5 .5 57 5 59 20 C 55 27.5 45 27.5 41 20 Z',
  },
  side: {
    clip: 'M 0 .28 C 0 .23 .02 .20 .055 .20 H .25 C .295 .065 .35 .045 .38 .20 C .405 .05 .455 .005 .5 .005 C .545 .005 .595 .05 .62 .20 C .65 .045 .705 .065 .75 .20 H .945 C .98 .20 1 .23 1 .28 V 1 H 0 Z',
    outline: 'M .5 28 C .5 23 2 20 5.5 20 H 25 C 29.5 6.5 35 4.5 38 20 C 40.5 5 45.5 .5 50 .5 C 54.5 .5 59.5 5 62 20 C 65 4.5 70.5 6.5 75 20 H 94.5 C 98 20 99.5 23 99.5 28 V 99.5 H .5 Z',
    cap: 'M 38 20 C 40.5 5 45.5 .5 50 .5 C 54.5 .5 59.5 5 62 20 C 56.5 27.5 43.5 27.5 38 20 Z',
  },
} as const;

function analyticsDivergence(venue: RankedVenue): { divergenceDimension?: WildcardDimension } {
  const dimension = venue.divergenceDimensions[0];
  return dimension && ANALYTICS_DIVERGENCES.has(dimension as WildcardDimension)
    ? { divergenceDimension: dimension as WildcardDimension }
    : {};
}

function venueDetailHref(venue: Pick<Venue, 'fixtureOnly' | 'slug'>) {
  return venue.fixtureOnly
    ? `/locali/${venue.slug}/`
    : `/locale/?slug=${encodeURIComponent(venue.slug)}`;
}

function Icon({ name }: { name: 'search' | 'sliders' | 'pin' | 'bookmark' | 'arrow' | 'clock' | 'spark' | 'close' | 'share' | 'refresh' | 'plus' | 'minus' }) {
  const paths = {
    search: <><circle cx="11" cy="11" r="6.8" /><path d="m16.2 16.2 4 4" /></>,
    sliders: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></>,
    pin: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    bookmark: <path d="M7 4.5h10a1.5 1.5 0 0 1 1.5 1.5v14l-6.5-4-6.5 4V6A1.5 1.5 0 0 1 7 4.5Z" />,
    arrow: <><path d="M5 12h14" /><path d="m14 7 5 5-5 5" /></>,
    clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>,
    spark: <path d="M12 2c.8 5.3 4.7 9.2 10 10-5.3.8-9.2 4.7-10 10-.8-5.3-4.7-9.2-10-10 5.3-.8 9.2-4.7 10-10Z" />,
    close: <><path d="m6.5 6.5 11 11" /><path d="m17.5 6.5-11 11" /></>,
    share: <><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5" /></>,
    refresh: <><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M6.1 8.5A7 7 0 0 1 18 7l2 5M18 15.5A7 7 0 0 1 6 17l-2-5" /></>,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    minus: <path d="M5 12h14" />,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24">{paths[name]}</svg>;
}

function PodiumCard({ venue, saved, active, onSave, onFocus, onOpen, onShare, onReplace }: {
  venue: RankedVenue;
  saved: boolean;
  active: boolean;
  onSave: () => void;
  onFocus: () => void;
  onOpen: () => void;
  onShare: () => void;
  onReplace: () => void;
}) {
  const roleLabel = {
    'best-fit': 'Su misura',
    'safe-alternative': 'Alternativa',
    'smart-wildcard': 'Wildcard',
  }[venue.role];
  const clipId = `podium-crown-${venue.id}`;
  const shownTravel = venue.sessionTravelEstimate;
  const shownMinutes = shownTravel?.minutes ?? venue.travelEstimate.minutes;
  const shownOrigin = shownTravel?.originLabel ?? venue.travelEstimate.origin.shortLabel;
  const shownTravelDisclosure = shownTravel?.disclosure ?? venue.catalogApiRankingEvidence?.travelDisclosure;
  const crownGeometry = venue.rank === 1 ? PODIUM_CROWN_GEOMETRY.hero : PODIUM_CROWN_GEOMETRY.side;

  return (
    <li
      className={`podium-card${active ? ' is-active' : ''}`}
      data-rank={venue.rank}
      data-venue-id={venue.id}
      aria-current={active ? 'location' : undefined}
      onMouseEnter={onFocus}
      onFocus={onFocus}
    >
      <svg className="podium-card__defs" aria-hidden="true" width="0" height="0">
        <defs>
          <clipPath id={clipId} clipPathUnits="objectBoundingBox">
            <path d={crownGeometry.clip} />
          </clipPath>
        </defs>
      </svg>
      <article className="podium-card__frame" data-crown-lobes="3">
        <span className="sr-only">Posizione {venue.rank}.</span>
        <div className="podium-card__visual" style={{ clipPath: `url(#${clipId})` }}>
          <svg className="podium-card__crown-art" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
            <path className="podium-card__crown-cap" d={crownGeometry.cap} />
            <path className="podium-card__outline" d={crownGeometry.outline} />
          </svg>
          <div className="podium-card__media">
            <img src={venue.image} alt={venue.imageAlt} width={venue.imageWidth} height={venue.imageHeight} loading={venue.rank === 1 ? 'eager' : 'lazy'} />
          </div>
          <span className="podium-card__rank" aria-hidden="true">{venue.rank}</span>
        </div>
        <div className="podium-card__body">
          <div className="podium-card__identity">
            <h3><a href={venueDetailHref(venue)}>{venue.name}</a></h3>
            <p className="podium-card__meta">{venue.category} · {venue.neighborhood}</p>
          </div>
          <dl className="podium-card__facts">
            <div className="podium-card__price">
              <dt>Spesa</dt>
              <dd>
              {venue.pricingKnown === false
                ? <strong className="podium-card__price-unknown"><span>Prezzo da verificare</span><em>Da verificare</em></strong>
                : <strong>{'€'.repeat(venue.priceLevel)} <em>~{venue.averageSpend}</em></strong>}
              </dd>
            </div>
            <div
              className={`podium-card__travel${shownTravel ? ' podium-card__session-travel' : ''}`}
              aria-label={`${shownMinutes} minuti a piedi da ${shownTravel ? 'la tua posizione; stima, non routing' : venue.travelEstimate.origin.label}`}
            >
              <dt>A piedi</dt>
              <dd><strong><Icon name="clock" /><span>{shownMinutes} min</span><span className="podium-card__travel-origin">· {shownOrigin}</span></strong></dd>
              {shownTravelDisclosure ? <small>{shownTravelDisclosure}</small> : null}
            </div>
            <div className="podium-card__evidence" aria-label={`Dati ${venue.fixtureOnly ? 'dimostrativi' : 'verificati'} aggiornati il ${venue.verifiedAt}; confidenza ${Math.round(venue.confidence * 100)} per cento`}>
              <dt><i aria-hidden="true" />{venue.fixtureOnly ? 'Demo' : 'Verificato'}</dt>
              <dd><span className="podium-card__evidence-date">{shortVerifiedAt(venue.verifiedAt)} · </span><strong>{Math.round(venue.confidence * 100)}%</strong></dd>
            </div>
            {venue.rank === 1 ? (
              <div className="podium-card__tradeoff-preview">
                <dt>Trade-off</dt>
                <dd>fit complessivo più alto</dd>
              </div>
            ) : null}
          </dl>
          <div className="podium-card__actions">
            <a className="podium-card__open" href={venueDetailHref(venue)} onFocus={onFocus}>
              <span>Apri scheda</span>
            </a>
            <div className="podium-card__footer">
              <button className="podium-card__save" type="button" aria-label={`${saved ? 'Rimuovi' : 'Salva'} ${venue.name} dai preferiti`} aria-pressed={saved} onClick={onSave}>
                <Icon name="bookmark" />
              </button>
              <details
                className="podium-card__why"
                onToggle={(event) => {
                  if (event.currentTarget.open) onOpen();
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return;
                  event.currentTarget.open = false;
                  event.currentTarget.querySelector<HTMLElement>('summary')?.focus();
                }}
              >
                <summary>{roleLabel}</summary>
                <div>
                  <div className="podium-card__why-header">
                    <strong>Perché questa scelta</strong>
                    <button
                      className="podium-card__why-close"
                      type="button"
                      onClick={(event) => {
                        const details = event.currentTarget.closest('details');
                        if (!details) return;
                        details.open = false;
                        details.querySelector<HTMLElement>('summary')?.focus();
                      }}
                    >
                      <span className="sr-only">Chiudi i dettagli di {venue.name}</span>
                      <Icon name="close" />
                    </button>
                  </div>
                  <p>{venue.reason}</p>
                  <small className="podium-card__tradeoff">{venue.tradeoff}</small>
                  {venue.profileMatches.length ? <small>Profilo locale: {venue.profileMatches.join(' · ')}</small> : null}
                  <small>{venue.fixtureOnly ? 'Dati dimostrativi' : `Verificato ${venue.verifiedAt}`} · confidenza {Math.round(venue.confidence * 100)}%</small>
                  <div className="podium-card__why-actions">
                    <button type="button" onClick={onShare}><Icon name="share" /> Condividi</button>
                    <button type="button" onClick={onReplace}><Icon name="refresh" /> Ricalcola senza</button>
                  </div>
                </div>
              </details>
            </div>
          </div>
        </div>
      </article>
    </li>
  );
}

export default function DiscoveryExperience({ initialQuery, compact = false }: Props) {
  const seededQuery = initialQuery ?? 'aperitivo elegante';
  const [hydrated, setHydrated] = useState(false);
  const [draft, setDraft] = useState(initialQuery ?? '');
  const [query, setQuery] = useState(seededQuery);
  const [activeIntent, setActiveIntent] = useState<string | undefined>(undefined);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [location, setLocation] = useState('Milano');
  const [locationExplicit, setLocationExplicit] = useState(false);
  const [maxSpend, setMaxSpend] = useState<number | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [saved, setSaved] = useState<string[]>([]);
  const [savedReady, setSavedReady] = useState(false);
  const [savedNotice, setSavedNotice] = useState('');
  const [dismissedVenueIds, setDismissedVenueIds] = useState<string[]>([]);
  const [podiumSnapshot, setPodiumSnapshot] = useState<PodiumSnapshot | null>(null);
  const [activeVenue, setActiveVenue] = useState<string | null>(null);
  const [mapZoom, setMapZoom] = useState(1);
  const [removedIntentChipIds, setRemovedIntentChipIds] = useState<string[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [feedbackCode, setFeedbackCode] = useState<FeedbackCode | null>(null);
  const [tasteProfile, setTasteProfile] = useState<TasteProfile | null>(null);
  const [tasteProfileReady, setTasteProfileReady] = useState(false);
  const [sessionOrigin, setSessionOrigin] = useState<DiscoveryCoordinates | null>(null);
  const [geolocationStatus, setGeolocationStatus] = useState<GeolocationStatus>('idle');
  const [restoredLastPodium, setRestoredLastPodium] = useState<LastPodiumSnapshotV1 | null>(null);
  const [lastPodiumSaved, setLastPodiumSaved] = useState(false);
  const [interpretationTarget, setInterpretationTarget] = useState<string | null>(null);
  const [remoteInterpretation, setRemoteInterpretation] = useState<RemoteInterpretation | null>(null);
  const [interpretationStatus, setInterpretationStatus] = useState<InterpretationStatus>('idle');
  const [interpretationFallback, setInterpretationFallback] = useState<SearchInterpretationFallbackReason | null>(null);
  const [catalogState, setCatalogState] = useState<CatalogState>(() => CATALOG_API_ENABLED
    ? { status: 'loading', venues: [] }
    : { status: 'preview', venues: catalogVenues, fallbackReason: 'unavailable' });
  const searchInputRef = useRef<HTMLInputElement>(null);
  const interpretationAbortRef = useRef<AbortController | null>(null);
  const candidateAbortRef = useRef<AbortController | null>(null);
  const completedCandidateRequestsRef = useRef(new Set<string>());
  const analytics = useMemo(() => createAnalyticsDispatcher(), []);
  const queryIntent = useMemo(() => parseIntent(query, activeIntent), [query, activeIntent]);
  const remoteIntentOverrides = useMemo<RankingOverrides>(
    () => remoteInterpretation?.query === query ? remoteInterpretation.overrides : {},
    [query, remoteInterpretation],
  );
  const restoredIntentOverrides = useMemo<RankingOverrides>(
    () => restoredLastPodium
      ? lastPodiumIntentToOverrides(restoredLastPodium.intent) as RankingOverrides
      : {},
    [restoredLastPodium],
  );
  const parsedIntent = useMemo(() => {
    const interpretedIntent = applyRankingOverrides(queryIntent, remoteIntentOverrides);
    return restoredLastPodium
      ? applyRankingOverrides(interpretedIntent, restoredIntentOverrides)
      : interpretedIntent;
  }, [queryIntent, remoteIntentOverrides, restoredIntentOverrides, restoredLastPodium]);
  const removedIntentChipSet = useMemo(() => new Set(removedIntentChipIds), [removedIntentChipIds]);
  const intentChips = useMemo(
    () => buildIntentChips(parsedIntent, removedIntentChipSet),
    [parsedIntent, removedIntentChipSet],
  );
  const intentRemovalOverrides = useMemo(
    () => buildIntentRemovalOverrides(parsedIntent, removedIntentChipSet),
    [parsedIntent, removedIntentChipSet],
  );
  const localSuggestions = useMemo(() => getLocalSuggestions(draft), [draft]);
  const activeCatalog = catalogState.venues;
  const availableVenues = useMemo(
    () => activeCatalog.filter((venue) => (
      !dismissedVenueIds.includes(venue.id)
      && (!restoredLastPodium || restoredLastPodium.venueIds.includes(venue.id))
    )),
    [activeCatalog, dismissedVenueIds, restoredLastPodium],
  );
  const sessionTravelEstimates = useMemo(
    () => sessionOrigin ? buildSessionTravelEstimates(activeCatalog, sessionOrigin) : undefined,
    [activeCatalog, sessionOrigin],
  );
  const rankingContext = useMemo<RankingContext>(
    () => ({ sessionTravelEstimates }),
    [sessionTravelEstimates],
  );
  const rankingOverrides = useMemo<RankingOverrides>(() => ({
      ...remoteIntentOverrides,
      ...restoredIntentOverrides,
      ...intentRemovalOverrides,
      ...(locationExplicit ? { neighborhood: location === 'Milano' ? '' : location } : {}),
      ...(maxSpend ? { maxSpend } : {}),
      ...(onlyOpen ? { requiresOpenNow: true } : {}),
      ...(sessionOrigin ? { travelOriginId: undefined } : {}),
    }), [intentRemovalOverrides, location, locationExplicit, maxSpend, onlyOpen, remoteIntentOverrides, restoredIntentOverrides, sessionOrigin]);
  const effectiveIntent = useMemo(
    () => applyRankingOverrides(parsedIntent, rankingOverrides),
    [parsedIntent, rankingOverrides],
  );
  const candidateRequestUrl = useMemo(() => {
    if (!hydrated || catalogState.status !== 'live') return null;
    return buildCatalogCandidateRequestUrl(
      window.location.origin,
      {
        categories: effectiveIntent.categories,
        neighborhoods: effectiveIntent.neighborhoods,
        requiredServices: effectiveIntent.requiredConcepts,
        requiredDietaryPreferences: effectiveIntent.requiredConcepts,
        atmosphere: effectiveIntent.atmosphere,
        occasions: effectiveIntent.occasions,
        concepts: effectiveIntent.concepts,
      },
    )?.toString() ?? null;
  }, [catalogState.status, effectiveIntent, hydrated]);
  const rankedResults = useMemo(
    () => rankVenues(
      restoredLastPodium ? '' : query,
      restoredLastPodium ? undefined : activeIntent,
      availableVenues,
      rankingOverrides,
      restoredLastPodium ? null : tasteProfile,
      new Date(),
      rankingContext,
    ),
    [query, activeIntent, availableVenues, rankingOverrides, tasteProfile, rankingContext, restoredLastPodium],
  );
  const rankingContextKey = useMemo(
    () => JSON.stringify([
      query,
      activeIntent,
      rankingOverrides,
      restoredLastPodium ? null : tasteProfile,
      sessionTravelEstimates,
      restoredLastPodium?.venueIds,
    ]),
    [query, activeIntent, rankingOverrides, tasteProfile, sessionTravelEstimates, restoredLastPodium],
  );
  const results = podiumSnapshot?.contextKey === rankingContextKey ? podiumSnapshot.results : rankedResults;
  const mapPositions = useMemo(() => buildMapPositions(results), [results]);
  const activeMapVenue = results.find(({ id }) => id === activeVenue) ?? results[0] ?? null;
  const unsupportedConstraints = parsedIntent.unsupportedConstraints;

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!CATALOG_API_ENABLED) return;
    if (!navigator.onLine) {
      setCatalogState({ status: 'preview', venues: catalogVenues, fallbackReason: 'offline' });
      return;
    }

    const controller = new AbortController();
    const requestUrl = new URL('/api/catalog', window.location.origin);
    requestUrl.searchParams.set('limit', String(CATALOG_REQUEST_LIMIT));
    requestUrl.searchParams.set('sort', 'quality');

    void fetch(requestUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error(`catalog_${response.status}`);
      const payload = parseCatalogVenuePayload(await response.json());
      if (!payload) {
        setCatalogState({ status: 'preview', venues: catalogVenues, fallbackReason: 'invalid' });
        return;
      }
      const liveVenues = catalogPayloadToVenues(payload, window.location.origin);
      if (!liveVenues.length) {
        setCatalogState({ status: 'preview', venues: catalogVenues, fallbackReason: 'empty' });
        return;
      }
      setCatalogState({ status: 'live', venues: liveVenues });
      setPodiumSnapshot(null);
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setCatalogState({ status: 'preview', venues: catalogVenues, fallbackReason: 'unavailable' });
      if (error instanceof Error) {
        // Provider/database details intentionally stay out of the UI and analytics.
      }
    });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!results.length) {
      setActiveVenue(null);
      return;
    }
    if (!activeVenue || !results.some(({ id }) => id === activeVenue)) {
      setActiveVenue(results[0].id);
    }
  }, [activeVenue, results]);

  useEffect(() => {
    if (!candidateRequestUrl
      || !navigator.onLine
      || completedCandidateRequestsRef.current.has(candidateRequestUrl)) return;

    candidateAbortRef.current?.abort();
    const controller = new AbortController();
    candidateAbortRef.current = controller;
    completedCandidateRequestsRef.current.add(candidateRequestUrl);

    void fetchCatalogCandidatePages(
      candidateRequestUrl,
      window.location.origin,
      fetch,
      controller.signal,
    ).then((payloads) => {
      const candidates = payloads.flatMap((payload) => (
        catalogPayloadToVenues(payload, window.location.origin)
      ));
      if (!candidates.length) return;
      setCatalogState((current) => {
        if (current.status !== 'live') return current;
        const merged = new Map(current.venues.map((venue) => [venue.id, venue]));
        candidates.forEach((venue) => {
          merged.set(venue.id, venue);
        });
        return { status: 'live', venues: [...merged.values()] };
      });
      setPodiumSnapshot(null);
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      // The unfiltered live catalog remains authoritative and usable. A
      // structured expansion is an optional recall improvement, never a gate.
      if (error instanceof Error) {
        // Provider/database details intentionally stay out of the UI.
      }
    }).finally(() => {
      if (candidateAbortRef.current === controller) candidateAbortRef.current = null;
    });

    return () => controller.abort();
  }, [candidateRequestUrl]);

  useEffect(() => {
    if (!interpretationTarget || interpretationTarget !== query || restoredLastPodium) return;

    interpretationAbortRef.current?.abort();
    setRemoteInterpretation((current) => current?.query === interpretationTarget ? current : null);
    setInterpretationFallback(null);

    if (hasSearchPrivacyRisk(interpretationTarget)) {
      setInterpretationStatus('privacy');
      return;
    }
    if (!shouldUseRemoteInterpretation(interpretationTarget, queryIntent) || !navigator.onLine) {
      setInterpretationStatus('local');
      return;
    }

    const cached = interpretationCache.get(interpretationTarget);
    if (cached) {
      if (cached.kind === 'deepseek') {
        setRemoteInterpretation({ query: interpretationTarget, overrides: cached.overrides });
        setInterpretationStatus('deepseek');
        setInterpretationFallback(null);
        setPodiumSnapshot(null);
      } else {
        setInterpretationStatus('local');
        setInterpretationFallback('local_sufficient');
      }
      return;
    }

    const controller = new AbortController();
    interpretationAbortRef.current = controller;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 2_600);
    setInterpretationStatus('loading');

    void fetch('/api/search/interpret', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: SEARCH_INTERPRETATION_VERSION,
        query: interpretationTarget,
      }),
      credentials: 'same-origin',
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error(`search_interpretation_${response.status}`);
      const payload: unknown = await response.json();
      if (!isSearchInterpretationResponseV1(payload)) throw new Error('search_interpretation_invalid');
      if (interpretationAbortRef.current !== controller) return;
      if (payload.source === 'deepseek') {
        const overrides = interpretationToRankingOverrides(payload.intent);
        rememberInterpretation(interpretationTarget, { kind: 'deepseek', overrides });
        setRemoteInterpretation({
          query: interpretationTarget,
          overrides,
        });
        setInterpretationStatus('deepseek');
        setInterpretationFallback(null);
        setPodiumSnapshot(null);
        setSavedNotice('DeepSeek ha affinato l’intento; il ranking TRE ha ricalcolato il podio.');
        return;
      }
      if (payload.fallbackReason === 'local_sufficient') {
        rememberInterpretation(interpretationTarget, { kind: 'local_sufficient' });
      }
      setInterpretationStatus(
        payload.fallbackReason === 'privacy_guard'
          ? 'privacy'
          : payload.fallbackReason === 'local_sufficient'
            ? 'local'
            : 'fallback',
      );
      setInterpretationFallback(payload.fallbackReason ?? null);
    }).catch((error: unknown) => {
      if (interpretationAbortRef.current !== controller) return;
      if (controller.signal.aborted && !timedOut) return;
      setInterpretationStatus('fallback');
      setInterpretationFallback(timedOut ? 'timeout' : 'upstream_unavailable');
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        // L'errore remoto non viene serializzato né associato alla query.
      }
    }).finally(() => {
      window.clearTimeout(timeoutId);
      if (interpretationAbortRef.current === controller) interpretationAbortRef.current = null;
    });

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [interpretationTarget, query, queryIntent, restoredLastPodium]);

  useEffect(() => {
    const sharedParams = new URLSearchParams(window.location.search);
    const sharedQueryCandidate = sharedParams.get('q');
    const validatedSharedQuery = validateSearchQuery(sharedQueryCandidate);
    let handoff: { query: string; location: string; maxSpend: number | null; onlyOpen: boolean } | null = null;
    if (validatedSharedQuery.ok) {
      try { window.sessionStorage.removeItem(SEARCH_HANDOFF_STORAGE_KEY); } catch { /* best effort */ }
    } else {
      try {
        const rawHandoff = window.sessionStorage.getItem(SEARCH_HANDOFF_STORAGE_KEY);
        window.sessionStorage.removeItem(SEARCH_HANDOFF_STORAGE_KEY);
        const candidate: unknown = rawHandoff ? JSON.parse(rawHandoff) : null;
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
          const value = candidate as Record<string, unknown>;
          const validatedHandoffQuery = validateSearchQuery(value.query);
          if (
            value.version === 1
            && validatedHandoffQuery.ok
            && typeof value.location === 'string'
            && locations.includes(value.location)
            && (value.maxSpend === null || (typeof value.maxSpend === 'number' && budgets.includes(value.maxSpend)))
            && typeof value.onlyOpen === 'boolean'
          ) {
            handoff = {
              query: validatedHandoffQuery.query,
              location: value.location,
              maxSpend: value.maxSpend as number | null,
              onlyOpen: value.onlyOpen,
            };
          }
        }
      } catch {
        // Handoff assente o corrotto: la ricerca iniziale resta utilizzabile.
      }
    }
    const incomingQuery = validatedSharedQuery.ok ? validatedSharedQuery.query : handoff?.query;
    if (incomingQuery) {
      setDraft(incomingQuery);
      setQuery(incomingQuery);
      setActiveIntent(undefined);
      setInterpretationTarget(incomingQuery);
    }
    const incomingLocation = sharedParams.get('zona') || handoff?.location;
    if (incomingLocation && locations.includes(incomingLocation)) {
      setLocation(incomingLocation);
      setLocationExplicit(incomingLocation !== 'Milano');
    } else {
      setLocationExplicit(false);
    }
    const sharedBudgetValue = sharedParams.get('budget');
    const incomingBudget = sharedBudgetValue ? Number(sharedBudgetValue) : handoff?.maxSpend;
    if (typeof incomingBudget === 'number' && budgets.includes(incomingBudget)) setMaxSpend(incomingBudget);
    if (sharedParams.get('aperto') === '1' || handoff?.onlyOpen) setOnlyOpen(true);

    try {
      const cachedPodium = readLastPodium(window.localStorage);
      setLastPodiumSaved(Boolean(cachedPodium));
      if (!navigator.onLine && !incomingQuery && cachedPodium) {
        const cachedVenues = cachedPodium.venueIds
          .map((id) => catalogVenues.find((venue) => venue.id === id))
          .filter((venue): venue is (typeof catalogVenues)[number] => Boolean(venue));
        const cachedOverrides = lastPodiumIntentToOverrides(cachedPodium.intent) as RankingOverrides;
        const revalidated = rankVenues('', undefined, cachedVenues, cachedOverrides, null, new Date());
        const restoredIds = new Set(revalidated.map(({ id }) => id));
        const isStillValid = cachedVenues.length === cachedPodium.venueIds.length
          && revalidated.length === cachedPodium.venueIds.length
          && cachedPodium.venueIds.every((id) => restoredIds.has(id));
        if (isStillValid) {
          setDraft('');
          setQuery('');
          setActiveIntent(undefined);
          setRestoredLastPodium(cachedPodium);
          setSavedNotice('Ultimo podio ripristinato offline con i gate correnti.');
        } else {
          clearLastPodium(window.localStorage);
          setLastPodiumSaved(false);
          setSavedNotice('Ultimo podio rimosso perché non supera più i gate correnti.');
        }
      }
    } catch {
      setLastPodiumSaved(false);
    }

    try {
      const stored = JSON.parse(window.localStorage.getItem(FAVORITES_STORAGE_KEY) || '[]');
      if (Array.isArray(stored)) setSaved(stored.filter((item): item is string => typeof item === 'string'));
    } catch {
      // Preferiti corrotti o storage disabilitato: la ricerca resta sempre utilizzabile.
    }
    setSavedReady(true);
  }, []);

  useEffect(() => {
    try {
      setTasteProfile(readTasteProfile(window.localStorage));
    } catch {
      setTasteProfile(null);
    } finally {
      setTasteProfileReady(true);
    }

    const syncFromStorage = (event: StorageEvent) => {
      if (event.key !== TASTE_PROFILE_STORAGE_KEY) return;
      setTasteProfile(parseTasteProfile(event.newValue));
      setTasteProfileReady(true);
    };
    const syncFromCurrentTab = (event: Event) => {
      const detail = (event as CustomEvent<TasteProfileChangeDetail>).detail;
      setTasteProfile(detail?.profile ?? null);
      setTasteProfileReady(true);
    };

    window.addEventListener('storage', syncFromStorage);
    window.addEventListener(TASTE_PROFILE_CHANGE_EVENT, syncFromCurrentTab);
    return () => {
      window.removeEventListener('storage', syncFromStorage);
      window.removeEventListener(TASTE_PROFILE_CHANGE_EVENT, syncFromCurrentTab);
    };
  }, []);

  useEffect(() => {
    if (!savedReady) return;
    try {
      window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // La persistenza è un miglioramento progressivo, non un requisito per il ranking.
    }
  }, [saved, savedReady]);

  useEffect(() => {
    if (
      !navigator.onLine
      || restoredLastPodium
      || sessionOrigin
      || unsupportedConstraints.length
      || results.length !== 3
    ) return;
    try {
      writeLastPodium(window.localStorage, results.map(({ id }) => id), effectiveIntent);
      setLastPodiumSaved(true);
    } catch {
      // Storage non disponibile o intento non tassonomizzabile: nessun fallback permissivo.
    }
  }, [effectiveIntent, restoredLastPodium, results, sessionOrigin, unsupportedConstraints.length]);

  const commitQuery = (value: string) => {
    const validated = validateSearchQuery(value);
    if (!validated.ok) {
      setSavedNotice('Scrivi una richiesta tra 2 e 320 caratteri.');
      searchInputRef.current?.focus();
      return;
    }
    const nextQuery = validated.query;
    setRestoredLastPodium(null);
    setDismissedVenueIds([]);
    setPodiumSnapshot(null);
    setRemovedIntentChipIds([]);
    setFeedbackCode(null);
    setRemoteInterpretation((current) => current?.query === nextQuery ? current : null);
    if (nextQuery !== query) {
      setInterpretationStatus('idle');
      setInterpretationFallback(null);
    }
    setInterpretationTarget(nextQuery);
    setSuggestionsOpen(false);
    setActiveSuggestionIndex(-1);
    setQuery(nextQuery);
    if (window.location.pathname !== '/cerca/') {
      try {
        window.sessionStorage.setItem(SEARCH_HANDOFF_STORAGE_KEY, JSON.stringify({
          version: 1,
          query: nextQuery,
          location,
          maxSpend,
          onlyOpen,
        }));
        window.location.assign('/cerca/');
      } catch {
        setSavedNotice('Risultati aggiornati qui: il browser non consente l’handoff privato alla pagina di ricerca.');
      }
      return;
    }
    window.history.replaceState({}, '', '/cerca/');
  };

  const submit = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    setActiveIntent(undefined);
    const entryPoint = window.location.search.includes('q=')
      ? 'shared'
      : window.location.pathname === '/'
        ? 'home'
        : window.location.pathname === '/cerca/'
          ? 'search'
          : 'editorial';
    analytics.emit('search_started', {
      entryPoint,
      hasFilters: locationExplicit || maxSpend !== null || onlyOpen,
      hasLocationContext: locationExplicit,
    });
    commitQuery(draft.trim() || seededQuery);
  };

  const selectIntent = (intent: string) => {
    setActiveIntent(intent);
    const addition = intent.toLocaleLowerCase('it-IT');
    setDraft(addition);
    commitQuery(addition);
  };

  const applyFilters = () => {
    setActiveIntent(undefined);
    analytics.emit('search_started', {
      entryPoint: window.location.pathname === '/cerca/' ? 'search' : 'editorial',
      hasFilters: location !== 'Milano' || maxSpend !== null || onlyOpen,
      hasLocationContext: locationExplicit,
    });
    commitQuery(draft.trim() || seededQuery);
    setFiltersOpen(false);
  };

  const chooseSuggestion = (suggestion: LocalSuggestion) => {
    setDraft(suggestion.value);
    setActiveIntent(undefined);
    setSuggestionsOpen(false);
    setActiveSuggestionIndex(-1);
    setSavedNotice(`${suggestion.label} inserito nella ricerca.`);
  };

  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setSuggestionsOpen(false);
      setActiveSuggestionIndex(-1);
      return;
    }
    if (!localSuggestions.length || !['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
    if (event.key === 'Enter' && (!suggestionsOpen || activeSuggestionIndex < 0)) return;
    event.preventDefault();
    if (event.key === 'ArrowDown') {
      setSuggestionsOpen(true);
      setActiveSuggestionIndex((current) => (current + 1 + localSuggestions.length) % localSuggestions.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      setSuggestionsOpen(true);
      setActiveSuggestionIndex((current) => (current <= 0 ? localSuggestions.length - 1 : current - 1));
      return;
    }
    const suggestion = localSuggestions[activeSuggestionIndex];
    if (suggestion) chooseSuggestion(suggestion);
  };

  const removeIntentChip = (chip: IntentChip) => {
    setRemovedIntentChipIds((current) => current.includes(chip.id) ? current : [...current, chip.id]);
    setDismissedVenueIds([]);
    setPodiumSnapshot(null);
    setFeedbackCode(null);
    setSavedNotice(`${chip.label} rimosso per questo calcolo. Una nuova ricerca ripristina tutti i vincoli.`);
  };

  const resetFilters = () => {
    setLocation('Milano');
    setLocationExplicit(false);
    setMaxSpend(null);
    setOnlyOpen(false);
  };

  const chooseLocation = (nextLocation: string) => {
    setLocation(nextLocation);
    setLocationExplicit(true);
    setContextOpen(false);
  };

  const requestForegroundLocation = () => {
    if (!navigator.geolocation) {
      setSessionOrigin(null);
      setGeolocationStatus('unsupported');
      setSavedNotice('Geolocalizzazione non supportata: origine ripristinata al Duomo.');
      return;
    }

    setGeolocationStatus('requesting');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const nextOrigin = { latitude: coords.latitude, longitude: coords.longitude };
        if (!isWithinMilanDiscoveryArea(nextOrigin)) {
          setSessionOrigin(null);
          setGeolocationStatus('outside-milan');
          setSavedNotice('Posizione fuori dall’area di Milano: origine mantenuta al Duomo.');
          return;
        }
        setSessionOrigin(nextOrigin);
        setGeolocationStatus('active');
        setPodiumSnapshot(null);
        setSavedNotice('Posizione usata soltanto in questa sessione. Tempi a piedi stimati, non routing.');
      },
      (error) => {
        setSessionOrigin(null);
        setGeolocationStatus(error.code === 1 ? 'denied' : 'error');
        setSavedNotice(error.code === 1
          ? 'Permesso posizione negato: origine mantenuta al Duomo.'
          : 'Posizione non disponibile: origine mantenuta al Duomo.');
      },
      { enableHighAccuracy: false, timeout: 8_000, maximumAge: 0 },
    );
  };

  const resetTravelOrigin = () => {
    setSessionOrigin(null);
    setGeolocationStatus('idle');
    setPodiumSnapshot(null);
    setSavedNotice('Origine ripristinata al Duomo.');
  };

  const deleteLastPodium = () => {
    try { clearLastPodium(window.localStorage); } catch { /* best effort */ }
    setLastPodiumSaved(false);
    setRestoredLastPodium(null);
    setPodiumSnapshot(null);
    setSavedNotice('Ultimo podio offline cancellato.');
  };

  const toggleSaved = (id: string, name: string) => {
    const removing = saved.includes(id);
    setSaved((current) => removing ? current.filter((item) => item !== id) : [...current, id]);
    setSavedNotice(removing ? `${name} rimosso dai preferiti.` : `${name} salvato nei preferiti.`);
    analytics.emit('venue_saved', { venueId: id, saved: !removing, source: 'podium' });
  };

  const shareVenue = async (venue: RankedVenue) => {
    const url = new URL(venueDetailHref(venue), window.location.origin).toString();
    try {
      if (navigator.share) {
        await navigator.share({ title: `${venue.name} · TRE Milano`, text: venue.reason, url });
        setSavedNotice(`${venue.name} condiviso.`);
        analytics.emit('podium_shared', { resultCount: 1, method: 'native', context: 'individual' });
        return;
      }
      await navigator.clipboard.writeText(url);
      setSavedNotice(`Link di ${venue.name} copiato.`);
      analytics.emit('podium_shared', { resultCount: 1, method: 'clipboard', context: 'individual' });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setSavedNotice('Condivisione non disponibile in questo browser.');
      analytics.emit('podium_shared', { resultCount: 1, method: 'unavailable', context: 'individual' });
    }
  };

  const sharePodium = async () => {
    const url = new URL('/cerca/', window.location.origin);
    url.searchParams.set('q', query);
    if (locationExplicit && location !== 'Milano') url.searchParams.set('zona', location);
    if (maxSpend) url.searchParams.set('budget', String(maxSpend));
    if (onlyOpen) url.searchParams.set('aperto', '1');
    const podiumNames = results.map((venue) => `${venue.rank}. ${venue.name}`).join(' · ');
    const text = `La mia top ${results.length} TRE Milano: ${podiumNames}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'La mia top 3 · TRE Milano', text, url: url.toString() });
        setSavedNotice('Podio condiviso con query e filtri correnti.');
        analytics.emit('podium_shared', { resultCount: results.length, method: 'native', context: 'group' });
        return;
      }
      await navigator.clipboard.writeText(`${text}\n${url.toString()}`);
      setSavedNotice('Podio, query e filtri copiati negli appunti.');
      analytics.emit('podium_shared', { resultCount: results.length, method: 'clipboard', context: 'group' });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setSavedNotice('Condivisione del podio non disponibile in questo browser.');
      analytics.emit('podium_shared', { resultCount: results.length, method: 'unavailable', context: 'group' });
    }
  };

  const replaceVenue = (venue: RankedVenue) => {
    const nextDismissedIds = dismissedVenueIds.includes(venue.id)
      ? dismissedVenueIds
      : [...dismissedVenueIds, venue.id];
    const preservedIds = new Set(results.filter((item) => item.id !== venue.id).map((item) => item.id));
    const replacement = activeCatalog
      .filter((item) => !nextDismissedIds.includes(item.id) && !preservedIds.has(item.id))
      .flatMap((item) => rankVenues(query, activeIntent, [item], rankingOverrides, tasteProfile, new Date(), rankingContext).slice(0, 1))
      .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, 'it-IT'))[0];

    if (!replacement) {
      setSavedNotice(`Nessuna sostituzione affidabile disponibile per ${venue.name} senza rilassare i vincoli.`);
      analytics.emit('wildcard_replaced', {
        venueId: venue.id,
        replacementFound: false,
        ...analyticsDivergence(venue),
      });
      return;
    }

    const replacementForSlot: RankedVenue = {
      ...replacement,
      rank: venue.rank,
      role: venue.role,
      reason: `Sostituzione coerente: ${replacement.reason.replace(/^[^:]+:\s*/, '')}`,
    };
    setDismissedVenueIds(nextDismissedIds);
    setPodiumSnapshot({
      contextKey: rankingContextKey,
      results: results.map((item) => item.id === venue.id ? replacementForSlot : item),
    });
    setSavedNotice(`${venue.name} sostituito con ${replacement.name}; le altre due scelte sono rimaste invariate.`);
    analytics.emit('wildcard_replaced', {
      venueId: venue.id,
      replacementFound: true,
      ...analyticsDivergence(venue),
    });
  };

  const submitFeedback = (code: FeedbackCode) => {
    setFeedbackCode(code);
    setSavedNotice('Feedback registrato solo in questa sessione. Non viene salvato né inviato.');
    analytics.emit('feedback_submitted', { target: 'podium', code });
  };

  const openCard = (venue: RankedVenue) => {
    analytics.emit('card_opened', { venueId: venue.id, rank: venue.rank, role: venue.role });
    const divergence = analyticsDivergence(venue);
    if (venue.rank === 3 && divergence.divergenceDimension) {
      analytics.emit('wildcard_explained', { venueId: venue.id, divergenceDimension: divergence.divergenceDimension });
    }
  };

  const hasFilters = location !== 'Milano' || maxSpend !== null || onlyOpen;
  const inferredQueryLocation = locations.slice(1).find((item) => query.toLocaleLowerCase('it-IT').includes(item.toLocaleLowerCase('it-IT')));
  const contextLocation = locationExplicit ? location : (inferredQueryLocation || location);
  const travelOriginLabel = sessionOrigin ? 'la tua posizione' : results[0]?.travelEstimate.origin.shortLabel
    ?? availableVenues[0]?.travelEstimate.origin.shortLabel
    ?? 'origine dichiarata';
  const profileSignals = tasteProfileSignalCount(tasteProfile);
  const profileIsActive = !restoredLastPodium && isTasteProfileActive(tasteProfile);
  const profileMatchedResults = results.some((venue) => venue.reasonCodes.includes('PROFILE_MATCH'));
  const profileSummaryTitle = profileIsActive
    ? 'Profilo di gusto attivo'
    : tasteProfile?.state === 'suspended'
      ? 'Profilo di gusto sospeso'
      : 'Profilo non applicato al podio offline';
  const profileSummaryMeta = profileIsActive
    ? `${profileSignals} ${profileSignals === 1 ? 'preferenza' : 'preferenze'}`
    : 'Nessun impatto';
  const profileDetailCopy = profileIsActive
    ? profileMatchedResults
      ? 'Le preferenze dichiarate hanno affinato il podio come segnale lieve. Budget, distanza, esclusioni e requisiti della ricerca restano sempre prioritari.'
      : 'Nessuna affinità esplicita è presente nelle tre scelte. Il profilo non ha alterato l’ordine e i vincoli della ricerca restano prioritari.'
    : tasteProfile?.state === 'suspended'
      ? 'Il profilo è sospeso e non influenza il podio. Puoi riattivarlo dalla pagina Profilo.'
      : 'Il podio ripristinato offline conserva i propri criteri e non viene ricalcolato con il profilo locale.';
  const interpretationCopy = {
    idle: {
      title: 'Ricerca ibrida',
      detail: 'Le richieste complesse possono essere interpretate da DeepSeek. Non inserire dati personali.',
    },
    local: {
      title: 'Interpretazione locale',
      detail: 'La tassonomia TRE ha già compreso la richiesta: nessuna chiamata remota.',
    },
    loading: {
      title: 'Sto affinando l’intento',
      detail: 'Il podio locale è già pronto; DeepSeek sta interpretando le sfumature della richiesta.',
    },
    deepseek: {
      title: 'Intento affinato',
      detail: 'DeepSeek ha tradotto la richiesta; vincoli, dati e ranking restano nel motore TRE.',
    },
    privacy: {
      title: 'Protezione dati attiva',
      detail: 'Questa richiesta resta locale perché può contenere informazioni personali o sensibili.',
    },
    fallback: {
      title: 'Risultati locali immediati',
      detail: interpretationFallback === 'not_configured'
        ? 'L’interprete DeepSeek non è ancora configurato; il ranking deterministico resta operativo.'
        : interpretationFallback === 'timeout'
          ? 'DeepSeek non ha risposto entro il limite: nessuna attesa aggiuntiva, nessun vincolo rilassato.'
          : 'L’interprete remoto non è disponibile: il ranking deterministico resta operativo.',
    },
  }[interpretationStatus];
  const catalogStatusCopy = catalogState.status === 'live'
    ? {
        title: 'Catalogo verificato collegato',
        detail: `${activeCatalog.length} ${activeCatalog.length === 1 ? 'locale idoneo' : 'locali idonei'} disponibili per il ranking TRE.`,
      }
    : catalogState.status === 'loading'
      ? {
          title: 'Collegamento al catalogo',
          detail: 'Carico i locali verificati prima di calcolare il podio.',
        }
      : {
          title: 'Anteprima dimostrativa attiva',
          detail: catalogState.fallbackReason === 'offline'
            ? 'Sei offline: mostriamo soltanto le fixture dichiarate della preview.'
            : catalogState.fallbackReason === 'empty'
              ? 'Il catalogo non contiene ancora candidati Gold idonei: mostriamo soltanto la preview dichiarata.'
              : catalogState.fallbackReason === 'invalid'
                ? 'La risposta del catalogo non supera la validazione: mostriamo soltanto la preview dichiarata.'
                : 'Il catalogo non è disponibile: mostriamo soltanto le fixture dichiarate della preview.',
        };

  useEffect(() => {
    analytics.emit('intent_parsed', {
      constraintCount: intentChips.length + unsupportedConstraints.length,
      hardConstraintCount: intentChips.filter(({ hard }) => hard).length + unsupportedConstraints.length,
      unsupportedConstraintCount: unsupportedConstraints.length,
    });
  }, [analytics, intentChips, unsupportedConstraints]);

  useEffect(() => {
    if (catalogState.status === 'loading') return;
    analytics.emit('podium_shown', {
      resultCount: results.length,
      hasWildcard: results.some(({ role }) => role === 'smart-wildcard'),
      profileApplied: profileIsActive && profileSignals > 0,
    });
    if (results.length < 3) {
      analytics.emit('podium_low_confidence', {
        resultCount: results.length,
        reason: unsupportedConstraints.length ? 'unsupported_constraint' : 'insufficient_candidates',
      });
    }
  }, [analytics, catalogState.status, profileIsActive, profileSignals, results, unsupportedConstraints.length]);

  return (
    <section className={`discovery ${compact ? 'discovery--compact' : ''}`} aria-labelledby="podium-title">
      <form className="search-composer" role="search" action="/cerca/" method="get" onSubmit={submit} aria-busy={!hydrated}>
        <label htmlFor="tre-search">Descrivi la serata che vuoi</label>
        <div className="search-composer__field">
          <Icon name="search" />
          <input
            ref={searchInputRef}
            id="tre-search"
            name="q"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={suggestionsOpen && localSuggestions.length > 0}
            aria-controls="tre-local-suggestions"
            aria-activedescendant={suggestionsOpen && activeSuggestionIndex >= 0 ? `tre-suggestion-${activeSuggestionIndex}` : undefined}
            value={draft}
            onChange={(event) => {
              const value = event.target.value;
              setDraft(value);
              setActiveIntent(undefined);
              setSuggestionsOpen(Boolean(value.trim()));
              setActiveSuggestionIndex(value.trim() ? 0 : -1);
            }}
            onKeyDown={handleSearchKeyDown}
            onFocus={() => setSuggestionsOpen(Boolean(draft.trim()))}
            onBlur={() => window.setTimeout(() => setSuggestionsOpen(false), 100)}
            placeholder="Cerca tra location, cucine, quartieri…"
            autoComplete="off"
            maxLength={320}
            readOnly={!hydrated}
          />
          <button
            className={`search-composer__filters ${hasFilters ? 'is-active' : ''}`}
            type="button"
            aria-label={`${filtersOpen ? 'Chiudi' : 'Apri'} i filtri`}
            aria-expanded={filtersOpen}
            aria-controls="tre-filters"
            disabled={!hydrated}
            onClick={() => setFiltersOpen((current) => !current)}
          >
            <Icon name="sliders" />
          </button>
          <button className="search-composer__submit" type="submit" disabled={!hydrated}><span>Trova la mia top 3</span><Icon name="arrow" /></button>
          {suggestionsOpen && localSuggestions.length > 0 ? (
            <ul className="search-suggestions" id="tre-local-suggestions" role="listbox" aria-label="Suggerimenti dal catalogo locale">
              {localSuggestions.map((suggestion, index) => (
                <li
                  key={suggestion.id}
                  id={`tre-suggestion-${index}`}
                  role="option"
                  aria-selected={activeSuggestionIndex === index}
                  onMouseEnter={() => setActiveSuggestionIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseSuggestion(suggestion)}
                >
                  <span>{suggestion.label}</span>
                  <small>{suggestion.kind}</small>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div
          className={`search-interpreter search-interpreter--${interpretationStatus}`}
          data-interpretation-status={interpretationStatus}
          role="status"
          aria-live="polite"
        >
          <span className="search-interpreter__signal" aria-hidden="true"><Icon name="spark" /></span>
          <p><strong>{interpretationCopy.title}</strong><small>{interpretationCopy.detail}</small></p>
          <a href="/privacy/">Privacy</a>
        </div>
        {filtersOpen && (
          <div className="filter-panel" id="tre-filters">
            <label className="filter-panel__field">
              <span>Zona</span>
              <select value={location} onChange={(event) => { setLocation(event.target.value); setLocationExplicit(true); }}>
                {locations.map((item) => <option key={item} value={item}>{item === 'Milano' ? 'Tutta Milano' : item}</option>)}
              </select>
            </label>
            <fieldset className="filter-panel__field">
              <legend>Budget massimo</legend>
              <div className="filter-panel__choices">
                {budgets.map((budget) => (
                  <button key={budget} type="button" aria-pressed={maxSpend === budget} onClick={() => setMaxSpend(maxSpend === budget ? null : budget)}>€{budget}</button>
                ))}
              </div>
            </fieldset>
            <label className="filter-panel__toggle">
              <input type="checkbox" checked={onlyOpen} onChange={(event) => setOnlyOpen(event.target.checked)} />
              <span>Aperto adesso</span>
            </label>
            <div className="filter-panel__actions">
              <button className="filter-panel__reset" type="button" onClick={resetFilters} disabled={!hasFilters}>Azzera</button>
              <button className="filter-panel__apply" type="button" onClick={applyFilters}>Applica filtri</button>
            </div>
          </div>
        )}
        {intentChips.length ? (
          <div className="intent-summary" aria-label="Vincoli interpretati dalla ricerca">
            <span className="intent-summary__label">Ho capito</span>
            <div className="intent-summary__rail">
              {intentChips.map((chip) => (
                <button key={chip.id} type="button" onClick={() => removeIntentChip(chip)} aria-label={`Rimuovi ${chip.label}`}>
                  <span>{chip.label}</span><Icon name="close" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="quick-intents" aria-label="Intenzioni rapide">
            {quickIntents.map((intent) => (
              <button key={intent} type="button" aria-pressed={activeIntent === intent} onClick={() => selectIntent(intent)}>{intent}</button>
            ))}
          </div>
        )}
        {hasFilters && (
          <p className="active-filters" aria-live="polite">
            Filtri attivi: {[
              location !== 'Milano' ? location : null,
              maxSpend ? `massimo €${maxSpend}` : null,
              onlyOpen ? 'aperto adesso' : null,
            ].filter(Boolean).join(' · ')}
          </p>
        )}
        {tasteProfileReady && tasteProfile && profileSignals > 0 ? (
          <details className="profile-signal" data-profile-state={tasteProfile.state}>
            <summary aria-live="polite" aria-atomic="true">
              <Icon name="spark" />
              <span>{profileSummaryTitle}</span>
              <small>{profileSummaryMeta}</small>
            </summary>
            <p>{profileDetailCopy}</p>
          </details>
        ) : null}
      </form>

      <div className="discovery-utilities">
        <div
          className={`catalog-status catalog-status--${catalogState.status}`}
          data-catalog-status={catalogState.status}
          role="status"
          aria-live="polite"
        >
          <span aria-hidden="true"><Icon name={catalogState.status === 'live' ? 'spark' : 'refresh'} /></span>
          <p><strong>{catalogStatusCopy.title}</strong><small>{catalogStatusCopy.detail}</small></p>
        </div>

        <div className={`travel-origin-control travel-origin-control--${geolocationStatus}`}>
          <span className="travel-origin-control__icon"><Icon name="pin" /></span>
          <span className="travel-origin-control__copy">
            <strong>{sessionOrigin ? 'La tua posizione · solo questa sessione' : 'Origine Duomo'}</strong>
            <small id="tre-travel-origin-status" aria-live="polite">
              {geolocationStatus === 'requesting' && 'Richiesta della posizione in corso…'}
              {geolocationStatus === 'active' && 'Tempi a piedi stimati, non routing. Le coordinate non vengono salvate.'}
              {geolocationStatus === 'denied' && 'Permesso negato. Puoi riprovare dal browser; resti sull’origine Duomo.'}
              {geolocationStatus === 'outside-milan' && 'Posizione fuori dall’area di Milano; resti sull’origine Duomo.'}
              {geolocationStatus === 'error' && 'Posizione non disponibile; resti sull’origine Duomo.'}
              {geolocationStatus === 'unsupported' && 'Geolocalizzazione non supportata; resti sull’origine Duomo.'}
              {geolocationStatus === 'idle' && 'Attivazione solo su richiesta; nessuna coordinata viene salvata.'}
            </small>
          </span>
          <button
            type="button"
            aria-describedby="tre-travel-origin-status"
            disabled={geolocationStatus === 'requesting'}
            onClick={sessionOrigin ? resetTravelOrigin : requestForegroundLocation}
          >
            {geolocationStatus === 'requesting'
              ? 'Attendo…'
              : sessionOrigin
                ? 'Ripristina Duomo'
                : geolocationStatus === 'idle'
                  ? 'Usa la mia posizione'
                  : 'Riprova'}
          </button>
        </div>

        {lastPodiumSaved ? (
          <div className={`last-podium-status ${restoredLastPodium ? 'is-restored' : ''}`} role="status">
            <span>
              <strong>{restoredLastPodium ? 'Ultimo podio ripristinato offline' : 'Ultimo podio disponibile offline'}</strong>
              <small>Solo venue e criteri tassonomizzati · query, posizione e profilo non salvati</small>
            </span>
            <button type="button" aria-label="Cancella ultimo podio" onClick={deleteLastPodium}>Rimuovi</button>
          </div>
        ) : null}
      </div>

      {unsupportedConstraints.length ? (
        <div className="unsupported-confirmation" role="alert">
          <Icon name="spark" />
          <div>
            <strong>Questo vincolo richiede una conferma verificata.</strong>
            <p>
              Non mostriamo risultati inventati per {unsupportedConstraints.map(({ label }) => label).join(' e ')}.
              Modifica o rimuovi il requisito dal testo della ricerca.
            </p>
          </div>
          <button type="button" onClick={() => { searchInputRef.current?.focus(); searchInputRef.current?.select(); }}>Modifica la ricerca</button>
        </div>
      ) : null}

      <div className="context-card">
        <span className="context-card__icon"><Icon name="pin" /></span>
        <span><strong>{contextLocation === 'Milano'
          ? `Milano · tempi ${sessionOrigin || catalogState.status === 'live' ? 'stimati' : 'demo'} da ${travelOriginLabel}`
          : `${contextLocation} · zona filtro, tempi ${sessionOrigin || catalogState.status === 'live' ? 'stimati' : 'demo'} da ${travelOriginLabel}`}</strong><small>{query}</small></span>
        <button type="button" aria-expanded={contextOpen} aria-controls="tre-location-choices" onClick={() => setContextOpen((current) => !current)}>Cambia</button>
        {contextOpen && (
          <div className="context-card__choices" id="tre-location-choices" aria-label="Scegli una zona">
            {locations.map((item) => (
              <button key={item} type="button" aria-pressed={location === item} onClick={() => chooseLocation(item)}>{item === 'Milano' ? 'Tutta Milano' : item}</button>
            ))}
          </div>
        )}
      </div>

      <div className="podium-shell">
        <div className="podium-shell__results">
          <div className="podium-heading">
            <h2 id="podium-title">Top 3 per te</h2>
            <div className="podium-heading__meta">
              <p aria-live="polite">{results.length === 3 ? 'Tre ruoli diversi, nessun vincolo ignorato.' : `${results.length} ${results.length === 1 ? 'scelta disponibile' : 'scelte disponibili'}: prova ad ampliare un vincolo.`}</p>
              <button className="podium-share" type="button" onClick={sharePodium} disabled={!results.length}>
                <Icon name="share" /><span>Condividi podio</span>
              </button>
            </div>
          </div>

          {catalogState.status === 'loading' ? (
            <div className="podium-empty podium-empty--loading" role="status">
              <Icon name="refresh" />
              <h3>Sto preparando il catalogo verificato</h3>
              <p>Il podio apparirà appena i candidati reali avranno superato validazione e gate di ranking.</p>
            </div>
          ) : results.length ? (
            <>
              <ol className="podium-list" aria-label="Risultati in ordine di pertinenza">
                {results.map((venue) => (
                  <PodiumCard
                    key={venue.id}
                    venue={venue}
                    saved={saved.includes(venue.id)}
                    active={activeMapVenue?.id === venue.id}
                    onSave={() => toggleSaved(venue.id, venue.name)}
                    onFocus={() => setActiveVenue(venue.id)}
                    onOpen={() => openCard(venue)}
                    onShare={() => shareVenue(venue)}
                    onReplace={() => replaceVenue(venue)}
                  />
                ))}
              </ol>
              <p className="podium-disclosure"><Icon name="clock" /> Tempi a piedi stimati dall’origine indicata, non routing. Dettagli e stato delle fonti sono nella scheda.</p>
            </>
          ) : (
            <div className="podium-empty">
              <Icon name="spark" />
              <h3>{unsupportedConstraints.length ? 'Serve un dato verificato in più' : 'Nessun podio affidabile con questi vincoli'}</h3>
              <p>{unsupportedConstraints.length
                ? `Non proponiamo locali per ${unsupportedConstraints.map(({ label }) => label).join(' e ')} finché il catalogo non contiene fonti dedicate e aggiornate.`
                : 'Prova ad ampliare la distanza o il budget. Non inventiamo una scelta se i dati non bastano.'}</p>
            </div>
          )}
          {results.length ? (
            <div className="podium-feedback" aria-label="Feedback sul podio">
              <span>Com’è questo podio?</span>
              <div>
                {feedbackOptions.map((option) => (
                  <button
                    key={option.code}
                    type="button"
                    aria-pressed={feedbackCode === option.code}
                    onClick={() => submitFeedback(option.code)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {feedbackCode ? <small role="status">Solo per questa sessione · nessun invio</small> : null}
            </div>
          ) : null}
        </div>

        <section className="milano-map" aria-labelledby="tre-map-title">
          <header className="milano-map__header">
            <div>
              <span>Mappa editoriale</span>
              <h3 id="tre-map-title">Il podio, nella città</h3>
            </div>
            <div className="milano-map__controls" aria-label="Controlli della mappa">
              <button type="button" aria-label="Riduci la mappa" disabled={mapZoom <= 1} onClick={() => setMapZoom((current) => Math.max(1, Number((current - 0.15).toFixed(2))))}><Icon name="minus" /></button>
              <button type="button" aria-label="Ingrandisci la mappa" disabled={mapZoom >= 1.3} onClick={() => setMapZoom((current) => Math.min(1.3, Number((current + 0.15).toFixed(2))))}><Icon name="plus" /></button>
            </div>
          </header>
          <div className="milano-map__viewport">
            <div className="milano-map__canvas" style={{ transform: `scale(${mapZoom})` }}>
              <svg className="milano-map__streets" aria-hidden="true" viewBox="0 0 600 390" preserveAspectRatio="none">
                <path className="milano-map__ring" d="M104 188C105 88 198 34 310 42c108 8 183 77 183 164 0 91-83 145-192 143-117-3-198-65-197-161Z" />
                <path d="M20 306 188 232 326 253 575 104M56 60l170 118 112 22 229 142M302 18l-16 116 40 119-34 120M8 180l144 8 134-54 298 21M162 20l18 101-28 67 34 177M438 25l-81 104-31 124 156 108" />
                <path className="milano-map__water" d="M-10 332c102-54 172-39 249-9 87 33 181 32 371-30" />
              </svg>
              <span className="milano-map__label milano-map__label--brera">Brera</span>
              <span className="milano-map__label milano-map__label--duomo">Duomo</span>
              <span className="milano-map__label milano-map__label--navigli">Navigli</span>
              <span className="milano-map__label milano-map__label--romana">Porta Romana</span>
              {results.map((venue) => {
                const position = mapPositions.get(venue.id) ?? { left: 50, top: 50 };
                const isActive = activeMapVenue?.id === venue.id;
                return (
                  <button
                    type="button"
                    key={venue.id}
                    className={`map-marker${isActive ? ' is-active' : ''}`}
                    style={{ left: `${position.left}%`, top: `${position.top}%` }}
                    aria-label={`Posizione ${venue.rank}: seleziona ${venue.name}`}
                    aria-pressed={isActive}
                    onClick={() => {
                      setActiveVenue(venue.id);
                      setSavedNotice(`${venue.name} selezionato sulla mappa.`);
                    }}
                    onFocus={() => setActiveVenue(venue.id)}
                    onMouseEnter={() => setActiveVenue(venue.id)}
                  >
                    <span>{venue.rank}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {activeMapVenue ? (
            <article className="milano-map__preview" data-active-venue={activeMapVenue.id} aria-live="polite">
              <img src={activeMapVenue.image} alt="" width={activeMapVenue.imageWidth} height={activeMapVenue.imageHeight} loading="lazy" />
              <div>
                <span>#{activeMapVenue.rank} · {activeMapVenue.neighborhood}</span>
                <h4>{activeMapVenue.name}</h4>
                <p>{activeMapVenue.category} · {activeMapVenue.pricingKnown === false ? 'Prezzo da verificare' : '€'.repeat(activeMapVenue.priceLevel)} · {activeMapVenue.travelEstimate.minutes} min</p>
              </div>
              <a href={venueDetailHref(activeMapVenue)} aria-label={`Apri la scheda completa di ${activeMapVenue.name}`}><Icon name="arrow" /></a>
            </article>
          ) : null}
          <a className="milano-map__cta" href="/milano/">Esplora Milano <Icon name="arrow" /></a>
        </section>
      </div>
      <div className="mobile-intents" aria-labelledby="mobile-intents-title">
        <h2 id="mobile-intents-title">Perfetto anche per</h2>
        <div>
          {quickIntents.map((intent) => (
            <button key={intent} type="button" aria-pressed={activeIntent === intent} onClick={() => selectIntent(intent)}>{intent}</button>
          ))}
        </div>
      </div>
      <p className="sr-only" aria-live="polite">{savedNotice}</p>
    </section>
  );
}
