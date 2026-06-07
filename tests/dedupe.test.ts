import { describe, expect, it } from "vitest";

import {
  createDedupePreview,
  normaliseEntryTitle,
  normaliseEntryUrl,
  scoreSimilarTitles
} from "../src/shared/dedupe";
import type { MinifluxEntry } from "../src/shared/miniflux";

function createEntry(overrides: Partial<MinifluxEntry>): MinifluxEntry {
  return {
    id: 1,
    feed_id: 10,
    title: "Example article",
    url: "https://example.com/article",
    published_at: "2026-06-01T10:00:00Z",
    status: "unread",
    starred: false,
    feed: {
      id: 10,
      title: "Example Feed",
      feed_url: "https://example.com/feed.xml",
      site_url: "https://example.com"
    },
    ...overrides
  };
}

describe("Miniflux dedupe helpers", () => {
  it("normalises URLs without tracking parameters", () => {
    expect(
      normaliseEntryUrl("https://Example.com/story/?utm_source=rss&b=2&a=1#comments")
    ).toBe("https://example.com/story?a=1&b=2");
  });

  it("normalises title case, spacing, and simple source suffixes", () => {
    expect(normaliseEntryTitle("  OpenAI plans ChatGPT overhaul  - FT  ")).toBe(
      "openai plans chatgpt overhaul"
    );
  });

  it("scores strongly similar titles", () => {
    expect(
      scoreSimilarTitles(
        "OpenAI Overhauls ChatGPT Into 'Superapp' Ahead of Listing",
        "OpenAI plans ChatGPT 'superapp' overhaul ahead of listing, FT reports"
      )
    ).toBeGreaterThanOrEqual(0.82);
  });

  it("scores shared named-subject titles as similar when the angle changes", () => {
    expect(
      scoreSimilarTitles(
        "David Sullivan: how did the pornographer rise so high in modern football?",
        "David Sullivan steps down at West Ham to fight claims about private life"
      )
    ).toBeGreaterThanOrEqual(0.82);
  });

  it("does not treat broad event names as enough for a similar-title match", () => {
    expect(
      scoreSimilarTitles(
        "World Cup: Scotland's Steve Clarke has 'decisions to make' for Haiti opener",
        "France's Eduardo Camavinga attends Harvard after World Cup omission"
      )
    ).toBeLessThan(0.82);
    expect(
      scoreSimilarTitles(
        "Iran's football team granted visas to enter US for World Cup, officials say",
        "World Cup 2026: Are Portugal a better team without Cristiano Ronaldo?"
      )
    ).toBeLessThan(0.82);
  });

  it("keeps the oldest URL duplicate and marks newer duplicates as read candidates", () => {
    const preview = createDedupePreview([
      createEntry({
        id: 2,
        url: "https://example.com/story?utm_source=rss",
        published_at: "2026-06-02T10:00:00Z"
      }),
      createEntry({
        id: 1,
        url: "https://example.com/story",
        published_at: "2026-06-01T10:00:00Z"
      })
    ]);

    expect(preview.groups).toHaveLength(1);
    expect(preview.groups[0]).toMatchObject({
      stage: "url",
      keeper: { id: 1 },
      duplicates: [{ id: 2 }]
    });
    expect(preview.markReadEntryIds).toEqual([2]);
  });

  it("uses title matching after URL matching", () => {
    const preview = createDedupePreview([
      createEntry({
        id: 1,
        title: "Same story",
        url: "https://example.com/one",
        published_at: "2026-06-01T10:00:00Z"
      }),
      createEntry({
        id: 2,
        title: " same   story ",
        url: "https://another.example/two",
        published_at: "2026-06-01T11:00:00Z"
      })
    ]);

    expect(preview.groups[0]).toMatchObject({
      stage: "title",
      keeper: { id: 1 },
      duplicates: [{ id: 2 }]
    });
  });

  it("uses similar titles within the configured window", () => {
    const preview = createDedupePreview([
      createEntry({
        id: 1,
        title: "OpenAI Overhauls ChatGPT Into 'Superapp' Ahead of Listing",
        published_at: "2026-06-01T10:00:00Z"
      }),
      createEntry({
        id: 2,
        title: "OpenAI plans ChatGPT 'superapp' overhaul ahead of listing, FT reports",
        url: "https://example.net/openai",
        published_at: "2026-06-05T10:00:00Z"
      })
    ]);

    expect(preview.groups[0]).toMatchObject({
      stage: "similar-title",
      keeper: { id: 1 },
      duplicates: [{ id: 2 }]
    });
  });

  it("groups broader cross-feed stories about the same named subject", () => {
    const preview = createDedupePreview([
      createEntry({
        id: 1,
        title: "David Sullivan: how did the pornographer rise so high in modern football?",
        feed_id: 10,
        feed: {
          id: 10,
          title: "The Guardian - Football",
          feed_url: "https://www.theguardian.com/football/rss",
          site_url: "https://www.theguardian.com/football"
        },
        published_at: "2026-06-06T15:00:00Z"
      }),
      createEntry({
        id: 2,
        title: "David Sullivan steps down at West Ham to fight claims about private life",
        url: "https://example.com/guardian-west-ham",
        feed_id: 10,
        feed: {
          id: 10,
          title: "The Guardian - Football",
          feed_url: "https://www.theguardian.com/football/rss",
          site_url: "https://www.theguardian.com/football"
        },
        published_at: "2026-06-07T10:00:00Z"
      }),
      createEntry({
        id: 3,
        title: "David Sullivan steps down as West Ham co-chairman with immediate effect",
        url: "https://example.net/bbc-west-ham",
        feed_id: 20,
        feed: {
          id: 20,
          title: "BBC Sport - Football",
          feed_url: "https://feeds.bbci.co.uk/sport/football/rss.xml",
          site_url: "https://www.bbc.co.uk/sport/football"
        },
        published_at: "2026-06-07T10:30:00Z"
      })
    ]);

    expect(preview.groups[0]).toMatchObject({
      stage: "similar-title",
      keeper: { id: 1 },
      duplicates: [{ id: 2 }, { id: 3 }]
    });
  });

  it("does not group unrelated World Cup stories from the same time window", () => {
    const preview = createDedupePreview([
      createEntry({
        id: 1,
        title: "World Cup: Scotland's Steve Clarke has 'decisions to make' for Haiti opener",
        published_at: "2026-06-07T08:33:00Z"
      }),
      createEntry({
        id: 2,
        title: "France's Eduardo Camavinga attends Harvard after World Cup omission",
        url: "https://example.com/camavinga",
        published_at: "2026-06-07T10:49:00Z"
      }),
      createEntry({
        id: 3,
        title: "Iran's football team granted visas to enter US for World Cup, officials say",
        url: "https://example.com/iran-world-cup",
        published_at: "2026-06-06T04:14:00Z"
      }),
      createEntry({
        id: 4,
        title: "World Cup 2026: Are Portugal a better team without Cristiano Ronaldo?",
        url: "https://example.com/portugal-ronaldo",
        published_at: "2026-06-07T07:32:00Z"
      })
    ]);

    expect(preview.groups).toHaveLength(0);
    expect(preview.markReadEntryIds).toHaveLength(0);
  });

  it("ignores read entries", () => {
    const preview = createDedupePreview([
      createEntry({ id: 1, status: "read" }),
      createEntry({ id: 2, url: "https://example.com/article?utm_medium=email" })
    ]);

    expect(preview.groups).toHaveLength(0);
    expect(preview.markReadEntryIds).toHaveLength(0);
  });
});
