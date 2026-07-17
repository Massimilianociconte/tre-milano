export const GROUP_SESSION_VERSION = 1 as const;
export const GROUP_SESSION_HASH_KEY = 'g';
export const GROUP_SESSION_MIN_PARTICIPANTS = 2;
export const GROUP_SESSION_MAX_PARTICIPANTS = 6;
export const GROUP_SESSION_MAX_PAYLOAD_LENGTH = 2_048;

export const GROUP_INTENTS = [
  { id: 'aperitivo', label: 'Aperitivo' },
  { id: 'cena', label: 'Cena' },
  { id: 'cocktail', label: 'Cocktail d’autore' },
  { id: 'rooftop', label: 'Rooftop' },
  { id: 'romantico', label: 'Intimo e romantico' },
  { id: 'conviviale', label: 'Conviviale' },
  { id: 'tranquillo', label: 'Tranquillo' },
  { id: 'vivace', label: 'Vivace' },
  { id: 'panoramico', label: 'Vista panoramica' },
  { id: 'creativo', label: 'Creativo' },
] as const;

export const GROUP_AREAS = [
  { id: 'brera', label: 'Brera' },
  { id: 'duomo', label: 'Duomo' },
  { id: 'isola', label: 'Isola' },
  { id: 'moscova', label: 'Moscova' },
  { id: 'navigli', label: 'Navigli' },
  { id: 'porta-romana', label: 'Porta Romana' },
] as const;

export const GROUP_BUDGET_LEVELS = [1, 2, 3, 4] as const;
export const GROUP_TRAVEL_LIMITS = [10, 20, 30, 45] as const;

export type GroupIntentId = (typeof GROUP_INTENTS)[number]['id'];
export type GroupAreaId = (typeof GROUP_AREAS)[number]['id'];
export type GroupBudgetLevel = (typeof GROUP_BUDGET_LEVELS)[number];
export type GroupTravelLimit = (typeof GROUP_TRAVEL_LIMITS)[number];

export type GroupHardConstraints = {
  maxBudget?: GroupBudgetLevel;
  maxMinutes?: GroupTravelLimit;
  /** Empty means that every area is acceptable for this participant. */
  areas: GroupAreaId[];
};

export type GroupParticipant = {
  /** Anonymous, taxonomised signals only. Labels such as "Persona 1" are derived in the UI. */
  intents: GroupIntentId[];
  hard: GroupHardConstraints;
  /** Optional first-choice vote over the same closed taxonomy. */
  vote?: GroupIntentId;
};

export type GroupSession = {
  version: typeof GROUP_SESSION_VERSION;
  participants: GroupParticipant[];
};

export type GroupHardIntersection = {
  maxBudget?: GroupBudgetLevel;
  maxMinutes?: GroupTravelLimit;
  /** `undefined` means every area; an empty array means the declared areas conflict. */
  areas?: GroupAreaId[];
  conflicts: Array<'areas'>;
};

export type GroupOption = {
  /** Stable catalogue identifier. It is never interpreted as display copy. */
  id: string;
  intents: GroupIntentId[];
  area?: GroupAreaId;
  budgetLevel?: GroupBudgetLevel;
  minutes?: number;
};

export type RankedGroupOption<T extends GroupOption = GroupOption> = {
  option: T;
  participantUtilities: number[];
  averageUtility: number;
  maxRegret: number;
  supporters: number;
};

export type GroupIntentScore = {
  intent: GroupIntentId;
  label: string;
  averageUtility: number;
  maxRegret: number;
  supporters: number;
};

type CompactParticipant = {
  i?: number[];
  b?: GroupBudgetLevel;
  m?: GroupTravelLimit;
  a?: number[];
  x?: number;
};

type CompactGroupSession = {
  v: typeof GROUP_SESSION_VERSION;
  p: CompactParticipant[];
};

const intentIndex = new Map<GroupIntentId, number>(GROUP_INTENTS.map(({ id }, index) => [id, index]));
const areaIndex = new Map<GroupAreaId, number>(GROUP_AREAS.map(({ id }, index) => [id, index]));
const intentIds = new Set<GroupIntentId>(GROUP_INTENTS.map(({ id }) => id));
const areaIds = new Set<GroupAreaId>(GROUP_AREAS.map(({ id }) => id));
const budgetLevels = new Set<number>(GROUP_BUDGET_LEVELS);
const travelLimits = new Set<number>(GROUP_TRAVEL_LIMITS);
const optionIdPattern = /^[a-z0-9][a-z0-9-]{0,47}$/;

