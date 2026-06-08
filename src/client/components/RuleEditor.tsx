import { useEffect, useMemo, useRef, useState } from "react";
import {
  RULE_FIELDS,
  compileRulePattern,
  compileRuleText,
  createRuleDraft,
  getRegexPatternSuggestion,
  supportsCaseInsensitiveMatching,
  supportsWordBoundaryMatching,
  type MinifluxFeed,
  type RuleDraft
} from "../../shared/miniflux";
import BackButton from "./BackButton";

type RuleTab = "block" | "allow";
type RuleWarning =
  | {
      type: "duplicate";
      id: string;
      message: string;
      targetRuleId: string;
      targetRuleNumber: number;
    }
  | {
      type: "text";
      id: string;
      message: string;
    }
  | {
      type: "regex-fix";
      id: string;
      message: string;
      fixedPattern: string;
      targetRuleId: string;
      targetRuleNumber: number;
    };

interface RuleEditorProps {
  feed: MinifluxFeed;
  activeTab: RuleTab;
  onTabChange: (tab: RuleTab) => void;
  blockRules: RuleDraft[];
  allowRules: RuleDraft[];
  onChangeRules: (tab: RuleTab, rules: RuleDraft[]) => void;
  onSave: () => Promise<void>;
  onReset: () => void;
  onBack: () => void;
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
  nextRules.splice(
    index + 1,
    0,
    createRuleDraft(
      rule.field,
      rule.pattern,
      rule.caseInsensitive,
      rule.mode,
      rule.matchPossessive
    )
  );
  return nextRules;
}

