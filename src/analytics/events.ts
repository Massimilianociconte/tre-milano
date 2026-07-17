export const ANALYTICS_SCHEMA_VERSION = 1 as const;
export const ANALYTICS_BROWSER_EVENT = 'tre-milano:analytics-event';

export const ANALYTICS_EVENT_NAMES = [
  'search_started',
  'intent_parsed',
  'podium_shown',
  'podium_low_confidence',
  'card_opened',
  'venue_saved',
  'podium_shared',
  'wildcard_explained',
  'wildcard_replaced',
  'feedback_submitted',
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];
export type AnalyticsPrivacyClass = 'product_measurement' | 'quality_signal';
export type PodiumRole = 'best-fit' | 'safe-alternative' | 'smart-wildcard';
export type PodiumRank = 1 | 2 | 3;
export type WildcardDimension = 'categoria' | 'zona' | 'occasione' | 'atmosfera' | 'caratteristica';

export type AnalyticsEventProperties = {
  search_started: {
    entryPoint: 'home' | 'search' | 'editorial' | 'shared';
    hasFilters: boolean;
    hasLocationContext: boolean;
  };
  intent_parsed: {
    constraintCount: number;
    hardConstraintCount: number;
    unsupportedConstraintCount: number;
  };
  podium_shown: {
    resultCount: number;
    hasWildcard: boolean;
    profileApplied: boolean;
  };
  podium_low_confidence: {
    resultCount: number;
    reason: 'insufficient_candidates' | 'below_threshold' | 'stale_data' | 'unsupported_constraint';
  };
  card_opened: {
    venueId: string;
    rank: PodiumRank;
    role: PodiumRole;
  };
  venue_saved: {
    venueId: string;
    saved: boolean;
    source: 'podium' | 'venue' | 'collection' | 'favorites';
  };
  podium_shared: {
    resultCount: number;
    method: 'native' | 'clipboard' | 'unavailable';
    context: 'individual' | 'group';
  };
  wildcard_explained: {
    venueId: string;
    divergenceDimension: WildcardDimension;
  };
  wildcard_replaced: {
    venueId: string;
    replacementFound: boolean;
    divergenceDimension?: WildcardDimension;
  };
  feedback_submitted: {
    target: 'podium' | 'venue' | 'wildcard';
    code: 'represents_me' | 'too_far' | 'quieter' | 'incorrect_reason';
    venueId?: string;
  };
};

export type AnalyticsPropertiesFor<Name extends AnalyticsEventName> = AnalyticsEventProperties[Name];

export type AnalyticsEvent<Name extends AnalyticsEventName = AnalyticsEventName> = Readonly<{
  schemaVersion: typeof ANALYTICS_SCHEMA_VERSION;
  name: Name;
  privacyClass: AnalyticsPrivacyClass;
  eventId: string;
  correlationId: string;
  idempotencyKey: string;
  occurredAt: string;
  properties: Readonly<AnalyticsPropertiesFor<Name>>;
}>;

export type AnalyticsEmitOptions = {
  eventId?: string;
  correlationId?: string;
  idempotencyKey?: string;
  occurredAt?: string;
};

export type AnalyticsEventTarget = Pick<EventTarget, 'dispatchEvent'>;

export const ANALYTICS_PRIVACY_CLASS: Readonly<Record<AnalyticsEventName, AnalyticsPrivacyClass>> = Object.freeze({
  search_started: 'product_measurement',
  intent_parsed: 'product_measurement',
  podium_shown: 'product_measurement',
  podium_low_confidence: 'quality_signal',
  card_opened: 'product_measurement',
  venue_saved: 'product_measurement',
  podium_shared: 'product_measurement',
  wildcard_explained: 'quality_signal',
  wildcard_replaced: 'quality_signal',
  feedback_submitted: 'quality_signal',
});

export class AnalyticsContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalyticsContractError';
  }
}

const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_VENUE_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function createId(prefix: 'evt' | 'corr') {
  const random = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  return `${prefix}-${random}`;
}

export function createAnalyticsCorrelationId() {
  return createId('corr');
}

function assertSafeToken(value: unknown, label: string) {
  if (typeof value !== 'string' || !SAFE_TOKEN.test(value)) {
    throw new AnalyticsContractError(`${label} deve essere un token tecnico senza testo libero.`);
  }
}

function assertVenueId(value: unknown, label = 'venueId') {
  if (typeof value !== 'string' || !SAFE_VENUE_ID.test(value)) {
    throw new AnalyticsContractError(`${label} deve essere uno slug tecnico valido.`);
  }
}

function assertInteger(value: unknown, label: string, minimum: number, maximum: number) {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new AnalyticsContractError(`${label} deve essere un intero tra ${minimum} e ${maximum}.`);
  }
}

function assertBoolean(value: unknown, label: string) {
  if (typeof value !== 'boolean') throw new AnalyticsContractError(`${label} deve essere booleano.`);
}

