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

function getNextCaseInsensitiveValue(rule: RuleDraft, nextField: RuleDraft["field"]) {
  if (!supportsCaseInsensitiveMatching(nextField)) {
    return false;
  }

  if (!supportsCaseInsensitiveMatching(rule.field)) {
    return true;
  }

  return rule.caseInsensitive;
}

function renderRuleRows(
  tab: RuleTab,
  rules: RuleDraft[],
  onChangeRules: (tab: RuleTab, rules: RuleDraft[]) => void
) {
  return rules.map((rule, index) => (
    <article className="rule-card" key={rule.id}>
      <div className="rule-grid">
        <label className="rule-grid__field">
          <span>Field</span>
          <select
            value={rule.field}
            onChange={(event) =>
              onChangeRules(
                tab,
                updateRule(rules, rule.id, {
                  field: event.target.value as RuleDraft["field"],
                  caseInsensitive: getNextCaseInsensitiveValue(
                    rule,
                    event.target.value as RuleDraft["field"]
                  )
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
            onChange={(event) =>
              onChangeRules(tab, updateRule(rules, rule.id, { pattern: event.target.value }))
            }
          />
          {supportsCaseInsensitiveMatching(rule.field) ? (
            <div className="rule-option">
              <input
                type="checkbox"
                checked={rule.caseInsensitive}
                onChange={(event) =>
                  onChangeRules(
                    tab,
                    updateRule(rules, rule.id, { caseInsensitive: event.target.checked })
                  )
                }
              />
              <span>Add `(?i)` for case-insensitive matching</span>
            </div>
          ) : (
            <p className="rule-note">Date rules use Miniflux date syntax, not regex matching flags.</p>
          )}
        </label>

        <div className="rule-actions">
          <button type="button" onClick={() => onChangeRules(tab, moveRule(rules, index, -1))}>
            Up
          </button>
          <button type="button" onClick={() => onChangeRules(tab, moveRule(rules, index, 1))}>
            Down
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => onChangeRules(tab, removeRule(rules, rule.id))}
          >
            Remove
          </button>
        </div>
      </div>
    </article>
  ));
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
  const activeRules = activeTab === "block" ? blockRules : allowRules;
  const compiledRules = compileRuleText(activeRules);

  return (
    <section className="editor-panel">
      <div className="editor-header">
        <div>
          <p className="eyebrow">Selected feed</p>
          <h2>{feed.title}</h2>
          <p className="subtle">{feed.feed_url}</p>
        </div>

        <div className="editor-header__actions">
          <button type="button" className="ghost-button" onClick={onReset} disabled={!dirty || saving}>
            Reset
          </button>
        </div>
      </div>

      <div className="editor-tabs">
        <button
          type="button"
          className={activeTab === "block" ? "active" : ""}
          onClick={() => onTabChange("block")}
        >
          Entry blocking rules
        </button>
        <button
          type="button"
          className={activeTab === "allow" ? "active" : ""}
          onClick={() => onTabChange("allow")}
        >
          Entry allow rules
        </button>
      </div>

      <div className="info-panel">
        <p>
          Build rules here, then Miniflux saves them back in its normal one-rule-per-line format.
        </p>
        <p>New text-based rules start with `(?i)` enabled, and you can switch it off per rule.</p>
        <p>
          Test a pattern on{" "}
          <a
            href="https://regex101.com/"
            target="_blank"
            rel="noreferrer"
          >
            regex101
          </a>{" "}
          using the Golang flavour.
        </p>
      </div>

      <div className="rule-list">
        {activeRules.length === 0 ? <div className="empty-state">No rules yet for this tab.</div> : null}
        {renderRuleRows(activeTab, activeRules, onChangeRules)}
      </div>

      <div className="rule-toolbar">
        <div className="rule-toolbar__group">
          <button
            type="button"
            className="ghost-button"
            onClick={() => onChangeRules(activeTab, [...activeRules, createRuleDraft()])}
          >
            Add rule
          </button>
          <span className="pill">{activeRules.length} rules</span>
        </div>
        <button type="button" className="primary-button" onClick={() => void onSave()} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save to Miniflux"}
        </button>
      </div>

      <div className="compiled-panel">
        <h3>Compiled rules</h3>
        <textarea readOnly value={compiledRules} rows={Math.max(activeRules.length + 1, 8)} />
        <p>This is the exact text that will be sent to Miniflux for the current tab.</p>
      </div>

      {saveError ? <div className="form-error">{saveError}</div> : null}
      {saveMessage ? <div className="form-success">{saveMessage}</div> : null}
    </section>
  );
}