function getRuleWarnings(rules: RuleDraft[]): RuleWarning[] {
  const warnings: RuleWarning[] = [];
  const seen = new Map<string, { ruleId: string; ruleNumber: number }>();

  rules.forEach((rule, index) => {
    const ruleNumber = index + 1;
    const key = compileRuleText([rule]);
    const earlierRule = seen.get(key);

    if (earlierRule) {
      warnings.push({
        type: "duplicate",
        id: `${rule.id}-duplicate`,
        message: `Rule ${ruleNumber} is a duplicate of rule ${earlierRule.ruleNumber}.`,
        targetRuleId: earlierRule.ruleId,
        targetRuleNumber: earlierRule.ruleNumber
      });
    } else {
      seen.set(key, { ruleId: rule.id, ruleNumber });
    }

    if (!rule.pattern.trim()) {
      warnings.push({
        type: "text",
        id: `${rule.id}-empty-pattern`,
        message: `Rule ${ruleNumber} has an empty pattern.`
      });
      return;
    }

    if (rule.field !== "EntryDate" && rule.mode === "regex") {
      try {
        const flags = rule.caseInsensitive ? "i" : "";
        void new RegExp(compileRulePattern(rule), flags);
      } catch {
        warnings.push({
          type: "text",
          id: `${rule.id}-invalid-pattern`,
          message: `Rule ${ruleNumber} has an invalid regex pattern.`
        });
      }

      const suggestion = getRegexPatternSuggestion(rule.pattern, rule.field);
      if (suggestion) {
        warnings.push({
          type: "regex-fix",
          id: `${rule.id}-regex-boundary-fix`,
          message: `Rule ${ruleNumber}: ${suggestion.message}`,
          fixedPattern: suggestion.fixedPattern,
          targetRuleId: rule.id,
          targetRuleNumber: ruleNumber
        });
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

export default function RuleEditor({
  feed,
  activeTab,
  onTabChange,
  blockRules,
  allowRules,
  onChangeRules,
  onSave,
  onReset,
  onBack,
  saving,
  dirty,
  saveError,
  saveMessage
}: RuleEditorProps) {
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [rulesCollapsed, setRulesCollapsed] = useState(false);
  const activeRules = activeTab === "block" ? blockRules : allowRules;

  const filteredRules = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return activeRules;
    }

    return activeRules.filter((rule) => `${rule.field} ${rule.pattern}`.toLowerCase().includes(query));
  }, [activeRules, searchQuery]);

  const compiledRules = compileRuleText(activeRules);
  const warnings = getRuleWarnings(activeRules);
  const hasFixableRegexWarnings = warnings.some((warning) => warning.type === "regex-fix");
  const compiledRows = Math.min(Math.max(activeRules.length + 1, 8), 16);
  const editorTopRef = useRef<HTMLElement | null>(null);
  const compiledPanelRef = useRef<HTMLDivElement | null>(null);
  const compiledTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const compiledTextarea = compiledTextareaRef.current;
    if (compiledTextarea) {
      compiledTextarea.scrollTop = compiledTextarea.scrollHeight;
    }
  }, [compiledRules]);

  function handleBackToTop() {
    editorTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleJumpToCompiledRules() {
    compiledPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => {
      const compiledTextarea = compiledTextareaRef.current;
      if (compiledTextarea) {
        compiledTextarea.scrollTop = compiledTextarea.scrollHeight;
      }
    }, 120);
  }

  function handleAddRule() {
    const nextRule = createRuleDraft();
    setRulesCollapsed(false);
    onChangeRules(activeTab, [...activeRules, nextRule]);
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        document.getElementById(`rule-${nextRule.id}`)?.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
      }, 80);
    });
  }

  function handleJumpToRule(ruleId: string) {
    setSearchQuery("");
    window.requestAnimationFrame(() => {
      document.getElementById(`rule-${ruleId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function handleApplyRegexFix(ruleId: string, fixedPattern: string) {
    onChangeRules(activeTab, updateRule(activeRules, ruleId, { pattern: fixedPattern }));
    window.setTimeout(handleJumpToCompiledRules, 80);
  }

  return (
    <section className="editor-panel" ref={editorTopRef}>
      <div className="editor-nav">
        <BackButton onClick={onBack} />
      </div>

      <div className="editor-header">
        <div>
          <p className="eyebrow">Selected Feed</p>
          <h2>{feed.title}</h2>
          <p className="subtle">{feed.feed_url}</p>
        </div>

        <div className="editor-header__actions">
          <button type="button" className="primary-button" onClick={handleAddRule}>
            Add Rule
          </button>
          <button type="button" className="ghost-button" onClick={handleJumpToCompiledRules}>
            Compiled Rules
          </button>
          <button type="button" className="ghost-button" onClick={() => setRulesCollapsed((value) => !value)}>
            {rulesCollapsed ? "Show Rules" : "Collapse Rules"}
          </button>
          <button type="button" className="ghost-button" onClick={onReset} disabled={!dirty || saving}>
            Reset
          </button>
          <button type="button" className="ghost-button" onClick={() => setShowSearch((value) => !value)}>
            {showSearch ? "Hide Search" : "Search"}
          </button>
        </div>
      </div>

      {showSearch ? (
        <div className="rule-search-panel">
          <label>
            <span>Search Rules in This Feed and Tab</span>
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
          Entry Blocking Rules
        </button>
        <button type="button" className={activeTab === "allow" ? "active" : ""} onClick={() => onTabChange("allow")}>
          Entry Allow Rules
        </button>
      </div>

      <div className="info-panel">
        <p>Build rules here, then Miniflux saves them back in its normal one-rule-per-line format.</p>
        <p>New rules use regex patterns with `(?i)` enabled, and you can switch it off per rule.</p>
        <p>
          Test a pattern on <a href="https://regex101.com/" target="_blank" rel="noreferrer">regex101</a> using the Golang flavour.
        </p>
      </div>

      {rulesCollapsed ? (
        <div className="empty-state">
          Rules are collapsed. The compiled text below still shows the exact rules for this tab.
        </div>
      ) : (
        <div className="rule-list">
          {activeRules.length === 0 ? <div className="empty-state">No rules yet for this tab.</div> : null}
          {activeRules.length > 0 && filteredRules.length === 0 ? <div className="empty-state">No rules match this search.</div> : null}
          {filteredRules.map((rule) => {
            const index = activeRules.findIndex((candidate) => candidate.id === rule.id);
            const regexSuggestion =
              rule.field !== "EntryDate" && rule.mode === "regex"
                ? getRegexPatternSuggestion(rule.pattern, rule.field)
                : null;

            return (
              <article className="rule-card" id={`rule-${rule.id}`} key={rule.id}>
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
                            caseInsensitive: getNextCaseInsensitiveValue(rule, event.target.value as RuleDraft["field"]),
                            matchPossessive: supportsWordBoundaryMatching(event.target.value as RuleDraft["field"])
                              ? rule.matchPossessive
                              : false
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
                    {regexSuggestion ? (
                      <div className="rule-fix-panel">
                        <p>{regexSuggestion.message}</p>
                        <div className="rule-fix-panel__actions">
                          <code>{regexSuggestion.fixedPattern}</code>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => handleApplyRegexFix(rule.id, regexSuggestion.fixedPattern)}
                          >
                            Apply Fix
                          </button>
                        </div>
                      </div>
                    ) : null}
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
                    {supportsWordBoundaryMatching(rule.field) ? (
                      <div className="rule-option">
                        <input
                          type="checkbox"
                          checked={rule.matchPossessive}
                          onChange={(event) => onChangeRules(activeTab, updateRule(activeRules, rule.id, { matchPossessive: event.target.checked }))}
                        />
                        <span>Match possessive forms such as Amazon's or Amazon’s</span>
                      </div>
                    ) : null}
                    {rule.field !== "EntryDate" ? (
                      <p className="rule-note">
                        New rules use regex patterns. Title, content, tag, and author suggestions include word boundaries.
                      </p>
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
      )}

      <div className="rule-toolbar">
        <div className="rule-toolbar__group">
          <span className="pill">{activeRules.length} rules</span>
        </div>
        <button type="button" className="primary-button" onClick={() => void onSave()} disabled={!dirty || saving || hasFixableRegexWarnings}>{saving ? "Saving…" : "Save to Miniflux"}</button>
      </div>

      <div className="compiled-panel" ref={compiledPanelRef}>
        <div className="compiled-panel__header">
          <h3>Compiled Rules</h3>
          <div className="compiled-panel__actions">
            <button type="button" className="ghost-button" onClick={handleAddRule}>
              Add Rule
            </button>
            <button type="button" className="ghost-button" onClick={onBack}>
              Home
            </button>
            <button type="button" className="ghost-button" onClick={handleBackToTop}>
              Back to Top
            </button>
          </div>
        </div>
        {warnings.length > 0 ? (
          <div className="compiled-panel__warnings">
            <h4>Rule Violations</h4>
            <ul className="rule-warnings">
              {warnings.map((warning) => (
                <li key={warning.id}>
                  <span>{warning.message}</span>
                  {warning.type === "duplicate" ? (
                    <button type="button" onClick={() => handleJumpToRule(warning.targetRuleId)}>
                      Go to Rule {warning.targetRuleNumber}
                    </button>
                  ) : null}
                  {warning.type === "regex-fix" ? (
                    <button type="button" onClick={() => handleJumpToRule(warning.targetRuleId)}>
                      Review Rule {warning.targetRuleNumber}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <textarea ref={compiledTextareaRef} readOnly value={compiledRules} rows={compiledRows} />
        <p>This is the exact text that will be sent to Miniflux for the current tab.</p>
      </div>

      {saveError ? <div className="form-error">{saveError}</div> : null}
      {saveMessage ? <div className="form-success">{saveMessage}</div> : null}
    </section>
  );
}
