import { useCallback, useEffect, useRef, useState } from "react";

import {
  createRuleDraftFromText,
  getUrlRuleCandidates,
  type MinifluxEntry,
  type RuleField,
  type RuleDraft
} from "../../shared/miniflux";

type SelectableRuleField = Extract<RuleField, "EntryTitle" | "EntryContent" | "EntryURL">;

const SELECTABLE_RULE_TEXT_SELECTOR = "[data-rule-selection-field]";

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

function normaliseSelectedRuleText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function getSelectedTextInside(element: HTMLElement): string {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) {
    return "";
  }

  if (!element.contains(selection.anchorNode) || !element.contains(selection.focusNode)) {
    return "";
  }

  return normaliseSelectedRuleText(selection.toString());
}

function getSelectionSourceElement(root: HTMLElement): HTMLElement | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) {
    return null;
  }

  const anchorElement =
    selection.anchorNode.nodeType === Node.ELEMENT_NODE
      ? selection.anchorNode
      : selection.anchorNode.parentElement;
  const focusElement =
    selection.focusNode.nodeType === Node.ELEMENT_NODE
      ? selection.focusNode
      : selection.focusNode.parentElement;

  if (
    !anchorElement ||
    !focusElement ||
    !root.contains(anchorElement) ||
    !root.contains(focusElement)
  ) {
    return null;
  }

  const sourceElement = anchorElement.closest<HTMLElement>(SELECTABLE_RULE_TEXT_SELECTOR);

  if (!sourceElement || !sourceElement.contains(focusElement)) {
    return null;
  }

  return sourceElement;
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
  const reviewPanelRef = useRef<HTMLElement | null>(null);

  const handleTextSelection = useCallback(
    (entryId: number, element: HTMLElement, field: SelectableRuleField, label: string) => {
      const nextText = getSelectedTextInside(element);
      setSelectedRuleText(nextText ? { entryId, field, label, text: nextText } : null);
    },
    []
  );

  const handleCurrentSelection = useCallback(() => {
    if (!reviewPanelRef.current) {
      return;
    }

    const sourceElement = getSelectionSourceElement(reviewPanelRef.current);
    if (!sourceElement) {
      setSelectedRuleText(null);
      return;
    }

    const entryId = Number(sourceElement.dataset.ruleSelectionEntryId);
    const field = sourceElement.dataset.ruleSelectionField as SelectableRuleField | undefined;
    const label = sourceElement.dataset.ruleSelectionLabel;

    if (!entryId || !field || !label) {
      setSelectedRuleText(null);
      return;
    }

    handleTextSelection(entryId, sourceElement, field, label);
  }, [handleTextSelection]);

  function scheduleSelectionCheck() {
    window.setTimeout(handleCurrentSelection, 0);
    window.setTimeout(handleCurrentSelection, 250);
    window.setTimeout(handleCurrentSelection, 750);
  }

  useEffect(() => {
    let selectionTimer = 0;

    function handleSelectionChange() {
      window.clearTimeout(selectionTimer);
      selectionTimer = window.setTimeout(handleCurrentSelection, 80);
    }

    document.addEventListener("selectionchange", handleSelectionChange);

    return () => {
      window.clearTimeout(selectionTimer);
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [handleCurrentSelection]);

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
    <section className="review-panel" id="starred-review" ref={reviewPanelRef}>
      <div className="review-panel__header">
        <div>
          <p className="eyebrow">Review Queue</p>
          <h2>Starred Filter Candidates</h2>
          <p className="subtle">
            Star articles in Miniflux, then turn them into feed-level rules here.
          </p>
        </div>
        <div className="review-panel__actions">
          <span className="pill">{total} Starred</span>
          <button type="button" className="ghost-button" onClick={onRefresh} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh Starred"}
          </button>
        </div>
      </div>

      {error ? <div className="form-error">{error}</div> : null}

      {loading && entries.length === 0 ? (
        <div className="empty-state">Loading Starred Entries...</div>
      ) : null}

      {!loading && entries.length === 0 ? (
        <div className="empty-state">No Starred Entries Are Waiting for Review.</div>
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
                      className="selectable-text"
                      data-rule-selection-entry-id={entry.id}
                      data-rule-selection-field="EntryTitle"
                      data-rule-selection-label="title"
                      onMouseUp={scheduleSelectionCheck}
                      onTouchEnd={scheduleSelectionCheck}
                    >
                      {entry.title}
                    </h3>
                  </div>

                  {contentParagraphs.length > 0 ? (
                    <div className="starred-card__description">
                      {contentParagraphs.map((paragraph, index) => (
                        <p
                          className="selectable-text"
                          data-rule-selection-entry-id={entry.id}
                          data-rule-selection-field="EntryContent"
                          data-rule-selection-label="description"
                          key={`${entry.id}-paragraph-${index}`}
                          onMouseUp={scheduleSelectionCheck}
                          onTouchEnd={scheduleSelectionCheck}
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
                        data-rule-selection-entry-id={entry.id}
                        data-rule-selection-field="EntryURL"
                        data-rule-selection-label="URL"
                        href={entry.url}
                        target="_blank"
                        rel="noreferrer"
                        onMouseUp={scheduleSelectionCheck}
                        onTouchEnd={scheduleSelectionCheck}
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
