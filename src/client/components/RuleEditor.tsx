import { useMemo, useRef, useState } from "react";
import {
  RULE_FIELDS,
  compileRuleText,
  createRuleDraft,
  supportsCaseInsensitiveMatching,
  type MinifluxFeed,
  type RuleDraft
} from "../../shared/miniflux";

type RuleTab = "block" | "allow";

interface RuleEditorProps {
  feed: MinifluxFeed;
  activeTab: RuleTab;
  onTabChange: (tab: RuleTab) => void;
  blockRules: RuleDraft[];
  allowRules: RuleDraft[];
  onChangeRules: (tab: RuleTab, rules: RuleDraft[]) => void;
  onSave: () => Promise<void>;
  onReset: () => void;
  saving: boolean;
  dirty: boolean;
  saveError: string;
  saveMessage: string;
}

function updateRule(rules: RuleDraft[], ruleId: string, nextValue: Partial<RuleDraft>): RuleDraft[] {
  return rules.map((rule) => (rule.id === ruleId ? { ...rule, ...nextValue } : rule));
}

function moveRule(rules: RuleDraft[], index: number, direction: -1 | 1): RuleDraft[] {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= rules.length) {
    return rules;
  }

  const nextRules = [...rules];
  const [rule] = nextRules.splice(index, 1);
  nextRules.splice(nextIndex, 0, rule);
  return nextRules;
}

function removeRule(rules: RuleDraft[], ruleId: string): RuleDraft[] {
  return rules.filter((rule) => rule.id !== ruleId);
}

function cloneRule(rules: RuleDraft[], rule: RuleDraft, index: number): RuleDraft[] {
  const nextRules = [...rules];
  nextRules.splice(index + 1, 0, createRuleDraft(rule.field, rule.pattern, rule.caseInsensitive));
  return nextRules;
}

function getRuleWarnings(rules: RuleDraft[]): string[] {
  const warnings: string[] = [];
  const seen = new Set<string>();

  rules.forEach((rule, index) => {
    const key = `${rule.field}=${rule.caseInsensitive ? "(?i)" : ""}${rule.pattern}`;
    if (seen.has(key)) {
      warnings.push(`Rule ${index + 1} is a duplicate of an earlier rule.`);
    } else {
      seen.add(key);
    }

    if (!rule.pattern.trim()) {
      warnings.push(`Rule ${index + 1} has an empty pattern.`);
      return;
    }

    if (rule.field !== "EntryDate") {
      try {
        const flags = rule.caseInsensitive ? "i" : "";
        void new RegExp(rule.pattern, flags);
      } catch {
        warnings.push(`Rule ${index + 1} has an invalid regex pattern.`);
      }
    }
  });

  return warnings;
}

function getNextCaseInsensitiveValue(rule: RuleDraft, nextField: RuleDraft["field"]) {
  if (!supportsCaseInsensitiveMatching(nextField)) {
    return false;
  }

  if (!supportsCaseInsensitiveMatching(rule.field)) {
    return true;
  }

  return rule.caseInsensitive;
}

function normalisePatternTokens(pattern: string): string[] {
  return splitTopLevelAlternatives(pattern);
}

function splitTopLevelAlternatives(value: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let depth = 0;
  let escaped = false;

  for (const char of value) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }

    if (char === "(") {
      depth += 1;
    }

    if (char === ")") {
      depth = Math.max(0, depth - 1);
    }

    if (char === "|" && depth === 0) {
      tokens.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  tokens.push(current.trim());
  return tokens.filter(Boolean);
}

function findAlternationGroups(pattern: string): Array<{ start: number; end: number; tokens: string[] }> {
  const groups: Array<{ start: number; end: number; tokens: string[] }> = [];

  for (let index = 0; index < pattern.length; index += 1) {
    if (pattern[index] !== "(" || pattern[index - 1] === "\\") {
      continue;
    }

    let depth = 1;
    let cursor = index + 1;
    let escaped = false;

    while (cursor < pattern.length && depth > 0) {
      const char = pattern[cursor];
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
      }
      cursor += 1;
    }

    if (depth !== 0) {
      continue;
    }

    const inner = pattern.slice(index + 1, cursor - 1);
    const tokens = splitTopLevelAlternatives(inner);
    if (tokens.length > 1) {
      groups.push({ start: index + 1, end: cursor - 1, tokens });
    }
    index = cursor - 1;
  }

  return groups;
}