const orderedUnique = <T>(values: readonly T[], order: readonly T[]) => {
  const allowed = new Set(order);
  const present = new Set(values.filter((value) => allowed.has(value)));
  return order.filter((value) => present.has(value));
};

const roundScore = (value: number) => Number(value.toFixed(4));

export function createGroupParticipant(): GroupParticipant {
  return { intents: [], hard: { areas: [] } };
}

export function createGroupSession(participantCount = GROUP_SESSION_MIN_PARTICIPANTS): GroupSession {
  if (!Number.isInteger(participantCount)
    || participantCount < GROUP_SESSION_MIN_PARTICIPANTS
    || participantCount > GROUP_SESSION_MAX_PARTICIPANTS) {
    throw new RangeError(`A group session requires ${GROUP_SESSION_MIN_PARTICIPANTS}–${GROUP_SESSION_MAX_PARTICIPANTS} participants.`);
  }

  return {
    version: GROUP_SESSION_VERSION,
    participants: Array.from({ length: participantCount }, createGroupParticipant),
  };
}

function canonicalParticipant(value: unknown): GroupParticipant | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<GroupParticipant>;
  if (!Array.isArray(candidate.intents)
    || !candidate.hard
    || typeof candidate.hard !== 'object'
    || Array.isArray(candidate.hard)
    || !Array.isArray(candidate.hard.areas)) return null;

  if (!candidate.intents.every((intent): intent is GroupIntentId => typeof intent === 'string' && intentIds.has(intent as GroupIntentId))) return null;
  if (!candidate.hard.areas.every((area): area is GroupAreaId => typeof area === 'string' && areaIds.has(area as GroupAreaId))) return null;
  if (candidate.hard.maxBudget !== undefined && !budgetLevels.has(candidate.hard.maxBudget)) return null;
  if (candidate.hard.maxMinutes !== undefined && !travelLimits.has(candidate.hard.maxMinutes)) return null;
  if (candidate.vote !== undefined && !intentIds.has(candidate.vote)) return null;

  const intents = orderedUnique(candidate.intents, GROUP_INTENTS.map(({ id }) => id));
  const areas = orderedUnique(candidate.hard.areas, GROUP_AREAS.map(({ id }) => id));

  return {
    intents,
    hard: {
      ...(candidate.hard.maxBudget === undefined ? {} : { maxBudget: candidate.hard.maxBudget }),
      ...(candidate.hard.maxMinutes === undefined ? {} : { maxMinutes: candidate.hard.maxMinutes }),
      areas,
    },
    ...(candidate.vote === undefined ? {} : { vote: candidate.vote }),
  };
}

export function canonicalGroupSession(value: unknown): GroupSession | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<GroupSession>;
  if (candidate.version !== GROUP_SESSION_VERSION || !Array.isArray(candidate.participants)) return null;
  if (candidate.participants.length < GROUP_SESSION_MIN_PARTICIPANTS
    || candidate.participants.length > GROUP_SESSION_MAX_PARTICIPANTS) return null;

  const participants = candidate.participants.map(canonicalParticipant);
  if (participants.some((participant) => participant === null)) return null;
  return { version: GROUP_SESSION_VERSION, participants: participants as GroupParticipant[] };
}

function compactSession(session: GroupSession): CompactGroupSession {
  return {
    v: GROUP_SESSION_VERSION,
    p: session.participants.map((participant) => ({
      ...(participant.intents.length ? { i: participant.intents.map((intent) => intentIndex.get(intent) as number) } : {}),
      ...(participant.hard.maxBudget === undefined ? {} : { b: participant.hard.maxBudget }),
      ...(participant.hard.maxMinutes === undefined ? {} : { m: participant.hard.maxMinutes }),
      ...(participant.hard.areas.length ? { a: participant.hard.areas.map((area) => areaIndex.get(area) as number) } : {}),
      ...(participant.vote === undefined ? {} : { x: intentIndex.get(participant.vote) as number }),
    })),
  };
}

