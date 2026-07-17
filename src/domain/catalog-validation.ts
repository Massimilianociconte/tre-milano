import {
  GOLD_CONFIDENCE_MINIMUM,
  hasFreshVenueVerification,
  hasUsableAvailability,
  hasUsableFieldProvenance,
  hasUsableOpenStatus,
  hasUsableTravelEstimate,
  hasUsableVenueActionProvenance,
  isPublicHttpsUrl,
  isRecommendationMaturityTier,
  isValidMilanPublicationGeo,
  isValidVenuePublicationAction,
  isValidVenueTelephone,
  isVenueMaturityTier,
  isVenuePublishable,
  type VenueActionKind,
  type Venue,
} from './venue.ts';
import { isWithinMilanDiscoveryArea } from './discovery-location.ts';

export const FIXTURE_CATALOG_EXPECTED_COUNT = 20;

export type CatalogValidationIssue = {
  code:
    | 'EMPTY_CATALOG'
    | 'FIXTURE_CATALOG_SIZE'
    | 'DUPLICATE_ID'
    | 'DUPLICATE_SLUG'
    | 'INVALID_CORE_FIELDS'
    | 'INVALID_MATURITY_TIER'
    | 'INCONSISTENT_MATURITY_ELIGIBILITY'
    | 'FIXTURE_DATA'
    | 'NON_FIXTURE_DATA'
    | 'INVALID_VERIFICATION_DATE'
    | 'INVALID_OPEN_STATUS_PROVENANCE'
    | 'INVALID_AVAILABILITY_PROVENANCE'
    | 'INVALID_TRAVEL_PROVENANCE'
    | 'INVALID_FIELD_PROVENANCE'
    | 'INVALID_CONFIDENCE'
    | 'INVALID_WEEKLY_AVAILABILITY'
    | 'MISSING_PUBLICATION'
    | 'INVALID_OFFICIAL_URL'
    | 'INVALID_SCHEMA_TYPE'
    | 'INVALID_ADDRESS'
    | 'INVALID_OPENING_HOURS'
    | 'INVALID_DISCOVERY_LOCATION'
    | 'INVALID_GEO'
    | 'INVALID_TELEPHONE'
    | 'INVALID_ACTION_SHAPE'
    | 'INVALID_ACTION_URL'
    | 'INVALID_ACTION_TELEPHONE'
    | 'INVALID_ACTION_GEO'
    | 'INVALID_ACTION_PROVENANCE'
    | 'INCONSISTENT_ACTION_DATA'
    | 'NOT_PUBLISHABLE';
  venueId?: string;
  message: string;
};