function assertEnum<const Values extends readonly string[]>(value: unknown, label: string, values: Values) {
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new AnalyticsContractError(`${label} deve essere uno dei valori previsti dal contratto.`);
  }
}

function assertExactKeys(
  name: AnalyticsEventName,
  properties: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): asserts properties is Record<string, unknown> {
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    throw new AnalyticsContractError(`${name}: properties deve essere un oggetto.`);
  }

  const record = properties as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  const unexpected = Object.keys(record).filter((key) => !allowed.has(key));
  const missing = required.filter((key) => !(key in record));
  if (unexpected.length) {
    throw new AnalyticsContractError(`${name}: proprietà non consentite: ${unexpected.join(', ')}.`);
  }
  if (missing.length) {
    throw new AnalyticsContractError(`${name}: proprietà obbligatorie mancanti: ${missing.join(', ')}.`);
  }
}

function validateProperties<Name extends AnalyticsEventName>(
  name: Name,
  value: AnalyticsPropertiesFor<Name>,
): Readonly<AnalyticsPropertiesFor<Name>> {
  const properties = value as unknown;

  switch (name) {
    case 'search_started': {
      assertExactKeys(name, properties, ['entryPoint', 'hasFilters', 'hasLocationContext']);
      assertEnum(properties.entryPoint, 'entryPoint', ['home', 'search', 'editorial', 'shared'] as const);
      assertBoolean(properties.hasFilters, 'hasFilters');
      assertBoolean(properties.hasLocationContext, 'hasLocationContext');
      break;
    }
    case 'intent_parsed': {
      assertExactKeys(name, properties, ['constraintCount', 'hardConstraintCount', 'unsupportedConstraintCount']);
      assertInteger(properties.constraintCount, 'constraintCount', 0, 32);
      assertInteger(properties.hardConstraintCount, 'hardConstraintCount', 0, 32);
      assertInteger(properties.unsupportedConstraintCount, 'unsupportedConstraintCount', 0, 32);
      if (Number(properties.hardConstraintCount) > Number(properties.constraintCount)) {
        throw new AnalyticsContractError('hardConstraintCount non può superare constraintCount.');
      }
      if (Number(properties.unsupportedConstraintCount) > Number(properties.constraintCount)) {
        throw new AnalyticsContractError('unsupportedConstraintCount non può superare constraintCount.');
      }
      break;
    }
    case 'podium_shown': {
      assertExactKeys(name, properties, ['resultCount', 'hasWildcard', 'profileApplied']);
      assertInteger(properties.resultCount, 'resultCount', 0, 3);
      assertBoolean(properties.hasWildcard, 'hasWildcard');
      assertBoolean(properties.profileApplied, 'profileApplied');
      if (properties.hasWildcard && properties.resultCount !== 3) {
        throw new AnalyticsContractError('hasWildcard richiede un podio completo da tre risultati.');
      }
      break;
    }
    case 'podium_low_confidence': {
      assertExactKeys(name, properties, ['resultCount', 'reason']);
      assertInteger(properties.resultCount, 'resultCount', 0, 3);
      assertEnum(properties.reason, 'reason', ['insufficient_candidates', 'below_threshold', 'stale_data', 'unsupported_constraint'] as const);
      break;
    }
    case 'card_opened': {
      assertExactKeys(name, properties, ['venueId', 'rank', 'role']);
      assertVenueId(properties.venueId);
      assertInteger(properties.rank, 'rank', 1, 3);
      assertEnum(properties.role, 'role', ['best-fit', 'safe-alternative', 'smart-wildcard'] as const);
      const expectedRoles: Record<PodiumRank, readonly PodiumRole[]> = {
        1: ['best-fit'],
        2: ['safe-alternative'],
        3: ['smart-wildcard', 'safe-alternative'],
      };
      if (!expectedRoles[properties.rank as PodiumRank].includes(properties.role as PodiumRole)) {
        throw new AnalyticsContractError('role non coerente con il rank del podio.');
      }
      break;
    }
    case 'venue_saved': {
      assertExactKeys(name, properties, ['venueId', 'saved', 'source']);
      assertVenueId(properties.venueId);
      assertBoolean(properties.saved, 'saved');
      assertEnum(properties.source, 'source', ['podium', 'venue', 'collection', 'favorites'] as const);
      break;
    }
    case 'podium_shared': {
      assertExactKeys(name, properties, ['resultCount', 'method', 'context']);
      assertInteger(properties.resultCount, 'resultCount', 0, 3);
      assertEnum(properties.method, 'method', ['native', 'clipboard', 'unavailable'] as const);
      assertEnum(properties.context, 'context', ['individual', 'group'] as const);
      break;
    }
    case 'wildcard_explained': {
      assertExactKeys(name, properties, ['venueId', 'divergenceDimension']);
      assertVenueId(properties.venueId);
      assertEnum(properties.divergenceDimension, 'divergenceDimension', ['categoria', 'zona', 'occasione', 'atmosfera', 'caratteristica'] as const);
      break;
    }
    case 'wildcard_replaced': {
      assertExactKeys(name, properties, ['venueId', 'replacementFound'], ['divergenceDimension']);
      assertVenueId(properties.venueId);
      assertBoolean(properties.replacementFound, 'replacementFound');
      if (properties.divergenceDimension !== undefined) {
        assertEnum(properties.divergenceDimension, 'divergenceDimension', ['categoria', 'zona', 'occasione', 'atmosfera', 'caratteristica'] as const);
      }
      break;
    }
    case 'feedback_submitted': {
      assertExactKeys(name, properties, ['target', 'code'], ['venueId']);
      assertEnum(properties.target, 'target', ['podium', 'venue', 'wildcard'] as const);
      assertEnum(properties.code, 'code', ['represents_me', 'too_far', 'quieter', 'incorrect_reason'] as const);
      if (properties.venueId !== undefined) assertVenueId(properties.venueId);
      break;
    }
    default: {
      const exhaustive: never = name;
      throw new AnalyticsContractError(`Evento non supportato: ${String(exhaustive)}.`);
    }
  }

  return Object.freeze({ ...(properties as Record<string, unknown>) }) as Readonly<AnalyticsPropertiesFor<Name>>;
}

