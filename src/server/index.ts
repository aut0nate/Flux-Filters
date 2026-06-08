import "dotenv/config";
import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setImmediate as waitImmediate } from "node:timers/promises";

import {
  compareEntriesOldestFirst,
  createDedupePreview,
  normaliseDedupeConfig,
  scoreSimilarTitles,
  summariseEntry,
  type DedupeAuditRun,
  type DedupeConfig,
  type DedupeGroup,
  type DedupeLlmSummary,
  type DedupePreview
} from "../shared/dedupe.js";
import type {
  MinifluxEntriesResponse,
  MinifluxEntry,
  MinifluxFeed,
  MinifluxUser
} from "../shared/miniflux.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const clientDist = path.resolve(process.cwd(), "dist/client");
const dedupeAuditPath =
  process.env.DEDUPE_AUDIT_PATH || path.resolve(process.cwd(), "data/dedupe-audit.jsonl");
const dedupeConfigPath =
  process.env.DEDUPE_CONFIG_PATH || path.resolve(process.cwd(), "data/dedupe-config.json");
const failedFeedsStatePath =
  process.env.FAILED_FEEDS_STATE_PATH ||
  path.resolve(process.cwd(), "data/failed-feeds-notification-state.json");
const minifluxRequestTimeoutMs =
  getPositiveIntegerEnv("MINIFLUX_REQUEST_TIMEOUT_SECONDS", 15, 1, 120) * 1000;
const openRouterRequestTimeoutMs =
  getPositiveIntegerEnv("OPENROUTER_REQUEST_TIMEOUT_SECONDS", 10, 1, 120) * 1000;

app.use(express.json({ limit: "1mb" }));

interface SessionPayload {
  serverUrl: string;
  apiToken: string;
}

interface FeedRulesPayload {
  blocklistRules: string;
  keeplistRules: string;
}

interface DedupeApplyPayload {
  entryIds: number[];
}

interface DedupeJobConfig {
  enabled: boolean;
  intervalMinutes: number;
  windowDays: number;
  session: SessionPayload | null;
}

interface DedupeRuntimeConfig extends DedupeConfig {
  llmCandidateMinScore: number;
  llmAutoMatchConfidence: number;
  llmMaxPairs: number;
}

