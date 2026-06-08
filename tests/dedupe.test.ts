import { describe, expect, it } from "vitest";

import {
  createDedupePreview,
  normaliseDedupeConfig,
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

  it("normalises custom dedupe config values", () => {
    expect(
      normaliseDedupeConfig({
        sourceWords: [" BBC ", "bbc", "Reuters"],
        titleStopWords: [" The ", "And"],
        genericSharedEntities: [" World   Cup "],
        similarTitleThreshold: 1.5,
        entityAnchoredThreshold: -1
      })
    ).toMatchObject({
      sourceWords: ["bbc", "reuters"],
      titleStopWords: ["the", "and"],
      genericSharedEntities: ["world cup"],
      similarTitleThreshold: 1,
      entityAnchoredThreshold: 0
    });
  });

  it("allows source words to be adjusted without code changes", () => {
    expect(scoreSimilarTitles("OpenAI report", "OpenAI update")).toBe(0.667);
    expect(
      scoreSimilarTitles("OpenAI report", "OpenAI update", {
        sourceWords: ["openai"]
      })
    ).toBe(0);
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

  it("does not mark similar titles in the deterministic preview", () => {
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

    expect(preview.groups).toHaveLength(0);
    expect(preview.markReadEntryIds).toHaveLength(0);
  });

  it("leaves broader cross-feed stories about the same named subject for semantic review", () => {
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

    expect(preview.groups).toHaveLength(0);
    expect(preview.markReadEntryIds).toHaveLength(0);
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

  it("uses a read URL match as the keeper and marks the newer unread duplicate", () => {
    const preview = createDedupePreview([
      createEntry({
        id: 1,
        status: "read",
        url: "https://example.com/article",
        published_at: "2026-06-01T10:00:00Z"
      }),
      createEntry({
        id: 2,
        url: "https://example.com/article?utm_medium=email",
        published_at: "2026-06-02T10:00:00Z"
      })
    ]);

    expect(preview.groups).toHaveLength(1);
    expect(preview.groups[0]).toMatchObject({
      stage: "url",
      keeper: { id: 1, status: "read" },
      duplicates: [{ id: 2, status: "unread" }]
    });
    expect(preview.totalCheckedEntries).toBe(2);
    expect(preview.totalUnreadEntries).toBe(1);
    expect(preview.markReadEntryIds).toEqual([2]);
  });

  it("uses a read title match as the keeper and marks the newer unread duplicate", () => {
    const preview = createDedupePreview([
      createEntry({
        id: 1,
        status: "read",
        title: "OpenAI plans ChatGPT superapp overhaul",
        url: "https://example.com/read",
        published_at: "2026-06-01T10:00:00Z"
      }),
      createEntry({
        id: 2,
        title: " openai   plans chatgpt superapp overhaul ",
        url: "https://example.com/unread",
        published_at: "2026-06-02T10:00:00Z"
      })
    ]);

    expect(preview.groups[0]).toMatchObject({
      stage: "title",
      keeper: { id: 1, status: "read" },
      duplicates: [{ id: 2, status: "unread" }]
    });
    expect(preview.markReadEntryIds).toEqual([2]);
  });

  it("does not use read similar titles as automatic keepers", () => {
    const preview = createDedupePreview([
      createEntry({
        id: 1,
        status: "read",
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

    expect(preview.groups).toHaveLength(0);
    expect(preview.markReadEntryIds).toHaveLength(0);
  });

  it("does not auto-match articles that only share places, people, or teams", () => {
    const preview = createDedupePreview([
      createEntry({
        id: 1,
        title: "Corby to Market Harborough road closure warning for East Carlton Park access",
        feed: {
          id: 10,
          title: "Northamptonshire Telegraph",
          feed_url: "https://www.northantstelegraph.co.uk/rss",
          site_url: "https://www.northantstelegraph.co.uk"
        },
        published_at: "2026-06-01T10:25:00Z"
      }),
      createEntry({
        id: 2,
        title:
          "Who's been sentenced featuring Corby, Isham, Burton Latimer, Kettering, Rothwell, Wellingborough, Market Harborough, Denford, Rugby and Easton On The Hill",
        url: "https://example.com/sentenced",
        feed: {
          id: 10,
          title: "Northamptonshire Telegraph",
          feed_url: "https://www.northantstelegraph.co.uk/rss",
          site_url: "https://www.northantstelegraph.co.uk"
        },
        published_at: "2026-06-07T18:18:00Z"
      }),
      createEntry({
        id: 3,
        title: "Rodri insists he will address his future after World Cup amid Real Madrid links",
        url: "https://example.com/rodri",
        feed: {
          id: 20,
          title: "The Guardian - Football",
          feed_url: "https://www.theguardian.com/football/rss",
          site_url: "https://www.theguardian.com/football"
        },
        published_at: "2026-06-01T19:09:00Z"
      }),
      createEntry({
        id: 4,
        title: "Jose Mourinho set for Real Madrid after Florentino Perez re-election",
        url: "https://example.com/mourinho",
        feed: {
          id: 30,
          title: "BBC Sport - Football",
          feed_url: "https://feeds.bbci.co.uk/sport/football/rss.xml",
          site_url: "https://www.bbc.co.uk/sport/football"
        },
        published_at: "2026-06-08T07:58:00Z"
      }),
      createEntry({
        id: 5,
        title: "Tottenham sign left-back Andy Robertson from Liverpool on free transfer",
        url: "https://example.com/robertson-transfer",
        feed: {
          id: 30,
          title: "BBC Sport - Football",
          feed_url: "https://feeds.bbci.co.uk/sport/football/rss.xml",
          site_url: "https://www.bbc.co.uk/sport/football"
        },
        published_at: "2026-06-05T13:52:00Z"
      }),
      createEntry({
        id: 6,
        title: "World Cup 2026: Scotland captain Andy Robertson - inside the fairytale journey",
        url: "https://example.com/robertson-world-cup",
        feed: {
          id: 30,
          title: "BBC Sport - Football",
          feed_url: "https://feeds.bbci.co.uk/sport/football/rss.xml",
          site_url: "https://www.bbc.co.uk/sport/football"
        },
        published_at: "2026-06-08T08:18:00Z"
      })
    ]);

    expect(preview.groups).toHaveLength(0);
    expect(preview.markReadEntryIds).toHaveLength(0);
  });

  it("does not propose action when every duplicate is already read", () => {
    const preview = createDedupePreview([
      createEntry({ id: 1, status: "read" }),
      createEntry({ id: 2, status: "read", url: "https://example.com/article?utm_medium=email" })
    ]);

    expect(preview.groups).toHaveLength(0);
    expect(preview.markReadEntryIds).toHaveLength(0);
  });
});
