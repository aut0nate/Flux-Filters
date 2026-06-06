import { useState } from "react";

import {
  createRuleDraftFromText,
  type MinifluxEntry,
  type RuleField,
  type RuleDraft
} from "../../shared/miniflux";

type SelectableRuleField = Extract<RuleField, "EntryTitle" | "EntryContent" | "EntryURL">;

interface StarredQueueProps {
  entries: MinifluxEntry[];
  total: number;
  loading: boolean;
  error: string;
  minifluxServerUrl: string;
  onRefresh: () => void;
  onAddRule: (entry: MinifluxEntry, rule: RuleDraft) => void;
  onAddRules: (entry: MinifluxEntry, rules: RuleDraft[]) => void;
  onUnstar: (entry: MinifluxEntry) => Promise<void>;
}

function formatEntryAge(value: string): string {
  const publishedAt = new Date(value);
  if (Number.isNaN(publishedAt.getTime())) {
    return "";
  }

  const diffMs = Date.now() - publishedAt.getTime();
  const diffHours = Math.max(Math.round(diffMs / 1000 / 60 / 60), 0);

  if (diffHours < 1) {
    return "less than an hour ago";
  }

  if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

function getEntryFeedTitle(entry: MinifluxEntry): string {
  return entry.feed?.title || `Feed #${entry.feed_id}`;
}

function getEntryAuthor(entry: MinifluxEntry): string {
  const author = entry.author?.replace(/\s+/g, " ").trim() ?? "";
  if (!author) {
    return "";
  }

  try {
    const url = new URL(author);
    return `${url.hostname}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return author;
  }
}

function getSelectedTextInside(element: HTMLElement): string {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) {
    return "";
  }

  if (!element.contains(selection.anchorNode) || !element.contains(selection.focusNode)) {
    return "";
  }

  return selection.toString().replace(/\s+/g, " ").trim();
}

function getEntryContentParagraphs(entry: MinifluxEntry): string[] {
  if (!entry.content) {
    return [];
  }

  const document = new DOMParser().parseFromString(entry.content, "text/html");
  const paragraphText = Array.from(document.querySelectorAll("p"))
    .map((paragraph) => paragraph.textContent?.replace(/\s+/g, " ").trim() ?? "")
    .filter((value) => value.length > 0);

  if (paragraphText.length > 0) {
    return paragraphText.slice(0, 2);
  }

  const fallbackText = document.body.textContent?.replace(/\s+/g, " ").trim();
  return fallbackText ? [fallbackText] : [];
}

function getDisplayUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return value;
  }
}

function getUrlRuleCandidates(value: string): string[] {
  try {
    const url = new URL(value);
    const segments = url.pathname.split("/").filter(Boolean);
    const candidates = new Set<string>();

    function isReusableSegment(segment: string): boolean {
      if (/^\d+$/.test(segment)) {
        return false;
      }

      if (segment.length > 24 && /^[a-z0-9-]+$/i.test(segment)) {
        return false;
      }

      if (segment.length >= 10 && /[0-9]/.test(segment) && /^[a-z0-9]+$/i.test(segment)) {
        return false;
      }

      return true;
    }

    const reusableSegments = segments.filter(isReusableSegment);

    reusableSegments.slice(0, 3).forEach((_segment, index) => {
      const candidate = `/${reusableSegments.slice(0, index + 1).join("/")}`;
      if (candidate.length > 1 && candidate.length <= 80) {
        candidates.add(candidate);
      }
    });

    reusableSegments.slice(0, 4).forEach((segment) => {
      const candidate = `/${segment}`;
      if (candidate.length > 1 && candidate.length <= 80) {
        candidates.add(candidate);
      }
    });

    return [...candidates].slice(0, 6);
  } catch {
    return [];
  }
}

function getMinifluxEntryUrl(serverUrl: string, entryId: number): string {
  return `${serverUrl.replace(/\/$/, "")}/starred/entry/${entryId}`;
}

export default function StarredQueue({
  entries,
  total,
  loading,
  error,
  minifluxServerUrl,
  onRefresh,
  onAddRule,
  onAddRules,
  onUnstar
}: StarredQueueProps) {
  const [selectedRuleText, setSelectedRuleText] = useState<{
    entryId: number;
    field: SelectableRuleField;
    label: string;
    text: string;
  } | null>(null);
  const [unstarringEntryId, setUnstarringEntryId] = useState<number | null>(null);

  function handleTextSelection(
    entry: MinifluxEntry,
    element: HTMLElement,
    field: SelectableRuleField,
    label: string
  ) {
    const nextText = getSelectedTextInside(element);
    setSelectedRuleText(nextText ? { entryId: entry.id, field, label, text: nextText } : null);
  }

  function handleAddSelectedRule(
    entry: MinifluxEntry,
    fields: SelectableRuleField | SelectableRuleField[] | undefined = selectedRuleText?.field
  ) {
    if (!selectedRuleText || selectedRuleText.entryId !== entry.id) {
      return;
    }

    if (!fields) {
      return;
    }

    const selectedFields = Array.isArray(fields) ? fields : [fields];
    const rules = selectedFields.map((field) =>
      createRuleDraftFromText(field, selectedRuleText.text, true)
    );

    if (rules.length === 1) {
      onAddRule(entry, rules[0]);
    } else {
      onAddRules(entry, rules);
    }

    setSelectedRuleText(null);
    window.getSelection()?.removeAllRanges();
  }

  async function handleUnstar(entry: MinifluxEntry) {
    setUnstarringEntryId(entry.id);

    try {
      await onUnstar(entry);
    } finally {
      setUnstarringEntryId(null);
    }
  }

  return (
    <section className="review-panel" id="starred-review">
      <div className="review-panel__header">
        <div>
          <p className="eyebrow">Review Queue</p>
          <h2>Starred Filter Candidates</h2>
          <p className="subtle">
            Star articles in Miniflux, then turn them into feed-level rules here.
          </p>
        </div>
        <div className="review-panel__actions">
          <span className="pill">{total} starred</span>
          <button type="button" className="ghost-button" onClick={onRefresh} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh Starred"}
          </button>
        </div>
      </div>

      {error ? <div className="form-error">{error}</div> : null}

      {loading && entries.length === 0 ? (
        <div className="empty-state">Loading starred entries...</div>
      ) : null}

      {!loading && entries.length === 0 ? (
        <div className="empty-state">No starred entries are waiting for review.</div>
      ) : null}

      {entries.length > 0 ? (
        <div className="starred-list">
          {entries.map((entry) => {
            const contentParagraphs = getEntryContentParagraphs(entry);
            const urlRuleCandidates = getUrlRuleCandidates(entry.url);

            return (
              <article className="starred-card" id={`starred-entry-${entry.id}`} key={entry.id}>
                <div className="starred-card__body">
                  <div>
                    <p className="starred-card__source">
                      {getEntryFeedTitle(entry)}
                      {getEntryAuthor(entry) ? ` | ${getEntryAuthor(entry)}` : ""}
                      {entry.published_at ? ` | ${formatEntryAge(entry.published_at)}` : ""}
                    </p>
                    <h3
                      onMouseUp={(event) => {
                        const titleElement = event.currentTarget;
                        window.setTimeout(
                          () => handleTextSelection(entry, titleElement, "EntryTitle", "title"),
                          0
                        );
                      }}
                      onTouchEnd={(event) => {
                        const titleElement = event.currentTarget;
                        window.setTimeout(
                          () => handleTextSelection(entry, titleElement, "EntryTitle", "title"),
                          0
                        );
                      }}
                    >
                      {entry.title}
                    </h3>
                  </div>

                  {contentParagraphs.length > 0 ? (
                    <div className="starred-card__description">
                      {contentParagraphs.map((paragraph, index) => (
                        <p
                          className="selectable-text"
                          key={`${entry.id}-paragraph-${index}`}
                          onMouseUp={(event) => {
                            const paragraphElement = event.currentTarget;
                            window.setTimeout(
                              () =>
                                handleTextSelection(
                                  entry,
                                  paragraphElement,
                                  "EntryContent",
                                  "description"
                                ),
                              0
                            );
                          }}
                          onTouchEnd={(event) => {
                            const paragraphElement = event.currentTarget;
                            window.setTimeout(
                              () =>
                                handleTextSelection(
                                  entry,
                                  paragraphElement,
                                  "EntryContent",
                                  "description"
                                ),
                              0
                            );
                          }}
                        >
                          {paragraph}
                        </p>
                      ))}
                    </div>
                  ) : null}

                  {entry.url ? (
                    <div className="starred-card__url">
                      <a
                        className="selectable-text"
                        href={entry.url}
                        target="_blank"
                        rel="noreferrer"
                        onMouseUp={(event) => {
                          const urlElement = event.currentTarget;
                          window.setTimeout(
                            () => handleTextSelection(entry, urlElement, "EntryURL", "URL"),
                            0
                          );
                        }}
                        onTouchEnd={(event) => {
                          const urlElement = event.currentTarget;
                          window.setTimeout(
                            () => handleTextSelection(entry, urlElement, "EntryURL", "URL"),
                            0
                          );
                        }}
                      >
                        {getDisplayUrl(entry.url)}
                      </a>
                    </div>
                  ) : null}

                  {selectedRuleText?.entryId === entry.id ? (
                    <div className="selection-action">
                      <span>
                        Selected {selectedRuleText.label}: {selectedRuleText.text}
                      </span>
                      {selectedRuleText.field === "EntryTitle" ? (
                        <>
                          <button
                            type="button"
                            className="primary-button compact-button"
                            onClick={() => handleAddSelectedRule(entry, "EntryTitle")}
                          >
                            Add Title Rule
                          </button>
                          <button
                            type="button"
                            className="ghost-button compact-button"
                            onClick={() => handleAddSelectedRule(entry, "EntryContent")}
                          >
                            Add Content Rule
                          </button>
                          <button
                            type="button"
                            className="ghost-button compact-button"
                            onClick={() => handleAddSelectedRule(entry, ["EntryTitle", "EntryContent"])}
                          >
                            Add Both Rules
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="primary-button compact-button"
                          onClick={() => handleAddSelectedRule(entry)}
                        >
                          Add Rule
                        </button>
                      )}
                    </div>
                  ) : null}

                  {entry.tags && entry.tags.length > 0 ? (
                    <div className="starred-card__tags">
                      {entry.tags.map((tag) => (
                        <button
                          type="button"
                          className="pill tag-button"
                          key={`${entry.id}-${tag}`}
                          onClick={() =>
                            onAddRule(entry, createRuleDraftFromText("EntryTag", tag, true))
                          }
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {urlRuleCandidates.length > 0 ? (
                    <div className="starred-card__url-rules">
                      {urlRuleCandidates.map((candidate) => (
                        <button
                          type="button"
                          className="pill tag-button"
                          key={`${entry.id}-${candidate}`}
                          onClick={() =>
                            onAddRule(entry, createRuleDraftFromText("EntryURL", candidate, true))
                          }
                        >
                          {candidate}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="starred-card__actions">
                  <a
                    className="ghost-button starred-card__link"
                    href={getMinifluxEntryUrl(minifluxServerUrl, entry.id)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View in Miniflux
                  </a>
                  {entry.author?.trim() ? (
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() =>
                        onAddRule(
                          entry,
                          createRuleDraftFromText("EntryAuthor", entry.author?.trim() ?? "", true)
                        )
                      }
                    >
                      Block Author
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={unstarringEntryId === entry.id}
                    onClick={() => void handleUnstar(entry)}
                  >
                    {unstarringEntryId === entry.id ? "Unstarring..." : "Unstar"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
