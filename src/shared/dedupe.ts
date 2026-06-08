import type { MinifluxEntry } from "./miniflux.js";

export type DedupeMatchStage = "url" | "title" | "similar-title" | "semantic-title";

export interface DedupeEntrySummary {
  id: number;
  feedId: number;
  feedTitle: string;
  title: string;
  url: string;
  publishedAt: string;
  status: MinifluxEntry["status"];
}

export interface DedupeGroup {
  id: string;
  stage: DedupeMatchStage;
  reason: string;
  score: number;
  keeper: DedupeEntrySummary;
  duplicates: DedupeEntrySummary[];
}

export interface DedupeLlmSummary {
  enabled: boolean;
  model: string | null;
  candidatePairs: number;
  checkedPairs: number;
  matchedPairs: number;
  rejectedPairs: number;
  skippedPairs: number;
  error?: string;
}

export interface DedupePreview {
  generatedAt: string;
  windowDays: number;
  totalUnreadEntries: number;
  totalCheckedEntries: number;
  groups: DedupeGroup[];
  markReadEntryIds: number[];
  llm?: DedupeLlmSummary;
}

export interface DedupeAuditRun {
  id: string;
  mode: "automatic" | "manual";
  createdAt: string;
  windowDays: number;
  totalUnreadEntries: number;
  totalCheckedEntries: number;
  markedReadCount: number;
  markedReadEntryIds: number[];
  groups: DedupeGroup[];
  llm?: DedupeLlmSummary;
}

interface DedupeOptions {
  windowDays?: number;
  config?: Partial<DedupeConfig>;
}

const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_SIMILAR_TITLE_THRESHOLD = 0.82;
const DEFAULT_ENTITY_ANCHORED_THRESHOLD = 0.22;
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "msclkid"
]);
const DEFAULT_SOURCE_WORDS = [
  "afp",
  "ap",
  "bbc",
  "bloomberg",
  "cnn",
  "ft",
  "guardian",
  "reuters",
  "report",
  "reports",
  "says",
  "source",
  "sources"
];
const DEFAULT_TITLE_STOP_WORDS = [
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "did",
  "does",
  "down",
  "for",
  "from",
  "has",
  "have",
  "he",
  "her",
  "high",
  "his",
  "how",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "over",
  "she",
  "so",
  "their",
  "the",
  "they",
  "to",
  "up",
  "was",
  "were",
  "with"
];
const DEFAULT_GENERIC_SHARED_ENTITIES = [
  "africa cup",
  "asian cup",
  "carabao cup",
  "champions league",
  "club world cup",
  "europa league",
  "fa cup",
  "nations league",
  "premier league",
  "world cup",
  "world cup 2026"
];
const DEFAULT_GENERIC_ENTITY_PATTERN =
  "\\b(?:cup|league|championship|tournament|opener|qualifier|finals?)\\b";

export interface DedupeConfig {
  similarTitleThreshold: number;
  sourceWords: string[];
  titleStopWords: string[];
  entityAnchoredThreshold: number;
  genericSharedEntities: string[];
  genericEntityPattern: string;
}

export const DEFAULT_DEDUPE_CONFIG: DedupeConfig = {
  similarTitleThreshold: DEFAULT_SIMILAR_TITLE_THRESHOLD,
  sourceWords: DEFAULT_SOURCE_WORDS,
  titleStopWords: DEFAULT_TITLE_STOP_WORDS,
  entityAnchoredThreshold: DEFAULT_ENTITY_ANCHORED_THRESHOLD,
  genericSharedEntities: DEFAULT_GENERIC_SHARED_ENTITIES,
  genericEntityPattern: DEFAULT_GENERIC_ENTITY_PATTERN
};

export function normaliseDedupeConfig(config: Partial<DedupeConfig> = {}): DedupeConfig {
  return {
    similarTitleThreshold: getConfigNumber(
      config.similarTitleThreshold,
      DEFAULT_DEDUPE_CONFIG.similarTitleThreshold,
      0,
      1
    ),
    sourceWords: normaliseConfigWords(config.sourceWords, DEFAULT_DEDUPE_CONFIG.sourceWords),
    titleStopWords: normaliseConfigWords(config.titleStopWords, DEFAULT_DEDUPE_CONFIG.titleStopWords),
    entityAnchoredThreshold: getConfigNumber(
      config.entityAnchoredThreshold,
      DEFAULT_DEDUPE_CONFIG.entityAnchoredThreshold,
      0,
      1
    ),
    genericSharedEntities: normaliseConfigWords(
      config.genericSharedEntities,
      DEFAULT_DEDUPE_CONFIG.genericSharedEntities
    ),
    genericEntityPattern: config.genericEntityPattern?.trim() || DEFAULT_DEDUPE_CONFIG.genericEntityPattern
  };
}