interface OpenRouterConfig {
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface SemanticTitleDecision {
  sameStory: boolean;
  confidence: number;
  reason: string;
}

interface SemanticTitleCandidate {
  keeper: MinifluxEntry;
  duplicate: MinifluxEntry;
  localScore: number;
}

interface NtfyConfig {
  baseUrl: string;
  topic: string;
  accessToken: string;
}

interface FailedFeedsJobConfig {
  enabled: boolean;
  intervalMinutes: number;
  session: SessionPayload | null;
  ntfy: NtfyConfig | null;
}

interface DedupeNotificationConfig {
  enabled: boolean;
  ntfy: NtfyConfig | null;
}

interface FailedFeedNotificationState {
  signature: string;
  notifiedAt: string;
}

interface FailedFeedSummary {
  id: number;
  title: string;
  feedUrl: string;
  siteUrl: string;
  checkedAt: string | null;
  errorCount: number;
  errorMessage: string;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function getAllowedHosts(): string[] {
  return (process.env.MINIFLUX_ALLOWED_HOSTS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function normaliseServerUrl(input: string): string {
  const value = input.trim();
  const url = new URL(value);

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only http and https server addresses are supported.");
  }

  const allowedHosts = getAllowedHosts();
  if (allowedHosts.length > 0) {
    const matchesAllowedHost = allowedHosts.some(
      (host) => host === url.host || host === url.hostname
    );

    if (!matchesAllowedHost) {
      throw new Error("This server address is not allowed by the proxy configuration.");
    }
  }

  const pathname = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  return `${url.origin}${pathname}`;
}

function joinUpstreamUrl(baseUrl: string, endpoint: string): string {
  const url = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  return new URL(endpoint.replace(/^\//, ""), url).toString();
}

function joinNtfyTopicUrl(config: NtfyConfig): string {
  const baseUrl = config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`;
  return new URL(encodeURIComponent(config.topic), baseUrl).toString();
}

function getSessionFromHeaders(request: express.Request): SessionPayload {
  const serverUrl = request.header("x-miniflux-base-url") || "";
  const apiToken = request.header("x-miniflux-token") || "";

  if (!serverUrl || !apiToken) {
    throw new Error("Missing Miniflux server address or API token.");
  }

  return {
    serverUrl: normaliseServerUrl(serverUrl),
    apiToken
  };
}

async function minifluxRequest<T>(
  session: SessionPayload,
  endpoint: string,
  init?: RequestInit
): Promise<T> {
  const signal = init?.signal ?? AbortSignal.timeout(minifluxRequestTimeoutMs);

  const response = await fetch(joinUpstreamUrl(session.serverUrl, endpoint), {
    ...init,
    signal,
    headers: {
      Accept: "application/json",
      "X-Auth-Token": session.apiToken,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {})
    }
  });

  if (!response.ok) {
    let message = "Miniflux request failed.";

    try {
      const data = (await response.json()) as { error_message?: string };
      if (data?.error_message) {
        message = data.error_message;
      }
    } catch {
      message = response.statusText || message;
    }

    const error = new Error(message);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function fetchRecentEntriesForDedupe(
  session: SessionPayload,
  windowDays: number
): Promise<MinifluxEntriesResponse> {
  const limit = 100;
  const entries: MinifluxEntriesResponse["entries"] = [];
  const publishedAfter = Math.floor((Date.now() - windowDays * 24 * 60 * 60 * 1000) / 1000);

  for (let offset = 0; ; offset += limit) {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      order: "published_at",
      direction: "desc",
      published_after: String(publishedAfter)
    });
    const response = await minifluxRequest<MinifluxEntriesResponse>(
      session,
      `/v1/entries?${params.toString()}`
    );

    entries.push(...response.entries);

    if (entries.length >= response.total || response.entries.length === 0) {
      break;
    }
  }

  return {
    total: entries.length,
    entries
  };
}

function getDedupeWindowDays(input: unknown): number {
  const requestedWindowDays = Number(input ?? 7);

  if (!Number.isInteger(requestedWindowDays)) {
    return 7;
  }

  return Math.min(Math.max(requestedWindowDays, 1), 30);
}

function getEntryIds(input: unknown): number[] {
  if (!Array.isArray(input)) {
    throw new Error("Entry ids must be provided as a list.");
  }

  const entryIds = input.map(Number);

  if (entryIds.some((entryId) => !Number.isInteger(entryId) || entryId <= 0)) {
    throw new Error("Entry ids must be positive numbers.");
  }

  return [...new Set(entryIds)].slice(0, 500);
}

function getPositiveIntegerEnv(name: string, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(process.env[name] ?? fallback);

  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, minimum), maximum);
}

function getNumberEnv(name: string, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(process.env[name] ?? fallback);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, minimum), maximum);
}

async function loadDedupeConfig(): Promise<DedupeRuntimeConfig> {
  let fileConfig: Partial<DedupeRuntimeConfig> = {};

  try {
    fileConfig = JSON.parse(await fs.readFile(dedupeConfigPath, "utf8")) as Partial<DedupeRuntimeConfig>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error("Unable to read dedupe config. Check that DEDUPE_CONFIG_PATH contains valid JSON.", {
        cause: error
      });
    }
  }

  const deterministicConfig = normaliseDedupeConfig({
    ...fileConfig,
    similarTitleThreshold: getNumberEnv(
      "DEDUPE_SIMILAR_TITLE_THRESHOLD",
      fileConfig.similarTitleThreshold ?? 0.82,
      0,
      1
    )
  });

  return {
    ...deterministicConfig,
    llmCandidateMinScore: getNumberEnv(
      "DEDUPE_LLM_CANDIDATE_MIN_SCORE",
      fileConfig.llmCandidateMinScore ?? 0.45,
      0,
      1
    ),
    llmAutoMatchConfidence: getNumberEnv(
      "DEDUPE_LLM_AUTO_CONFIDENCE",
      fileConfig.llmAutoMatchConfidence ?? 0.93,
      0,
      1
    ),
    llmMaxPairs: getPositiveIntegerEnv(
      "DEDUPE_LLM_MAX_PAIRS",
      fileConfig.llmMaxPairs ?? 30,
      0,
      250
    )
  };
}

function getOpenRouterConfig(): OpenRouterConfig | null {
  if (process.env.DEDUPE_LLM_ENABLED !== "true") {
    return null;
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim() || "";

  if (!apiKey) {
    console.error("Dedupe LLM matching is enabled but OPENROUTER_API_KEY is missing.");
    return null;
  }

  const baseUrl = process.env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1";
  const url = new URL(baseUrl);

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only http and https OpenRouter base URLs are supported.");
  }

  return {
    enabled: true,
    apiKey,
    baseUrl: `${url.origin}${url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname}`,
    model: process.env.OPENROUTER_MODEL?.trim() || "google/gemma-4-26b-a4b-it"
  };
}

function getDedupeJobConfig(): DedupeJobConfig {
  const enabled = process.env.DEDUPE_AUTOMATION_ENABLED === "true";
  const serverUrl = process.env.MINIFLUX_BASE_URL || "";
  const apiToken = process.env.MINIFLUX_API_TOKEN || "";
  const session =
    serverUrl && apiToken
      ? {
          serverUrl: normaliseServerUrl(serverUrl),
          apiToken
        }
      : null;

  return {
    enabled,
    intervalMinutes: getPositiveIntegerEnv("DEDUPE_INTERVAL_MINUTES", 30, 5, 1440),
    windowDays: getPositiveIntegerEnv("DEDUPE_WINDOW_DAYS", 7, 1, 30),
    session
  };
}

function getServerMinifluxSession(): SessionPayload | null {
  const serverUrl = process.env.MINIFLUX_BASE_URL || "";
  const apiToken = process.env.MINIFLUX_API_TOKEN || "";

  if (!serverUrl || !apiToken) {
    return null;
  }

  return {
    serverUrl: normaliseServerUrl(serverUrl),
    apiToken
  };
}

function getNtfyConfig(): NtfyConfig | null {
  const baseUrl = process.env.NTFY_BASE_URL?.trim() || "";
  const topic = process.env.NTFY_TOPIC?.trim() || "";
  const accessToken = process.env.NTFY_ACCESS_TOKEN?.trim() || "";

  if (!baseUrl || !topic || !accessToken) {
    return null;
  }

  const url = new URL(baseUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only http and https ntfy addresses are supported.");
  }

  return {
    baseUrl: `${url.origin}${url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname}`,
    topic,
    accessToken
  };
}

function getFailedFeedsJobConfig(): FailedFeedsJobConfig {
  return {
    enabled: process.env.FAILED_FEEDS_NOTIFICATION_ENABLED === "true",
    intervalMinutes: getPositiveIntegerEnv("FAILED_FEEDS_INTERVAL_MINUTES", 60, 5, 1440),
    session: getServerMinifluxSession(),
    ntfy: getNtfyConfig()
  };
}

function getDedupeNotificationConfig(): DedupeNotificationConfig {
  return {
    enabled: process.env.DEDUPE_NTFY_NOTIFICATION_ENABLED === "true",
    ntfy: getNtfyConfig()
  };
}

function createAuditRun(mode: DedupeAuditRun["mode"], preview: DedupePreview): DedupeAuditRun {
  return {
    id: globalThis.crypto.randomUUID(),
    mode,
    createdAt: new Date().toISOString(),
    windowDays: preview.windowDays,
    totalUnreadEntries: preview.totalUnreadEntries,
    totalCheckedEntries: preview.totalCheckedEntries,
    markedReadCount: preview.markReadEntryIds.length,
    markedReadEntryIds: preview.markReadEntryIds,
    groups: preview.groups,
    llm: preview.llm
  };
}

async function appendDedupeAuditRun(run: DedupeAuditRun): Promise<void> {
  await fs.mkdir(path.dirname(dedupeAuditPath), { recursive: true });
  await fs.appendFile(dedupeAuditPath, `${JSON.stringify(run)}${os.EOL}`, "utf8");
}

async function readDedupeAuditRuns(days = 7): Promise<DedupeAuditRun[]> {
  let rawAuditLog: string;

  try {
    rawAuditLog = await fs.readFile(dedupeAuditPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  return rawAuditLog
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as DedupeAuditRun];
      } catch {
        return [];
      }
    })
    .filter((run) => Date.parse(run.createdAt) >= cutoff)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

async function markEntriesStatus(
  session: SessionPayload,
  entryIds: number[],
  status: "read" | "unread"
): Promise<void> {
  await minifluxRequest<void>(session, "/v1/entries", {
    method: "PUT",
    body: JSON.stringify({
      entry_ids: entryIds,
      status
    })
  });
}

async function createServerDedupePreview(
  entries: MinifluxEntry[],
  windowDays: number,
  options: { includeSemantic?: boolean } = {}
): Promise<DedupePreview> {
  const dedupeConfig = await loadDedupeConfig();
  const preview = createDedupePreview(entries, {
    windowDays,
    config: dedupeConfig
  });
  const openRouterConfig = getOpenRouterConfig();
  const includeSemantic = options.includeSemantic ?? true;

  if (!includeSemantic || !openRouterConfig || dedupeConfig.llmMaxPairs === 0) {
    return {
      ...preview,
      llm: createLlmSummary({
        enabled: includeSemantic && Boolean(openRouterConfig),
        model: openRouterConfig?.model ?? null
      })
    };
  }

  try {
    return await addSemanticTitleGroups(entries, preview, windowDays, dedupeConfig, openRouterConfig);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Dedupe LLM matching failed.";
    console.error(message);
    return {
      ...preview,
      llm: createLlmSummary({
        enabled: true,
        model: openRouterConfig.model,
        error: message
      })
    };
  }
}

async function addSemanticTitleGroups(
  entries: MinifluxEntry[],
  preview: DedupePreview,
  windowDays: number,
  dedupeConfig: DedupeRuntimeConfig,
  openRouterConfig: OpenRouterConfig
): Promise<DedupePreview> {
  const consumedEntryIds = new Set(preview.markReadEntryIds);
  const groups: DedupeGroup[] = [];
  const candidates = await createSemanticTitleCandidates(entries, preview, windowDays, dedupeConfig);
  const llmSummary = createLlmSummary({
    enabled: true,
    model: openRouterConfig.model,
    candidatePairs: candidates.length
  });

  for (const candidate of candidates.slice(0, dedupeConfig.llmMaxPairs)) {
    if (consumedEntryIds.has(candidate.keeper.id) || consumedEntryIds.has(candidate.duplicate.id)) {
      llmSummary.skippedPairs += 1;
      continue;
    }

    const decision = await requestSemanticTitleDecision(openRouterConfig, candidate);
    llmSummary.checkedPairs += 1;

    if (!decision.sameStory || decision.confidence < dedupeConfig.llmAutoMatchConfidence) {
      llmSummary.rejectedPairs += 1;
      continue;
    }

    consumedEntryIds.add(candidate.duplicate.id);
    llmSummary.matchedPairs += 1;
    groups.push(createSemanticTitleGroup(candidate, decision, windowDays));
  }

  llmSummary.skippedPairs += Math.max(candidates.length - dedupeConfig.llmMaxPairs, 0);

  if (groups.length === 0) {
    return {
      ...preview,
      llm: llmSummary
    };
  }

  const allGroups = [...preview.groups, ...groups];

  return {
    ...preview,
    groups: allGroups,
    markReadEntryIds: [...new Set(allGroups.flatMap((group) => group.duplicates.map((entry) => entry.id)))],
    llm: llmSummary
  };
}

function createLlmSummary(summary: Partial<DedupeLlmSummary> = {}): DedupeLlmSummary {
  return {
    enabled: summary.enabled ?? false,
    model: summary.model ?? null,
    candidatePairs: summary.candidatePairs ?? 0,
    checkedPairs: summary.checkedPairs ?? 0,
    matchedPairs: summary.matchedPairs ?? 0,
    rejectedPairs: summary.rejectedPairs ?? 0,
    skippedPairs: summary.skippedPairs ?? 0,
    ...(summary.error ? { error: summary.error } : {})
  };
}

async function createSemanticTitleCandidates(
  entries: MinifluxEntry[],
  preview: DedupePreview,
  windowDays: number,
  dedupeConfig: DedupeRuntimeConfig
): Promise<SemanticTitleCandidate[]> {
  const dedupeEntries = entries
    .filter((entry) => entry.status === "read" || entry.status === "unread")
    .sort(compareEntriesOldestFirst);
  const deterministicEntryIds = new Set([
    ...preview.markReadEntryIds,
    ...preview.groups.flatMap((group) => [group.keeper.id, ...group.duplicates.map((entry) => entry.id)])
  ]);
  const maxWindowMs = windowDays * 24 * 60 * 60 * 1000;
  const candidates: SemanticTitleCandidate[] = [];

  for (let leftIndex = 0; leftIndex < dedupeEntries.length; leftIndex += 1) {
    if (leftIndex > 0 && leftIndex % 50 === 0) {
      await waitImmediate();
    }

    const left = dedupeEntries[leftIndex];

    if (deterministicEntryIds.has(left.id)) {
      continue;
    }

    for (let rightIndex = leftIndex + 1; rightIndex < dedupeEntries.length; rightIndex += 1) {
      const right = dedupeEntries[rightIndex];

      if (deterministicEntryIds.has(right.id)) {
        continue;
      }

      const distance = Math.abs(Date.parse(left.published_at) - Date.parse(right.published_at));
      if (!Number.isFinite(distance) || distance > maxWindowMs) {
        continue;
      }

      const localScore = scoreSimilarTitles(left.title, right.title, dedupeConfig);
      if (localScore < dedupeConfig.llmCandidateMinScore) {
        continue;
      }

      const [keeper, duplicate] = [left, right].sort(compareEntriesOldestFirst);

      if (duplicate.status !== "unread") {
        continue;
      }

      candidates.push({ keeper, duplicate, localScore });
    }
  }

  return candidates.sort((left, right) => right.localScore - left.localScore);
}

async function requestSemanticTitleDecision(
  config: OpenRouterConfig,
  candidate: SemanticTitleCandidate
): Promise<SemanticTitleDecision> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(openRouterRequestTimeoutMs),
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://fluxfilters.autonate.dev",
      "X-Title": "Flux Filters"
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You compare two RSS articles for deduplication. Return compact JSON only: same_story boolean, confidence number from 0 to 1, and reason string. Be strict. same_story is true only when both articles are about the same specific event, announcement, report, match, transfer, court case, road closure, injury, death, product release, or materially identical article angle. Reject matches when they only share a person, team, place, league, tournament, company, broad topic, date window, or feed category. Reject roundups, live blogs, list articles, previews, explainers, opinion pieces, and background profiles unless both titles clearly point to the same specific item within them. If one article is about a different action, outcome, location, organisation, or time, return same_story false. Use confidence >= 0.93 only for near-certain duplicates."
        },
        {
          role: "user",
          content: JSON.stringify({
            article_a: {
              title: candidate.keeper.title,
              url: candidate.keeper.url,
              feed: candidate.keeper.feed?.title ?? `Feed ${candidate.keeper.feed_id}`,
              published_at: candidate.keeper.published_at
            },
            article_b: {
              title: candidate.duplicate.title,
              url: candidate.duplicate.url,
              feed: candidate.duplicate.feed?.title ?? `Feed ${candidate.duplicate.feed_id}`,
              published_at: candidate.duplicate.published_at
            },
            local_similarity_score: candidate.localScore
          })
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`OpenRouter dedupe request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content ?? "{}";
  const decision = JSON.parse(content) as {
    same_story?: unknown;
    confidence?: unknown;
    reason?: unknown;
  };

  return {
    sameStory: decision.same_story === true,
    confidence:
      typeof decision.confidence === "number" && Number.isFinite(decision.confidence)
        ? Math.min(Math.max(decision.confidence, 0), 1)
        : 0,
    reason: typeof decision.reason === "string" ? decision.reason.trim().slice(0, 160) : ""
  };
}

function createSemanticTitleGroup(
  candidate: SemanticTitleCandidate,
  decision: SemanticTitleDecision,
  windowDays: number
): DedupeGroup {
  return {
    id: `semantic-title-${hashText(`${candidate.keeper.id}:${candidate.duplicate.id}`)}`,
    stage: "semantic-title",
    reason:
      decision.reason ||
      `Semantic title match within the ${windowDays}-day window using OpenRouter`,
    score: Number(decision.confidence.toFixed(3)),
    keeper: summariseEntry(candidate.keeper),
    duplicates: [summariseEntry(candidate.duplicate)]
  };
}

function hashText(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36);
}

async function runDedupeJob(
  session: SessionPayload,
  windowDays: number,
  mode: DedupeAuditRun["mode"],
  notificationConfig = getDedupeNotificationConfig()
): Promise<DedupeAuditRun | null> {
  const entries = await fetchRecentEntriesForDedupe(session, windowDays);
  const preview = await createServerDedupePreview(entries.entries, windowDays);

  if (preview.markReadEntryIds.length === 0) {
    return null;
  }

  await markEntriesStatus(session, preview.markReadEntryIds, "read");
  const run = createAuditRun(mode, preview);
  await appendDedupeAuditRun(run);
  await notifyFilteredEntries(run, notificationConfig);
  return run;
}

function formatDedupeStage(stage: DedupeGroup["stage"]): string {
  return stage
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatEntryStatus(status: DedupeGroup["keeper"]["status"]): string {
  return status
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatEntryLine(prefix: string, entry: DedupeGroup["keeper"]): string {
  const feedTitle = entry.feedTitle ? ` (${entry.feedTitle})` : "";
  return `${prefix}: ${entry.title}${feedTitle}\n${entry.url}`;
}

function formatFilteredEntriesMessage(run: DedupeAuditRun): string {
  const visibleGroups = run.groups.slice(0, 5);
  const lines = visibleGroups.flatMap((group, index) => {
    const duplicateLines = group.duplicates
      .slice(0, 3)
      .flatMap((entry) => [formatEntryLine("Filtered out", entry), ""]);

    if (group.duplicates.length > 3) {
      duplicateLines.push(`...and ${group.duplicates.length - 3} more filtered articles in this group.`, "");
    }

    return [
      `Filter ${index + 1}: ${formatDedupeStage(group.stage)}`,
      formatEntryLine(`Kept ${formatEntryStatus(group.keeper.status)}`, group.keeper),
      "",
      ...duplicateLines
    ];
  });

  if (run.groups.length > visibleGroups.length) {
    lines.push(`...and ${run.groups.length - visibleGroups.length} more duplicate groups.`);
  }

  return lines.join("\n").trim();
}

async function publishNtfyNotification(
  config: NtfyConfig,
  notification: { title: string; body: string; priority?: string; tags?: string }
): Promise<void> {
  const response = await fetch(joinNtfyTopicUrl(config), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      Title: notification.title,
      Priority: notification.priority || "default",
      Tags: notification.tags || "rss"
    },
    body: notification.body
  });

  if (!response.ok) {
    throw new Error(`ntfy publish failed with status ${response.status}.`);
  }
}

async function notifyFilteredEntries(
  run: DedupeAuditRun,
  notificationConfig: DedupeNotificationConfig
): Promise<void> {
  if (!notificationConfig.enabled || run.markedReadCount === 0) {
    return;
  }

  if (!notificationConfig.ntfy) {
    console.error("Dedupe ntfy notifications are enabled but ntfy configuration is incomplete.");
    return;
  }

  try {
    await publishNtfyNotification(notificationConfig.ntfy, {
      title:
        run.markedReadCount === 1
          ? "Flux Filters filtered 1 article"
          : `Flux Filters filtered ${run.markedReadCount} articles`,
      priority: run.markedReadCount >= 5 ? "high" : "default",
      tags: "wastebasket,rss",
      body: formatFilteredEntriesMessage(run)
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Dedupe ntfy notification failed.");
  }
}

function isFailedFeed(feed: MinifluxFeed): boolean {
  return (feed.parsing_error_count ?? 0) > 0 || Boolean(feed.parsing_error_message?.trim());
}

function summariseFailedFeed(feed: MinifluxFeed): FailedFeedSummary {
  return {
    id: feed.id,
    title: feed.title,
    feedUrl: feed.feed_url,
    siteUrl: feed.site_url,
    checkedAt: feed.checked_at ?? null,
    errorCount: feed.parsing_error_count ?? 0,
    errorMessage: feed.parsing_error_message?.trim() || "Miniflux did not provide an error message."
  };
}

function createFailedFeedsSignature(feeds: FailedFeedSummary[]): string {
  return feeds
    .map((feed) => [feed.id, feed.errorCount, feed.errorMessage].join(":"))
    .sort((left, right) => left.localeCompare(right, "en-GB", { sensitivity: "base" }))
    .join("|");
}

async function readFailedFeedsNotificationState(): Promise<FailedFeedNotificationState | null> {
  try {
    return JSON.parse(await fs.readFile(failedFeedsStatePath, "utf8")) as FailedFeedNotificationState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function writeFailedFeedsNotificationState(signature: string): Promise<void> {
  await fs.mkdir(path.dirname(failedFeedsStatePath), { recursive: true });
  await fs.writeFile(
    failedFeedsStatePath,
    JSON.stringify(
      {
        signature,
        notifiedAt: new Date().toISOString()
      },
      null,
      2
    ),
    "utf8"
  );
}

async function fetchFailedFeeds(session: SessionPayload): Promise<FailedFeedSummary[]> {
  const feeds = await minifluxRequest<MinifluxFeed[]>(session, "/v1/feeds");
  const failedFeeds = await mapWithConcurrency(feeds.filter(isFailedFeed), 10, async (feed) => {
    try {
      return summariseFailedFeed(await minifluxRequest<MinifluxFeed>(session, `/v1/feeds/${feed.id}`));
    } catch {
      return summariseFailedFeed(feed);
    }
  });

  return failedFeeds
    .filter((feed) => feed.errorCount > 0 || feed.errorMessage !== "Miniflux did not provide an error message.")
    .sort((left, right) => left.title.localeCompare(right.title, "en-GB", { sensitivity: "base" }));
}

function formatFailedFeedsMessage(feeds: FailedFeedSummary[]): string {
  const visibleFeeds = feeds.slice(0, 8);
  const lines = visibleFeeds.flatMap((feed) => [
    `${feed.title} (#${feed.id})`,
    `Error: ${feed.errorMessage}`,
    `Feed: ${feed.feedUrl}`,
    feed.checkedAt ? `Checked: ${feed.checkedAt}` : "Checked: unknown",
    ""
  ]);

  if (feeds.length > visibleFeeds.length) {
    lines.push(`...and ${feeds.length - visibleFeeds.length} more failed feeds.`);
  }

  return lines.join("\n").trim();
}

async function publishFailedFeedsNotification(config: NtfyConfig, feeds: FailedFeedSummary[]): Promise<void> {
  const title =
    feeds.length === 1 ? "Miniflux feed failing" : `${feeds.length} Miniflux feeds failing`;
  await publishNtfyNotification(config, {
    title,
    priority: feeds.length >= 5 ? "high" : "default",
    tags: "warning,rss",
    body: formatFailedFeedsMessage(feeds)
  });
}

async function runFailedFeedsNotificationJob(
  session: SessionPayload,
  ntfy: NtfyConfig
): Promise<FailedFeedSummary[]> {
  const failedFeeds = await fetchFailedFeeds(session);
  const signature = createFailedFeedsSignature(failedFeeds);
  const state = await readFailedFeedsNotificationState();

  if (state?.signature === signature) {
    return [];
  }

  if (failedFeeds.length === 0) {
    await writeFailedFeedsNotificationState(signature);
    return [];
  }

  await publishFailedFeedsNotification(ntfy, failedFeeds);
  await writeFailedFeedsNotificationState(signature);
  return failedFeeds;
}

function filterPreviewForEntryIds(preview: DedupePreview, entryIds: number[]): DedupePreview {
  const requestedEntryIds = new Set(entryIds);
  const groups = preview.groups
    .map((group) => ({
      ...group,
      duplicates: group.duplicates.filter((entry) => requestedEntryIds.has(entry.id))
    }))
    .filter((group) => group.duplicates.length > 0);
  const markReadEntryIds = [...new Set(groups.flatMap((group) => group.duplicates.map((entry) => entry.id)))];

  return {
    ...preview,
    groups,
    markReadEntryIds
  };
}

function startDedupeScheduler() {
  let config: DedupeJobConfig;

  try {
    config = getDedupeJobConfig();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unable to configure dedupe automation.");
    return;
  }

  if (!config.enabled) {
    return;
  }

  if (!config.session) {
    console.error("Dedupe automation is enabled but MINIFLUX_BASE_URL or MINIFLUX_API_TOKEN is missing.");
    return;
  }

  const intervalMs = config.intervalMinutes * 60 * 1000;
  let running = false;

  async function runScheduledJob() {
    if (running || !config.session) {
      return;
    }

    running = true;

    try {
      const run = await runDedupeJob(config.session, config.windowDays, "automatic");

      if (run) {
        console.log(`Dedupe automation marked ${run.markedReadCount} duplicate entries as read.`);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Dedupe automation failed.");
    } finally {
      running = false;
    }
  }

  setInterval(() => {
    void runScheduledJob();
  }, intervalMs);
  console.log(
    `Dedupe automation enabled: every ${config.intervalMinutes} minutes, ${config.windowDays}-day window. First run in ${config.intervalMinutes} minutes.`
  );
}

function startFailedFeedsNotificationScheduler() {
  let config: FailedFeedsJobConfig;

  try {
    config = getFailedFeedsJobConfig();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unable to configure failed-feed notifications.");
    return;
  }

  if (!config.enabled) {
    return;
  }

  if (!config.session) {
    console.error(
      "Failed-feed notifications are enabled but MINIFLUX_BASE_URL or MINIFLUX_API_TOKEN is missing."
    );
    return;
  }

  if (!config.ntfy) {
    console.error("Failed-feed notifications are enabled but ntfy configuration is incomplete.");
    return;
  }

  const intervalMs = config.intervalMinutes * 60 * 1000;
  let running = false;

  async function runScheduledJob() {
    if (running || !config.session || !config.ntfy) {
      return;
    }

    running = true;

    try {
      const notifiedFeeds = await runFailedFeedsNotificationJob(config.session, config.ntfy);

      if (notifiedFeeds.length > 0) {
        console.log(`Failed-feed notifications sent for ${notifiedFeeds.length} feeds.`);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Failed-feed notifications failed.");
    } finally {
      running = false;
    }
  }

  setTimeout(() => {
    void runScheduledJob();
  }, 20_000);
  setInterval(() => {
    void runScheduledJob();
  }, intervalMs);
  console.log(`Failed-feed notifications enabled: every ${config.intervalMinutes} minutes.`);
}

function sendError(response: express.Response, error: unknown) {
  const status =
    typeof error === "object" && error && "status" in error && typeof error.status === "number"
      ? error.status
      : 400;

  const message = error instanceof Error ? error.message : "Unexpected error.";
  response.status(status).json({ error: message });
}

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.post("/api/auth/test", async (request, response) => {
  try {
    const payload = request.body as SessionPayload;
    const session = {
      serverUrl: normaliseServerUrl(payload.serverUrl),
      apiToken: payload.apiToken?.trim()
    };

    if (!session.apiToken) {
      throw new Error("Please enter an API token.");
    }

    const [user, version] = await Promise.all([
      minifluxRequest<MinifluxUser>(session, "/v1/me"),
      minifluxRequest<{ version: string }>(session, "/v1/version")
    ]);

    response.json({
      user,
      version,
      serverUrl: session.serverUrl
    });
  } catch (error) {
    sendError(response, error);
  }
});

app.get("/api/feeds", async (request, response) => {
  try {
    const session = getSessionFromHeaders(request);
    const includeDetails = request.query.details === "full";
    const feeds = await minifluxRequest<MinifluxFeed[]>(session, "/v1/feeds");
    const feedsForResponse = includeDetails
      ? await mapWithConcurrency(feeds, 10, async (feed) => {
          try {
            return await minifluxRequest<MinifluxFeed>(session, `/v1/feeds/${feed.id}`);
          } catch {
            // Fall back to the lighter list payload so one bad feed does not blank the whole dashboard.
            return feed;
          }
        })
      : feeds;

    response.json(
      feedsForResponse.sort((left, right) =>
        left.title.localeCompare(right.title, "en-GB", { sensitivity: "base" })
      )
    );
  } catch (error) {
    sendError(response, error);
  }
});

app.get("/api/feeds/:feedId", async (request, response) => {
  try {
    const session = getSessionFromHeaders(request);
    const feedId = Number(request.params.feedId);

    if (!Number.isInteger(feedId)) {
      throw new Error("Invalid feed id.");
    }

    const feed = await minifluxRequest<MinifluxFeed>(session, `/v1/feeds/${feedId}`);
    response.json(feed);
  } catch (error) {
    sendError(response, error);
  }
});

app.put("/api/feeds/refresh", async (request, response) => {
  try {
    const session = getSessionFromHeaders(request);
    await minifluxRequest<void>(session, "/v1/feeds/refresh", { method: "PUT" });
    response.status(204).send();
  } catch (error) {
    sendError(response, error);
  }
});

app.put("/api/feeds/:feedId/refresh", async (request, response) => {
  try {
    const session = getSessionFromHeaders(request);
    const feedId = Number(request.params.feedId);

    if (!Number.isInteger(feedId)) {
      throw new Error("Invalid feed id.");
    }

    await minifluxRequest<void>(session, `/v1/feeds/${feedId}/refresh`, { method: "PUT" });
    response.status(204).send();
  } catch (error) {
    sendError(response, error);
  }
});

app.get("/api/entries/starred", async (request, response) => {
  try {
    const session = getSessionFromHeaders(request);
    const requestedLimit = Number(request.query.limit ?? 50);
    const limit = Number.isInteger(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 100)
      : 50;
    const params = new URLSearchParams({
      starred: "true",
      limit: String(limit),
      order: "published_at",
      direction: "desc"
    });

    const entries = await minifluxRequest<MinifluxEntriesResponse>(
      session,
      `/v1/entries?${params.toString()}`
    );

    response.json(entries);
  } catch (error) {
    sendError(response, error);
  }
});

app.put("/api/entries/:entryId/bookmark", async (request, response) => {
  try {
    const session = getSessionFromHeaders(request);
    const entryId = Number(request.params.entryId);

    if (!Number.isInteger(entryId)) {
      throw new Error("Invalid entry id.");
    }

    await minifluxRequest<void>(session, `/v1/entries/${entryId}/bookmark`, {
      method: "PUT"
    });

    response.status(204).send();
  } catch (error) {
    sendError(response, error);
  }
});

app.get("/api/dedupe/preview", async (request, response) => {
  try {
    const session = getSessionFromHeaders(request);
    const windowDays = getDedupeWindowDays(request.query.windowDays);
    const entries = await fetchRecentEntriesForDedupe(session, windowDays);
    const preview: DedupePreview = await createServerDedupePreview(entries.entries, windowDays, {
      includeSemantic: request.query.semantic === "true"
    });

    response.json(preview);
  } catch (error) {
    sendError(response, error);
  }
});

app.get("/api/dedupe/audit", async (request, response) => {
  try {
    getSessionFromHeaders(request);
    const days = getDedupeWindowDays(request.query.days);
    const runs = await readDedupeAuditRuns(days);

    response.json({ days, runs });
  } catch (error) {
    sendError(response, error);
  }
});

app.put("/api/dedupe/apply", async (request, response) => {
  try {
    const session = getSessionFromHeaders(request);
    const payload = request.body as DedupeApplyPayload;
    const entryIds = getEntryIds(payload.entryIds);
    const entries = await fetchRecentEntriesForDedupe(session, 7);
    const preview = filterPreviewForEntryIds(await createServerDedupePreview(entries.entries, 7), entryIds);

    if (preview.markReadEntryIds.length === 0) {
      response.json({ markedReadCount: 0, entryIds: [] });
      return;
    }

    await markEntriesStatus(session, preview.markReadEntryIds, "read");
    const run = createAuditRun("manual", preview);
    await appendDedupeAuditRun(run);
    await notifyFilteredEntries(run, getDedupeNotificationConfig());

    response.json({
      markedReadCount: preview.markReadEntryIds.length,
      entryIds: preview.markReadEntryIds,
      run
    });
  } catch (error) {
    sendError(response, error);
  }
});

app.put("/api/dedupe/mark-unread", async (request, response) => {
  try {
    const session = getSessionFromHeaders(request);
    const payload = request.body as DedupeApplyPayload;
    const entryIds = getEntryIds(payload.entryIds);

    if (entryIds.length === 0) {
      response.json({ markedUnreadCount: 0, entryIds: [] });
      return;
    }

    await markEntriesStatus(session, entryIds, "unread");

    response.json({
      markedUnreadCount: entryIds.length,
      entryIds
    });
  } catch (error) {
    sendError(response, error);
  }
});

app.put("/api/feeds/:feedId/rules", async (request, response) => {
  try {
    const session = getSessionFromHeaders(request);
    const feedId = Number(request.params.feedId);
    const payload = request.body as FeedRulesPayload;

    if (!Number.isInteger(feedId)) {
      throw new Error("Invalid feed id.");
    }

    await minifluxRequest<void>(session, `/v1/feeds/${feedId}`, {
      method: "PUT",
      body: JSON.stringify({
        block_filter_entry_rules: payload.blocklistRules,
        keep_filter_entry_rules: payload.keeplistRules
      })
    });

    const updatedFeed = await minifluxRequest<MinifluxFeed>(session, `/v1/feeds/${feedId}`);
    response.json(updatedFeed);
  } catch (error) {
    sendError(response, error);
  }
});

app.use(express.static(clientDist));

app.use((request, response, next) => {
  if (request.path.startsWith("/api/")) {
    next();
    return;
  }

  response.sendFile(path.join(clientDist, "index.html"));
});

app.listen(port, () => {
  console.log(`Flux Filters listening on port ${port}`);
  startDedupeScheduler();
  startFailedFeedsNotificationScheduler();
});