const DAY = '(?:Mo|Tu|We|Th|Fr|Sa|Su)';
const TIME = '(?:[01]\\d|2[0-3]):[0-5]\\d';
const SCHEMA_OPENING_HOURS = new RegExp(`^${DAY}(?:-${DAY})?(?:,${DAY}(?:-${DAY})?)*\\s+${TIME}-${TIME}$`);
const CLOCK_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS = new Set(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
const CATEGORIES = new Set(['Cocktail bar', 'Ristorante', 'Enoteca', 'Rooftop', 'Caffè']);

function hasValidCoreFields(venue: Venue) {
  const nonEmptyList = (value: unknown) => Array.isArray(value)
    && value.length > 0
    && value.every((item) => typeof item === 'string' && item.trim().length > 0);
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(venue.id)
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(venue.slug)
    && Boolean(venue.name.trim() && venue.neighborhood.trim() && venue.imageAlt.trim())
    && CATEGORIES.has(venue.category)
    && /^\/images\/[a-z0-9][a-z0-9._-]*\.(?:avif|webp|png|jpe?g)$/i.test(venue.image)
    && Number.isFinite(venue.imageWidth)
    && venue.imageWidth > 0
    && Number.isFinite(venue.imageHeight)
    && venue.imageHeight > 0
    && Number.isInteger(venue.priceLevel)
    && venue.priceLevel >= 1
    && venue.priceLevel <= 4
    && Number.isFinite(venue.averageSpend)
    && venue.averageSpend > 0
    && nonEmptyList(venue.atmosphere)
    && nonEmptyList(venue.occasions)
    && nonEmptyList(venue.features);
}

function hasValidWeeklyAvailability(venue: Venue) {
  const entries = Object.entries(venue.availability.weekly);
  if (!entries.length || entries.some(([weekday]) => !WEEKDAYS.has(weekday))) return false;

  let windows = 0;
  for (const [, dailyWindows] of entries) {
    if (!Array.isArray(dailyWindows)) return false;
    for (const window of dailyWindows) {
      windows += 1;
      if (!window || !CLOCK_TIME.test(window.opens) || !CLOCK_TIME.test(window.closes) || window.opens === window.closes) {
        return false;
      }
    }
  }
  return windows > 0;
}

function hasValidPublicationAddress(venue: Venue) {
  const address = venue.publication?.address;
  return Boolean(
    address
      && address.streetAddress.trim()
      && /^20\d{3}$/.test(address.postalCode)
      && address.addressLocality === 'Milano'
      && address.addressRegion === 'MI'
      && address.addressCountry === 'IT',
  );
}

function hasValidGeo(venue: Venue) {
  return isValidMilanPublicationGeo(venue.publication?.geo);
}

const ACTION_KINDS: VenueActionKind[] = ['official', 'menu', 'reservation', 'telephone', 'directions'];

function validatePublicationActions(
  venue: Venue,
  at: number,
  add: (code: CatalogValidationIssue['code'], message: string) => void,
) {
  const publication = venue.publication;
  if (!publication || publication.actions === undefined) return;
  if ((publication.actions as unknown) === null
    || typeof publication.actions !== 'object'
    || Array.isArray(publication.actions)) {
    add('INVALID_ACTION_SHAPE', 'Il blocco actions deve essere un oggetto tipizzato.');
    return;
  }

  const unknownKinds = Object.keys(publication.actions).filter((kind) => !ACTION_KINDS.includes(kind as VenueActionKind));
  if (unknownKinds.length) {
    add('INVALID_ACTION_SHAPE', `Azioni non consentite: ${unknownKinds.join(', ')}.`);
  }

  for (const kind of ACTION_KINDS) {
    const action = publication.actions[kind];
    if (action === undefined) continue;
    if (!action || typeof action !== 'object' || Array.isArray(action)) {
      add('INVALID_ACTION_SHAPE', `Azione ${kind} priva di payload tipizzato.`);
      continue;
    }
    if (!hasUsableVenueActionProvenance(action.provenance, at)) {
      add('INVALID_ACTION_PROVENANCE', `Azione ${kind} priva di fonte HTTPS, confidence o finestra di validità corrente.`);
    }

    if (kind === 'official' || kind === 'menu' || kind === 'reservation') {
      const url = 'url' in action ? action.url : undefined;
      if (typeof url !== 'string' || !isPublicHttpsUrl(url)) {
        add('INVALID_ACTION_URL', `URL operativo ${kind} assente, non HTTPS pubblico o riservato.`);
      } else if (kind === 'official' && url !== publication.officialUrl) {
        add('INCONSISTENT_ACTION_DATA', 'L’azione official non coincide con officialUrl verificato.');
      }
    } else if (kind === 'telephone') {
      const telephone = 'telephone' in action ? action.telephone : undefined;
      if (!isValidVenueTelephone(telephone)) {
        add('INVALID_ACTION_TELEPHONE', 'Numero operativo non in formato E.164 italiano (+39).');
      } else if (telephone !== publication.telephone) {
        add('INCONSISTENT_ACTION_DATA', 'L’azione telephone non coincide con il telefono verificato della publication.');
      }
    } else {
      const destination = 'destination' in action ? action.destination : undefined;
      if (!isValidMilanPublicationGeo(destination)) {
        add('INVALID_ACTION_GEO', 'Destinazione Naviga assente, non finita o fuori dall’area di Milano.');
      } else if (!publication.geo
        || destination.latitude !== publication.geo.latitude
        || destination.longitude !== publication.geo.longitude) {
        add('INCONSISTENT_ACTION_DATA', 'La destinazione Naviga non coincide con publication.geo verificato.');
      }
    }

    if (!isValidVenuePublicationAction(publication, kind, at)
      && hasUsableVenueActionProvenance(action.provenance, at)) {
      // The detailed URL/telephone/geo branches above explain normal failures.
      // This guard catches any future contract drift without silently publishing.
      const alreadyExplained = (kind === 'official' || kind === 'menu' || kind === 'reservation')
        ? ('url' in action && typeof action.url === 'string' && isPublicHttpsUrl(action.url))
        : kind === 'telephone'
          ? ('telephone' in action && isValidVenueTelephone(action.telephone))
          : ('destination' in action && isValidMilanPublicationGeo(action.destination));
      if (alreadyExplained && kind !== 'official' && kind !== 'telephone' && kind !== 'directions') {
        add('INVALID_ACTION_SHAPE', `Azione ${kind} non conforme al contratto operativo.`);
      }
    }
  }
}

/** Structural and maturity contract shared by fixture and production validation. */
export function validateCatalogStructure(catalog: Venue[]): CatalogValidationIssue[] {
  const issues: CatalogValidationIssue[] = [];
  if (!catalog.length) return [{ code: 'EMPTY_CATALOG', message: 'Il catalogo è vuoto.' }];

  const ids = new Set<string>();
  const slugs = new Set<string>();
  for (const venue of catalog) {
    const venueId = venue.id || venue.slug || 'venue-senza-id';
    const add = (code: CatalogValidationIssue['code'], message: string) => issues.push({ code, venueId, message });

    if (ids.has(venue.id)) add('DUPLICATE_ID', `ID duplicato: ${venue.id}.`);
    ids.add(venue.id);
    if (slugs.has(venue.slug)) add('DUPLICATE_SLUG', `Slug duplicato: ${venue.slug}.`);
    slugs.add(venue.slug);

    if (!hasValidCoreFields(venue)) {
      add('INVALID_CORE_FIELDS', 'ID/slug, testi, prezzo, tassonomie o asset immagine non rispettano il contratto catalogo.');
    }
    if (!isWithinMilanDiscoveryArea(venue.discoveryLocation)) {
      add('INVALID_DISCOVERY_LOCATION', 'Coordinate di discovery assenti, non finite o fuori dall’area di Milano.');
    }
    if (!isVenueMaturityTier(venue.maturityTier)) {
      add('INVALID_MATURITY_TIER', `Tier di maturità non consentito: ${String(venue.maturityTier)}.`);
    }
    if (venue.recommendationEligible && !isRecommendationMaturityTier(venue.maturityTier)) {
      add(
        'INCONSISTENT_MATURITY_ELIGIBILITY',
        `Una venue ${String(venue.maturityTier)} non può essere raccomandabile: soltanto Gold e Platinum entrano nel podio.`,
      );
    }
  }

  return issues;
}

/** Preview dataset gate: exactly 20 declared fixtures, always non-publishable. */
export function validateFixtureCatalog(catalog: Venue[]): CatalogValidationIssue[] {
  const issues = validateCatalogStructure(catalog);
  if (catalog.length !== FIXTURE_CATALOG_EXPECTED_COUNT) {
    issues.push({
      code: 'FIXTURE_CATALOG_SIZE',
      message: `Il catalogo fixture deve contenere esattamente ${FIXTURE_CATALOG_EXPECTED_COUNT} venue; ricevute ${catalog.length}.`,
    });
  }

  for (const venue of catalog) {
    if (!venue.fixtureOnly) {
      issues.push({
        code: 'NON_FIXTURE_DATA',
        venueId: venue.id,
        message: 'Il dataset fixture contiene una venue non marcata come fixture.',
      });
    }
    if (isVenuePublishable(venue)) {
      issues.push({
        code: 'NOT_PUBLISHABLE',
        venueId: venue.id,
        message: 'Una fixture non deve mai superare il gate di pubblicabilità.',
      });
    }
  }

  return issues;
}

export function validateProductionCatalog(catalog: Venue[], at = Date.now()): CatalogValidationIssue[] {
  const issues = validateCatalogStructure(catalog);
  if (!catalog.length) return issues;

  for (const venue of catalog) {
    const venueId = venue.id || venue.slug || 'venue-senza-id';
    const add = (code: CatalogValidationIssue['code'], message: string) => issues.push({ code, venueId, message });

    if (venue.fixtureOnly) add('FIXTURE_DATA', 'La venue è ancora marcata come fixture.');
    if (!venue.recommendationEligible) continue;

    if (!hasFreshVenueVerification(venue, at)) {
      add('INVALID_VERIFICATION_DATE', `verifiedAt non valido, futuro o più vecchio di 90 giorni: ${venue.verifiedAt}.`);
    }
    if (!Number.isFinite(venue.confidence) || venue.confidence < GOLD_CONFIDENCE_MINIMUM || venue.confidence > 1) {
      add('INVALID_CONFIDENCE', `Confidence Gold fuori intervallo ${GOLD_CONFIDENCE_MINIMUM.toFixed(2)}–1: ${venue.confidence}.`);
    }
    if (!hasUsableOpenStatus(venue, at)) {
      add('INVALID_OPEN_STATUS_PROVENANCE', 'Stato aperto/chiuso privo di fonte HTTPS o finestra di validità corrente.');
    }
    if (!hasUsableAvailability(venue, at)) {
      add('INVALID_AVAILABILITY_PROVENANCE', 'Disponibilità priva di fonte HTTPS o finestra di validità corrente.');
    }
    if (!hasUsableTravelEstimate(venue, at)) {
      add('INVALID_TRAVEL_PROVENANCE', 'Tempo a piedi privo di origine dichiarata, fonte HTTPS o finestra di validità corrente.');
    }
    if (!hasUsableFieldProvenance(venue, at)) {
      add('INVALID_FIELD_PROVENANCE', 'Prezzi, attributi o diritti immagine privi di provenance/freschezza/confidenza Gold.');
    }
    if (!hasValidWeeklyAvailability(venue)) {
      add('INVALID_WEEKLY_AVAILABILITY', 'Calendario settimanale assente o con finestre orarie non valide.');
    }

    if (!venue.publication) {
      add('MISSING_PUBLICATION', 'Payload editoriale di pubblicazione assente.');
    } else {
      if (!isPublicHttpsUrl(venue.publication.officialUrl)) add('INVALID_OFFICIAL_URL', 'URL ufficiale assente, non HTTPS pubblico o riservato.');
      if (!['BarOrPub', 'Restaurant', 'CafeOrCoffeeShop', 'LiquorStore', 'LocalBusiness'].includes(venue.publication.schemaType)) {
        add('INVALID_SCHEMA_TYPE', 'Tipo Schema.org assente o non consentito; deve provenire dalla verifica della venue.');
      }
      if (!hasValidPublicationAddress(venue)) add('INVALID_ADDRESS', 'Indirizzo editoriale incompleto o non coerente con Milano.');
      if (!venue.publication.openingHours.length || !venue.publication.openingHours.every((value) => SCHEMA_OPENING_HOURS.test(value))) {
        add('INVALID_OPENING_HOURS', 'openingHours deve usare il formato Schema.org, per esempio "Mo-Su 18:00-02:00".');
      }
      if (!hasValidGeo(venue)) add('INVALID_GEO', 'Coordinate geografiche fuori intervallo.');
      if (venue.publication.telephone !== undefined && !isValidVenueTelephone(venue.publication.telephone)) {
        add('INVALID_TELEPHONE', 'Telefono publication non in formato E.164 italiano (+39).');
      }
      validatePublicationActions(venue, at, add);
    }

    if (!isVenuePublishable(venue, at)) {
      add('NOT_PUBLISHABLE', 'La venue raccomandabile non supera il gate finale di pubblicabilità.');
    }
  }

  return issues;
}

export function assertProductionCatalog(catalog: Venue[], at = Date.now()) {
  const issues = validateProductionCatalog(catalog, at);
  if (!issues.length) return;

  const containsFixtures = issues.some((issue) => issue.code === 'FIXTURE_DATA');
  const headline = containsFixtures
    ? 'Build pubblica bloccata: il catalogo contiene ancora venue fixture.'
    : 'Build pubblica bloccata: il catalogo Gold non è interamente pubblicabile.';
  const details = issues.map((issue) => `- ${issue.venueId ? `${issue.venueId}: ` : ''}[${issue.code}] ${issue.message}`).join('\n');
  throw new Error(`${headline}\n${details}`);
}