export function normaliseEntryUrl(value: string): string {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return "";
  }

  try {
    const url = new URL(trimmedValue);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();

    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }

    url.searchParams.sort();

    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }

    return url.toString();
  } catch {
    return trimmedValue.toLowerCase().replace(/#.*$/, "").replace(/\/+$/, "");
  }
}

export function normaliseEntryTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, "\"")
    .replace(/\s+/g, " ")
    .replace(/\s+-\s+[^-]{2,40}$/g, "")
    .trim();
}

export function getTitleTokens(value: string, config: Partial<DedupeConfig> = {}): string[] {
  const resolvedConfig = normaliseDedupeConfig(config);
  const titleStopWords = new Set(resolvedConfig.titleStopWords);
  const sourceWords = new Set(resolvedConfig.sourceWords);
  const tokens = normaliseEntryTitle(value)
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((token) => stemToken(token.trim()))
    .filter((token) => token.length > 1)
    .filter((token) => !titleStopWords.has(token))
    .filter((token) => !sourceWords.has(token));

  return [...new Set(tokens)];
}

export function scoreSimilarTitles(
  left: string,
  right: string,
  config: Partial<DedupeConfig> = {}
): number {
  const resolvedConfig = normaliseDedupeConfig(config);
  const leftTokens = getTitleTokens(left, resolvedConfig);
  const rightTokens = getTitleTokens(right, resolvedConfig);

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const shared = [...leftSet].filter((token) => rightSet.has(token)).length;
  const tokenScore = (2 * shared) / (leftSet.size + rightSet.size);
  const entityScore = scoreSharedEntities(left, right, tokenScore, resolvedConfig);

  return Number(Math.max(tokenScore, entityScore).toFixed(3));
}

export function createDedupePreview(
  entries: MinifluxEntry[],
  options: DedupeOptions = {}
): DedupePreview {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const dedupeEntries = entries
    .filter((entry) => entry.status === "read" || entry.status === "unread")
    .sort(compareEntriesOldestFirst);
  const unreadEntries = dedupeEntries.filter((entry) => entry.status === "unread");
  const consumedEntryIds = new Set<number>();
  const groups: DedupeGroup[] = [];

  groups.push(
    ...createExactGroups(
      dedupeEntries,
      "url",
      (entry) => normaliseEntryUrl(entry.url),
      "Same normalised URL",
      consumedEntryIds
    )
  );
  groups.push(
    ...createExactGroups(
      dedupeEntries,
      "title",
      (entry) => normaliseEntryTitle(entry.title),
      "Same normalised title",
      consumedEntryIds
    )
  );

  const markReadEntryIds = [...new Set(groups.flatMap((group) => group.duplicates.map((entry) => entry.id)))];

  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    totalUnreadEntries: unreadEntries.length,
    totalCheckedEntries: dedupeEntries.length,
    groups,
    markReadEntryIds
  };
}

function createExactGroups(
  entries: MinifluxEntry[],
  stage: Extract<DedupeMatchStage, "url" | "title">,
  getKey: (entry: MinifluxEntry) => string,
  reason: string,
  consumedEntryIds: Set<number>
): DedupeGroup[] {
  const groupedEntries = new Map<string, MinifluxEntry[]>();

  for (const entry of entries) {
    if (consumedEntryIds.has(entry.id)) {
      continue;
    }

    const key = getKey(entry);
    if (!key) {
      continue;
    }

    groupedEntries.set(key, [...(groupedEntries.get(key) ?? []), entry]);
  }

  return [...groupedEntries.entries()]
    .filter(([, groupEntries]) => groupEntries.length > 1)
    .flatMap(([key, groupEntries]) => {
      const group = createGroup(stage, reason, key, 1, groupEntries);

      if (!hasUnreadDuplicates(group)) {
        return [];
      }

      consumeGroupDuplicates(groupEntries, consumedEntryIds);
      return [group];
    });
}

