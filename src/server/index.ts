import "dotenv/config";
import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createDedupePreview, type DedupeAuditRun, type DedupePreview } from "../shared/dedupe.js";
import type {
  MinifluxEntriesResponse,
  MinifluxFeed,
  MinifluxUser
} from "../shared/miniflux.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const clientDist = path.resolve(process.cwd(), "dist/client");
const dedupeAuditPath =
  process.env.DEDUPE_AUDIT_PATH || path.resolve(process.cwd(), "data/dedupe-audit.jsonl");

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
  const response = await fetch(joinUpstreamUrl(session.serverUrl, endpoint), {
    ...init,
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

async function fetchUnreadEntriesForDedupe(
  session: SessionPayload,
  windowDays: number
): Promise<MinifluxEntriesResponse> {
  const limit = 100;
  const entries: MinifluxEntriesResponse["entries"] = [];
  const publishedAfter = Math.floor((Date.now() - windowDays * 24 * 60 * 60 * 1000) / 1000);

  for (let offset = 0; ; offset += limit) {
    const params = new URLSearchParams({
      status: "unread",
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

function createAuditRun(mode: DedupeAuditRun["mode"], preview: DedupePreview): DedupeAuditRun {
  return {
    id: globalThis.crypto.randomUUID(),
    mode,
    createdAt: new Date().toISOString(),
    windowDays: preview.windowDays,
    totalUnreadEntries: preview.totalUnreadEntries,
    markedReadCount: preview.markReadEntryIds.length,
    markedReadEntryIds: preview.markReadEntryIds,
    groups: preview.groups
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

async function runDedupeJob(
  session: SessionPayload,
  windowDays: number,
  mode: DedupeAuditRun["mode"]
): Promise<DedupeAuditRun | null> {
  const entries = await fetchUnreadEntriesForDedupe(session, windowDays);
  const preview = createDedupePreview(entries.entries, { windowDays });

  if (preview.markReadEntryIds.length === 0) {
    return null;
  }

  await markEntriesStatus(session, preview.markReadEntryIds, "read");
  const run = createAuditRun(mode, preview);
  await appendDedupeAuditRun(run);
  return run;
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

  setTimeout(() => {
    void runScheduledJob();
  }, 15_000);
  setInterval(() => {
    void runScheduledJob();
  }, intervalMs);
  console.log(
    `Dedupe automation enabled: every ${config.intervalMinutes} minutes, ${config.windowDays}-day window.`
  );
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
    const feeds = await minifluxRequest<MinifluxFeed[]>(session, "/v1/feeds");
    const hydratedFeeds = await mapWithConcurrency(feeds, 10, async (feed) => {
      try {
        return await minifluxRequest<MinifluxFeed>(session, `/v1/feeds/${feed.id}`);
      } catch {
        // Fall back to the lighter list payload so one bad feed does not blank the whole dashboard.
        return feed;
      }
    });

    response.json(
      hydratedFeeds.sort((left, right) =>
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
    const entries = await fetchUnreadEntriesForDedupe(session, windowDays);
    const preview: DedupePreview = createDedupePreview(entries.entries, { windowDays });

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
    const entries = await fetchUnreadEntriesForDedupe(session, 7);
    const preview = filterPreviewForEntryIds(createDedupePreview(entries.entries, { windowDays: 7 }), entryIds);

    if (preview.markReadEntryIds.length === 0) {
      response.json({ markedReadCount: 0, entryIds: [] });
      return;
    }

    await markEntriesStatus(session, preview.markReadEntryIds, "read");
    const run = createAuditRun("manual", preview);
    await appendDedupeAuditRun(run);

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
});
