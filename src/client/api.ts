import type { MinifluxFeed, MinifluxUser } from "../shared/miniflux";

export interface ClientSession {
  serverUrl: string;
  apiToken: string;
}

interface AuthResponse {
  user: MinifluxUser;
  version: {
    version: string;
  };
  serverUrl: string;
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = "Request failed.";

    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) {
        message = data.error;
      }
    } catch {
      message = response.statusText || message;
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
}

function withSessionHeaders(session: ClientSession): HeadersInit {
  return {
    "X-Miniflux-Base-Url": session.serverUrl,
    "X-Miniflux-Token": session.apiToken
  };
}

export async function testConnection(session: ClientSession): Promise<AuthResponse> {
  const response = await fetch("/api/auth/test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(session)
  });

  return parseResponse<AuthResponse>(response);
}

export async function fetchFeeds(session: ClientSession): Promise<MinifluxFeed[]> {
  const response = await fetch("/api/feeds", {
    headers: withSessionHeaders(session)
  });

  return parseResponse<MinifluxFeed[]>(response);
}

export async function fetchFeed(session: ClientSession, feedId: number): Promise<MinifluxFeed> {
  const response = await fetch(`/api/feeds/${feedId}`, {
    headers: withSessionHeaders(session)
  });

  return parseResponse<MinifluxFeed>(response);
}

export async function saveFeedRules(
  session: ClientSession,
  feedId: number,
  payload: { blocklistRules: string; keeplistRules: string }
): Promise<MinifluxFeed> {
  const response = await fetch(`/api/feeds/${feedId}/rules`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...withSessionHeaders(session)
    },
    body: JSON.stringify(payload)
  });

  return parseResponse<MinifluxFeed>(response);
}
