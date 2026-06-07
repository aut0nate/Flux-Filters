import type { MinifluxEntry } from "./miniflux.js";

export type DedupeMatchStage = "url" | "title" | "similar-title";

export interface DedupeEntrySummary {
  id: number;
  feedId: number;
  feedTitle: string;
  title: string;
  url: string;
  publishedAt: string;
}

export interface DedupeGroup {
  id: string;
  stage: DedupeMatchStage;
  reason: string;
  score: number;
  keeper: DedupeEntrySummary;
  duplicates: DedupeEntrySummary[];
}

export interface DedupePreview {
  generatedAt: string;
  windowDays: number;
  totalUnreadEntries: number;
  groups: DedupeGroup[];
  markReadEntryIds: number[];
}

export interface DedupeAuditRun {
  id: string;
  mode: "automatic" | "manual";
  createdAt: string;
  windowDays: number;
  totalUnreadEntries: number;
  markedReadCount: number;
  markedReadEntryIds: number[];
  groups: DedupeGroup[];
}

interface DedupeOptions {
  windowDays?: number;
  similarTitleThreshold?: number;
}

const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_SIMILAR_TITLE_THRESHOLD = 0.82;
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "msclkid"
]);
const SOURCE_WORDS = new Set([
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
]);
const TITLE_STOP_WORDS = new Set([
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
]);
const ENTITY_ANCHORED_THRESHOLD = 0.22;
const GENERIC_SHARED_ENTITIES = new Set([
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
]);

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

export function getTitleTokens(value: string): string[] {
  const tokens = normaliseEntryTitle(value)
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((token) => stemToken(token.trim()))
    .filter((token) => token.length > 1)
    .filter((token) => !TITLE_STOP_WORDS.has(token))
    .filter((token) => !SOURCE_WORDS.has(token));

  return [...new Set(tokens)];
}

export function scoreSimilarTitles(left: string, right: string): number {
  const leftTokens = getTitleTokens(left);
  const rightTokens = getTitleTokens(right);

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const shared = [...leftSet].filter((token) => rightSet.has(token)).length;
  const tokenScore = (2 * shared) / (leftSet.size + rightSet.size);
  const entityScore = scoreSharedEntities(left, right, tokenScore);

  return Number(Math.max(tokenScore, entityScore).toFixed(3));
}

export function createDedupePreview(
  entries: MinifluxEntry[],
  options: DedupeOptions = {}
): DedupePreview {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const similarTitleThreshold = options.similarTitleThreshold ?? DEFAULT_SIMILAR_TITLE_THRESHOLD;
  const unreadEntries = entries
    .filter((entry) => entry.status === "unread")
    .sort(compareEntriesOldestFirst);
  const consumedEntryIds = new Set<number>();
  const groups: DedupeGroup[] = [];

  groups.push(
    ...createExactGroups(
      unreadEntries,
      "url",
      (entry) => normaliseEntryUrl(entry.url),
      "Same normalised URL",
      consumedEntryIds
    )
  );
  groups.push(
    ...createExactGroups(
      unreadEntries,
      "title",
      (entry) => normaliseEntryTitle(entry.title),
      "Same normalised title",
      consumedEntryIds
    )
  );
  groups.push(...createSimilarTitleGroups(unreadEntries, windowDays, similarTitleThreshold, consumedEntryIds));

  const markReadEntryIds = [...new Set(groups.flatMap((group) => group.duplicates.map((entry) => entry.id)))];

  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    totalUnreadEntries: unreadEntries.length,
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
    .map(([key, groupEntries]) => createGroup(stage, reason, key, 1, groupEntries, consumedEntryIds));
}

function createSimilarTitleGroups(
  entries: MinifluxEntry[],
  windowDays: number,
  threshold: number,
  consumedEntryIds: Set<number>
): DedupeGroup[] {
  const groups: DedupeGroup[] = [];
  const maxWindowMs = windowDays * 24 * 60 * 60 * 1000;

  for (const entry of entries) {
    if (consumedEntryIds.has(entry.id)) {
      continue;
    }

    const matches = entries
      .filter((candidate) => candidate.id !== entry.id && !consumedEntryIds.has(candidate.id))
      .map((candidate) => ({
        entry: candidate,
        score: scoreSimilarTitles(entry.title, candidate.title)
      }))
      .filter(({ entry: candidate, score }) => {
        const distance = Math.abs(getEntryTime(entry) - getEntryTime(candidate));
        return distance <= maxWindowMs && score >= threshold;
      });

    if (matches.length === 0) {
      continue;
    }

    const groupEntries = [entry, ...matches.map((match) => match.entry)];
    const score = Math.min(...matches.map((match) => match.score));
    groups.push(
      createGroup(
        "similar-title",
        `Similar title within the ${windowDays}-day window`,
        normaliseEntryTitle(entry.title),
        score,
        groupEntries,
        consumedEntryIds
      )
    );
  }

  return groups;
}

function createGroup(
  stage: DedupeMatchStage,
  reason: string,
  key: string,
  score: number,
  entries: MinifluxEntry[],
  consumedEntryIds: Set<number>
): DedupeGroup {
  const sortedEntries = [...entries].sort(compareEntriesOldestFirst);
  const [keeper, ...duplicates] = sortedEntries;

  for (const entry of duplicates) {
    consumedEntryIds.add(entry.id);
  }

  return {
    id: `${stage}-${hashGroupKey(key)}-${keeper.id}`,
    stage,
    reason,
    score,
    keeper: summariseEntry(keeper),
    duplicates: duplicates.map(summariseEntry)
  };
}

function summariseEntry(entry: MinifluxEntry): DedupeEntrySummary {
  return {
    id: entry.id,
    feedId: entry.feed_id,
    feedTitle: entry.feed?.title ?? `Feed ${entry.feed_id}`,
    title: entry.title,
    url: entry.url,
    publishedAt: entry.published_at
  };
}

function compareEntriesOldestFirst(left: MinifluxEntry, right: MinifluxEntry): number {
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

function scoreSharedEntities(left: string, right: string, tokenScore: number): number {
  if (tokenScore < ENTITY_ANCHORED_THRESHOLD) {
    return 0;
  }

  const leftEntities = getTitleEntities(left);
  const rightEntities = new Set(getTitleEntities(right));
  const hasSharedEntity = leftEntities.some(
    (entity) => rightEntities.has(entity) && isDistinctiveSharedEntity(entity)
  );

  if (!hasSharedEntity) {
    return 0;
  }

  return Math.min(0.9, 0.74 + tokenScore * 0.45);
}

function getTitleEntities(value: string): string[] {
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
    .filter((entity) => !SOURCE_WORDS.has(entity));
}

function isDistinctiveSharedEntity(entity: string): boolean {
  if (GENERIC_SHARED_ENTITIES.has(entity)) {
    return false;
  }

  if (/\b(?:cup|league|championship|tournament|opener|qualifier|finals?)\b/.test(entity)) {
    return false;
  }

  return true;
}

function hashGroupKey(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36);
}