export function createAnalyticsEvent<Name extends AnalyticsEventName>(
  name: Name,
  properties: AnalyticsPropertiesFor<Name>,
  options: AnalyticsEmitOptions = {},
): AnalyticsEvent<Name> {
  if (!ANALYTICS_EVENT_NAMES.includes(name)) {
    throw new AnalyticsContractError(`Evento non previsto dal contratto: ${String(name)}.`);
  }

  const eventId = options.eventId ?? createId('evt');
  const correlationId = options.correlationId ?? createAnalyticsCorrelationId();
  const idempotencyKey = options.idempotencyKey ?? `${correlationId}:${eventId}`;
  const occurredAt = options.occurredAt ?? new Date().toISOString();

  assertSafeToken(eventId, 'eventId');
  assertSafeToken(correlationId, 'correlationId');
  assertSafeToken(idempotencyKey, 'idempotencyKey');
  if (!ISO_INSTANT.test(occurredAt) || !Number.isFinite(Date.parse(occurredAt))) {
    throw new AnalyticsContractError('occurredAt deve essere una data ISO valida.');
  }

  return Object.freeze({
    schemaVersion: ANALYTICS_SCHEMA_VERSION,
    name,
    privacyClass: ANALYTICS_PRIVACY_CLASS[name],
    eventId,
    correlationId,
    idempotencyKey,
    occurredAt,
    properties: validateProperties(name, properties),
  });
}

function currentBrowserTarget(target?: AnalyticsEventTarget) {
  if (target) return target;
  return typeof window === 'undefined' ? undefined : window;
}

function customEventFor(event: AnalyticsEvent): Event {
  if (typeof CustomEvent === 'function') {
    return new CustomEvent(ANALYTICS_BROWSER_EVENT, { detail: event });
  }
  const fallback = new Event(ANALYTICS_BROWSER_EVENT);
  Object.defineProperty(fallback, 'detail', { configurable: false, enumerable: true, value: event });
  return fallback;
}

/**
 * Dispatches a local browser signal only. This function has no transport,
 * persistence, cookies or storage side effects; without a listener it is a no-op.
 */
export function dispatchAnalyticsEvent(event: AnalyticsEvent, target?: AnalyticsEventTarget) {
  const browserTarget = currentBrowserTarget(target);
  if (browserTarget) browserTarget.dispatchEvent(customEventFor(event));
  return event;
}

export function emitAnalyticsEvent<Name extends AnalyticsEventName>(
  name: Name,
  properties: AnalyticsPropertiesFor<Name>,
  options: AnalyticsEmitOptions = {},
  target?: AnalyticsEventTarget,
) {
  return dispatchAnalyticsEvent(createAnalyticsEvent(name, properties, options), target) as AnalyticsEvent<Name>;
}

export function createAnalyticsDispatcher(options: {
  correlationId?: string;
  target?: AnalyticsEventTarget;
} = {}) {
  const correlationId = options.correlationId ?? createAnalyticsCorrelationId();
  assertSafeToken(correlationId, 'correlationId');

  return Object.freeze({
    correlationId,
    emit<Name extends AnalyticsEventName>(
      name: Name,
      properties: AnalyticsPropertiesFor<Name>,
      emitOptions: Omit<AnalyticsEmitOptions, 'correlationId'> = {},
    ) {
      return emitAnalyticsEvent(name, properties, { ...emitOptions, correlationId }, options.target);
    },
  });
}