function createGroup(
  stage: DedupeMatchStage,
  reason: string,
  key: string,
  score: number,
  entries: MinifluxEntry[]
): DedupeGroup {
  const sortedEntries = [...entries].sort(compareEntriesOldestFirst);
  const [keeper, ...duplicates] = sortedEntries;
  const unreadDuplicates = duplicates.filter((entry) => entry.status === "unread");

  return {
    id: `${stage}-${hashGroupKey(key)}-${keeper.id}`,
    stage,
    reason,
    score,
    keeper: summariseEntry(keeper),
    duplicates: unreadDuplicates.map(summariseEntry)
  };
}

function hasUnreadDuplicates(group: DedupeGroup): boolean {
  return group.duplicates.length > 0;
}

function consumeGroupDuplicates(entries: MinifluxEntry[], consumedEntryIds: Set<number>): void {
  const [, ...duplicates] = [...entries].sort(compareEntriesOldestFirst);

  for (const entry of duplicates) {
    consumedEntryIds.add(entry.id);
  }
}

export function summariseEntry(entry: MinifluxEntry): DedupeEntrySummary {
  return {
    id: entry.id,
    feedId: entry.feed_id,
    feedTitle: entry.feed?.title ?? `Feed ${entry.feed_id}`,
    title: entry.title,
    url: entry.url,
    publishedAt: entry.published_at,
    status: entry.status
  };
}

export function compareEntriesOldestFirst(left: MinifluxEntry, right: MinifluxEntry): number {
  const timeDifference = getEntryTime(left) - getEntryTime(right);

  if (timeDifference !== 0) {
    return timeDifference;
  }

  return left.id - right.id;
}

function getEntryTime(entry: MinifluxEntry): number {
  const timestamp = Date.parse(entry.published_at);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function stemToken(token: string): string {
  if (token.length > 5 && token.endsWith("ing")) {
    return token.slice(0, -3);
  }

  if (token.length > 4 && token.endsWith("ed")) {
    return token.slice(0, -2);
  }

  if (token.length > 4 && token.endsWith("es")) {
    return token.slice(0, -2);
  }

  if (token.length > 3 && token.endsWith("s")) {
    return token.slice(0, -1);
  }

  return token;
}

function scoreSharedEntities(
  left: string,
  right: string,
  tokenScore: number,
  config: DedupeConfig
): number {
  if (tokenScore < config.entityAnchoredThreshold) {
    return 0;
  }

  const leftEntities = getTitleEntities(left, config);
  const rightEntities = new Set(getTitleEntities(right, config));
  const hasSharedEntity = leftEntities.some(
    (entity) => rightEntities.has(entity) && isDistinctiveSharedEntity(entity, config)
  );

  if (!hasSharedEntity) {
    return 0;
  }

  return Math.min(0.9, 0.74 + tokenScore * 0.45);
}

function getTitleEntities(value: string, config: DedupeConfig): string[] {
  const sourceWords = new Set(config.sourceWords);
  const matches = value.matchAll(
    /\b(?:[A-Z][a-z]+|[A-Z]{2,})(?:['’]s)?(?:\s+(?:[A-Z][a-z]+|[A-Z]{2,})(?:['’]s)?)+/g
  );

  return [...matches]
    .map((match) =>
      match[0]
        .replace(/[’']/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
    .trim()
    )
    .filter((entity) => entity.split(" ").length >= 2)
    .filter((entity) => !sourceWords.has(entity));
}

function isDistinctiveSharedEntity(entity: string, config: DedupeConfig): boolean {
  if (new Set(config.genericSharedEntities).has(entity)) {
    return false;
  }

  if (new RegExp(config.genericEntityPattern).test(entity)) {
    return false;
  }

  return true;
}

function getConfigNumber(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(value, minimum), maximum);
}

function normaliseConfigWords(value: string[] | undefined, fallback: string[]): string[] {
  const words = Array.isArray(value) ? value : fallback;

  return [
    ...new Set(
      words
        .map((word) => word.trim().toLowerCase().replace(/\s+/g, " "))
        .filter(Boolean)
    )
  ];
}

function hashGroupKey(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36);
}
