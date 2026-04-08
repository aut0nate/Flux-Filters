import "dotenv/config";
import express from "express";
import path from "node:path";

import type { MinifluxFeed, MinifluxUser } from "../shared/miniflux.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const clientDist = path.resolve(process.cwd(), "dist/client");

app.use(express.json({ limit: "1mb" }));

interface SessionPayload {
  serverUrl: string;
  apiToken: string;
}

interface FeedRulesPayload {
  blocklistRules: string;
  keeplistRules: string;
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

app.get("*", (request, response, next) => {
  if (request.path.startsWith("/api/")) {
    next();
    return;
  }

  response.sendFile(path.join(clientDist, "index.html"));
});

app.listen(port, () => {
  console.log(`Flux Filters listening on port ${port}`);
});