function appendIntoPatternAlternation(pattern: string, token: string): string {
  const groups = findAlternationGroups(pattern);
  if (groups.length === 0) {
    const trimmedPattern = pattern.trim();
    return trimmedPattern ? `${trimmedPattern}|${token}` : token;
  }

  const best = groups.reduce((winner, group) => (group.tokens.length > winner.tokens.length ? group : winner));
  if (best.tokens.some((existing) => existing.toLowerCase() === token.toLowerCase())) {
    return pattern;
  }

  const nextInner = `${pattern.slice(best.start, best.end)}|${token}`;
  return `${pattern.slice(0, best.start)}${nextInner}${pattern.slice(best.end)}`;
}

function getRuleSkeleton(pattern: string): string {
  return pattern
    .replace(/\(\?:/g, "(")
    .replace(/\([^()]*\|[^()]*\)/g, "(ALT)")
    .replace(/\s+/g, "");
}

function appendSuggestionAcrossMatchingRules(rules: RuleDraft[], sourceRuleId: string, token: string): RuleDraft[] {
  const sourceRule = rules.find((rule) => rule.id === sourceRuleId);
  if (!sourceRule) {
    return rules;
  }

  const sourceSkeleton = getRuleSkeleton(sourceRule.pattern);

  return rules.map((rule) => {
    const isSiblingPair = rule.field === sourceRule.field && getRuleSkeleton(rule.pattern) === sourceSkeleton;
    if (!isSiblingPair && rule.id !== sourceRuleId) {
      return rule;
    }

    return { ...rule, pattern: appendIntoPatternAlternation(rule.pattern, token) };
  });
}

export default function RuleEditor({
  feed,
  activeTab,
  onTabChange,
  blockRules,
  allowRules,
  onChangeRules,
  onSave,
  onReset,
  saving,
  dirty,
  saveError,
  saveMessage
}: RuleEditorProps) {
  const [showSearch, setShowSearch] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const activeRules = activeTab === "block" ? blockRules : allowRules;

  const filteredRules = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return activeRules;
    }

    return activeRules.filter((rule) => `${rule.field} ${rule.pattern}`.toLowerCase().includes(query));
  }, [activeRules, searchQuery]);

  const suggestionTokens = useMemo(() => {
    const tokens = new Set<string>();
    for (const rule of activeRules) {
      for (const token of normalisePatternTokens(rule.pattern)) {
        tokens.add(token);
      }
    }
    return Array.from(tokens);
  }, [activeRules]);

  const compiledRules = compileRuleText(activeRules);
  const warnings = getRuleWarnings(activeRules);
  const ruleToolbarRef = useRef<HTMLDivElement | null>(null);

  function handleJumpToBottom() {
    ruleToolbarRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <section className="editor-panel">
      <div className="editor-header">
        <div>
          <p className="eyebrow">Selected feed</p>
          <h2>{feed.title}</h2>
          <p className="subtle">{feed.feed_url}</p>
        </div>

        <div className="editor-header__actions">
          <button type="button" className="ghost-button" onClick={handleJumpToBottom}>
            Jump to bottom
          </button>
          <button type="button" className="ghost-button" onClick={onReset} disabled={!dirty || saving}>
            Reset
          </button>
          <button type="button" className="ghost-button" onClick={() => setShowSearch((value) => !value)}>
            {showSearch ? "Hide search" : "Search"}
          </button>
          <button type="button" className="ghost-button" onClick={() => setShowSuggestions((value) => !value)}>
            {showSuggestions ? "Hide suggestions" : "Suggestions"}
          </button>
        </div>
      </div>

      {showSearch ? (
        <div className="rule-search-panel">
          <label>
            <span>Search rules in this feed and tab</span>
            <input
              className="search-input"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search by field or pattern"
            />
          </label>
        </div>
      ) : null}

      <div className="editor-tabs">
        <button type="button" className={activeTab === "block" ? "active" : ""} onClick={() => onTabChange("block")}>
          Entry blocking rules
        </button>
        <button type="button" className={activeTab === "allow" ? "active" : ""} onClick={() => onTabChange("allow")}>
          Entry allow rules
        </button>
      </div>

      <div className="info-panel">
        <p>Build rules here, then Miniflux saves them back in its normal one-rule-per-line format.</p>
        <p>New text-based rules start with `(?i)` enabled, and you can switch it off per rule.</p>
        <p>
          Test a pattern on <a href="https://regex101.com/" target="_blank" rel="noreferrer">regex101</a> using the Golang flavour.
        </p>
      </div>

      <div className="rule-list">
        {activeRules.length === 0 ? <div className="empty-state">No rules yet for this tab.</div> : null}
        {activeRules.length > 0 && filteredRules.length === 0 ? <div className="empty-state">No rules match this search.</div> : null}
        {filteredRules.map((rule) => {
          const index = activeRules.findIndex((candidate) => candidate.id === rule.id);
          const currentTokens = normalisePatternTokens(rule.pattern);
          const typedQuery = rule.pattern.trim().toLowerCase();
          const matchingSuggestions = showSuggestions
            ? suggestionTokens
                .filter((token) => {
                  const tokenLower = token.toLowerCase();
                  return typedQuery.length > 1 && tokenLower.includes(typedQuery) && !currentTokens.includes(token);
                })
                .slice(0, 6)
            : [];

          return (
            <article className="rule-card" key={rule.id}>
              <div className="rule-grid">
                <label className="rule-grid__field">
                  <span>Field</span>
                  <select
                    value={rule.field}
                    onChange={(event) =>
                      onChangeRules(
                        activeTab,
                        updateRule(activeRules, rule.id, {
                          field: event.target.value as RuleDraft["field"],
                          caseInsensitive: getNextCaseInsensitiveValue(rule, event.target.value as RuleDraft["field"])
                        })
                      )
                    }
                  >
                    {RULE_FIELDS.map((field) => (
                      <option key={field} value={field}>
                        {field}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="rule-grid__pattern">
                  <span>Pattern</span>
                  <textarea
                    value={rule.pattern}
                    rows={3}
                    onChange={(event) => onChangeRules(activeTab, updateRule(activeRules, rule.id, { pattern: event.target.value }))}
                  />
                  {supportsCaseInsensitiveMatching(rule.field) ? (
                    <div className="rule-option">
                      <input
                        type="checkbox"
                        checked={rule.caseInsensitive}
                        onChange={(event) => onChangeRules(activeTab, updateRule(activeRules, rule.id, { caseInsensitive: event.target.checked }))}
                      />
                      <span>Add `(?i)` for case-insensitive matching</span>
                    </div>
                  ) : (
                    <p className="rule-note">Date rules use Miniflux date syntax, not regex matching flags.</p>
                  )}

                  {matchingSuggestions.length > 0 ? (
                    <div className="rule-suggestions">
                      <span>Quick append suggestions</span>
                      <div className="rule-suggestions__list">
                        {matchingSuggestions.map((token) => (
                          <button
                            key={`${rule.id}-${token}`}
                            type="button"
                            className="ghost-button"
                            onClick={() =>
                              onChangeRules(activeTab, appendSuggestionAcrossMatchingRules(activeRules, rule.id, token))
                            }
                          >
                            Add <span className="pipe-separator">|</span> {token}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </label>

                <div className="rule-actions">
                  <button type="button" onClick={() => onChangeRules(activeTab, moveRule(activeRules, index, -1))}>Up</button>
                  <button type="button" onClick={() => onChangeRules(activeTab, moveRule(activeRules, index, 1))}>Down</button>
                  <button type="button" className="danger" onClick={() => onChangeRules(activeTab, removeRule(activeRules, rule.id))}>Remove</button>
                  <button type="button" onClick={() => onChangeRules(activeTab, cloneRule(activeRules, rule, index))}>Clone</button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="rule-toolbar" ref={ruleToolbarRef}>
        <div className="rule-toolbar__group">
          <button type="button" className="ghost-button" onClick={() => onChangeRules(activeTab, [...activeRules, createRuleDraft()])}>Add rule</button>
          <span className="pill">{activeRules.length} rules</span>
        </div>
        <button type="button" className="primary-button" onClick={() => void onSave()} disabled={!dirty || saving}>{saving ? "Saving…" : "Save to Miniflux"}</button>
      </div>

      <div className="compiled-panel">
        <h3>Compiled rules</h3>
        <textarea readOnly value={compiledRules} rows={Math.max(activeRules.length + 1, 8)} />
        <p>This is the exact text that will be sent to Miniflux for the current tab.</p>
        {warnings.length > 0 ? (
          <ul className="rule-warnings">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
      </div>

      {saveError ? <div className="form-error">{saveError}</div> : null}
      {saveMessage ? <div className="form-success">{saveMessage}</div> : null}
    </section>
  );
}