function expandCompactParticipant(value: unknown): GroupParticipant | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as CompactParticipant;
  const keys = Object.keys(candidate);
  if (keys.some((key) => !['i', 'b', 'm', 'a', 'x'].includes(key))) return null;
  if (candidate.i !== undefined && (!Array.isArray(candidate.i) || !candidate.i.every((index) => Number.isInteger(index) && GROUP_INTENTS[index]))) return null;
  if (candidate.a !== undefined && (!Array.isArray(candidate.a) || !candidate.a.every((index) => Number.isInteger(index) && GROUP_AREAS[index]))) return null;
  if (candidate.b !== undefined && !budgetLevels.has(candidate.b)) return null;
  if (candidate.m !== undefined && !travelLimits.has(candidate.m)) return null;
  if (candidate.x !== undefined && (!Number.isInteger(candidate.x) || !GROUP_INTENTS[candidate.x])) return null;

  return canonicalParticipant({
    intents: (candidate.i ?? []).map((index) => GROUP_INTENTS[index].id),
    hard: {
      ...(candidate.b === undefined ? {} : { maxBudget: candidate.b }),
      ...(candidate.m === undefined ? {} : { maxMinutes: candidate.m }),
      areas: (candidate.a ?? []).map((index) => GROUP_AREAS[index].id),
    },
    ...(candidate.x === undefined ? {} : { vote: GROUP_INTENTS[candidate.x].id }),
  });
}

function toBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeGroupSession(value: GroupSession) {
  const canonical = canonicalGroupSession(value);
  if (!canonical) throw new TypeError('Invalid group session.');
  return toBase64Url(JSON.stringify(compactSession(canonical)));
}

export function decodeGroupSession(payload: string | null | undefined): GroupSession | null {
  if (!payload
    || payload.length > GROUP_SESSION_MAX_PAYLOAD_LENGTH
    || !/^[A-Za-z0-9_-]+$/.test(payload)) return null;

  try {
    const parsed = JSON.parse(fromBase64Url(payload)) as Partial<CompactGroupSession>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (Object.keys(parsed).some((key) => !['v', 'p'].includes(key))) return null;
    if (parsed.v !== GROUP_SESSION_VERSION || !Array.isArray(parsed.p)) return null;
    if (parsed.p.length < GROUP_SESSION_MIN_PARTICIPANTS || parsed.p.length > GROUP_SESSION_MAX_PARTICIPANTS) return null;
    const participants = parsed.p.map(expandCompactParticipant);
    if (participants.some((participant) => participant === null)) return null;
    return { version: GROUP_SESSION_VERSION, participants: participants as GroupParticipant[] };
  } catch {
    return null;
  }
}

export function createGroupSessionUrl(baseUrl: string | URL, session: GroupSession) {
  const url = new URL(baseUrl);
  url.search = '';
  url.hash = new URLSearchParams({ [GROUP_SESSION_HASH_KEY]: encodeGroupSession(session) }).toString();
  return url.toString();
}

export function readGroupSessionFromUrl(value: string | URL): GroupSession | null {
  try {
    const raw = value instanceof URL ? value.toString() : value.trim();
    if (!raw) return null;
    if (/^[A-Za-z0-9_-]+$/.test(raw) && raw.length <= GROUP_SESSION_MAX_PAYLOAD_LENGTH) return decodeGroupSession(raw);
    const url = raw.startsWith('#') ? new URL(raw, 'https://local.invalid/gruppo/') : new URL(raw);
    const parameters = new URLSearchParams(url.hash.replace(/^#/, ''));
    return decodeGroupSession(parameters.get(GROUP_SESSION_HASH_KEY));
  } catch {
    return null;
  }
}

export function intersectGroupHardConstraints(session: GroupSession): GroupHardIntersection {
  const canonical = canonicalGroupSession(session);
  if (!canonical) return { areas: [], conflicts: ['areas'] };

  const budgets = canonical.participants.flatMap(({ hard }) => hard.maxBudget === undefined ? [] : [hard.maxBudget]);
  const minutes = canonical.participants.flatMap(({ hard }) => hard.maxMinutes === undefined ? [] : [hard.maxMinutes]);
  const declaredAreaSets = canonical.participants
    .map(({ hard }) => hard.areas)
    .filter((areas) => areas.length > 0);

  const areas = declaredAreaSets.length
    ? GROUP_AREAS.map(({ id }) => id).filter((area) => declaredAreaSets.every((declared) => declared.includes(area)))
    : undefined;
  const conflicts: GroupHardIntersection['conflicts'] = areas?.length === 0 ? ['areas'] : [];

  return {
    ...(budgets.length ? { maxBudget: Math.min(...budgets) as GroupBudgetLevel } : {}),
    ...(minutes.length ? { maxMinutes: Math.min(...minutes) as GroupTravelLimit } : {}),
    ...(areas === undefined ? {} : { areas }),
    conflicts,
  };
}

function optionEligible(option: GroupOption, hard: GroupHardIntersection) {
  if (hard.conflicts.length) return false;
  if (hard.maxBudget !== undefined && (option.budgetLevel === undefined || option.budgetLevel > hard.maxBudget)) return false;
  if (hard.maxMinutes !== undefined && (option.minutes === undefined || option.minutes > hard.maxMinutes)) return false;
  if (hard.areas !== undefined && (option.area === undefined || !hard.areas.includes(option.area))) return false;
  return true;
}

function participantUtility(participant: GroupParticipant, option: GroupOption) {
  const matches = participant.intents.filter((intent) => option.intents.includes(intent)).length;
  let utility = participant.intents.length ? matches / participant.intents.length : 0.5;
  if (participant.vote && option.intents.includes(participant.vote)) utility = Math.min(1, utility + 0.25);
  return roundScore(utility);
}

/**
 * Ranks only options in the intersection of every hard constraint. Among those,
 * minimising the worst participant regret comes before average utility. Stable
 * option ids are the final tie-break, so results do not depend on input order.
 */
export function rankGroupOptions<T extends GroupOption>(session: GroupSession, options: readonly T[]): RankedGroupOption<T>[] {
  const canonical = canonicalGroupSession(session);
  if (!canonical) return [];
  const hard = intersectGroupHardConstraints(canonical);
  const eligible = options
    .filter((option) => optionIdPattern.test(option.id)
      && option.intents.length > 0
      && option.intents.every((intent) => intentIds.has(intent)))
    .filter((option) => optionEligible(option, hard));
  if (!eligible.length) return [];

  const utilities = eligible.map((option) => canonical.participants.map((participant) => participantUtility(participant, option)));
  const bestByParticipant = canonical.participants.map((_, participantIndex) => (
    Math.max(...utilities.map((optionUtilities) => optionUtilities[participantIndex]))
  ));

  return eligible.map((option, optionIndex) => {
    const participantUtilities = utilities[optionIndex];
    const regrets = participantUtilities.map((utility, index) => bestByParticipant[index] - utility);
    return {
      option,
      participantUtilities,
      averageUtility: roundScore(participantUtilities.reduce((total, utility) => total + utility, 0) / participantUtilities.length),
      maxRegret: roundScore(Math.max(...regrets)),
      supporters: participantUtilities.filter((utility) => utility >= 0.75).length,
    };
  }).sort((left, right) => (
    left.maxRegret - right.maxRegret
    || right.averageUtility - left.averageUtility
    || right.supporters - left.supporters
    || left.option.id.localeCompare(right.option.id, 'en-US')
  ));
}

export function aggregateGroupPreferences(session: GroupSession): GroupIntentScore[] {
  const canonical = canonicalGroupSession(session);
  if (!canonical) return [];
  // Taxonomic directions have no venue-level price/area facts. Hard constraints
  // remain visible in their own intersection and are applied later to concrete
  // options; they must not erase this preference-only explanation.
  const preferenceOnlySession: GroupSession = {
    ...canonical,
    participants: canonical.participants.map((participant) => ({
      ...participant,
      hard: { areas: [] },
    })),
  };
  const ranked = rankGroupOptions(preferenceOnlySession, GROUP_INTENTS.map(({ id }) => ({ id, intents: [id] })));
  const byId = new Map(GROUP_INTENTS.map(({ id, label }, order) => [id, { label, order }]));
  return ranked.map(({ option, averageUtility, maxRegret, supporters }) => ({
    intent: option.intents[0],
    label: byId.get(option.intents[0])?.label ?? option.intents[0],
    averageUtility,
    maxRegret,
    supporters,
  })).sort((left, right) => (
    left.maxRegret - right.maxRegret
    || right.averageUtility - left.averageUtility
    || right.supporters - left.supporters
    || (byId.get(left.intent)?.order ?? 0) - (byId.get(right.intent)?.order ?? 0)
  ));
}
