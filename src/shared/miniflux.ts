export const RULE_FIELDS = [
  "EntryTitle",
  "EntryURL",
  "EntryCommentsURL",
  "EntryContent",
  "EntryAuthor",
  "EntryTag",
  "EntryDate"
] as const;

export type RuleField = (typeof RULE_FIELDS)[number];

export interface RuleDraft {
  id: string;
  field: RuleField;
  pattern: string;
  caseInsensitive: boolean;
}

export interface MinifluxUser {
  id: number;
  username: string;
  is_admin?: boolean;
  theme?: string;
  timezone?: string;
}

export interface MinifluxFeed {
  id: number;
  title: string;
  feed_url: string;
  site_url: string;
  category?: {
    id: number;
    title: string;
  };
  blocklist_rules?: string;
  keeplist_rules?: string;
  block_filter_entry_rules?: string;
  keep_filter_entry_rules?: string;
}

export const DATE_PATTERN_HELP = [
  "future",
  "before:YYYY-MM-DD",
  "after:YYYY-MM-DD",
  "between:YYYY-MM-DD,YYYY-MM-DD",
  "max-age:7d"
];

export function isRuleField(value: string): value is RuleField {
  return RULE_FIELDS.includes(value as RuleField);
}

const CASE_INSENSITIVE_PREFIX = "(?i)";

export function supportsCaseInsensitiveMatching(field: RuleField): boolean {
  return field !== "EntryDate";
}

function splitCaseInsensitivePrefix(field: RuleField, pattern: string) {
  if (!supportsCaseInsensitiveMatching(field) || !pattern.startsWith(CASE_INSENSITIVE_PREFIX)) {
    return {
      pattern,
      caseInsensitive: false
    };
  }

  return {
    pattern: pattern.slice(CASE_INSENSITIVE_PREFIX.length),
    caseInsensitive: true
  };
}

export function createRuleDraft(
  field: RuleField = "EntryTitle",
  pattern = "",
  caseInsensitive = supportsCaseInsensitiveMatching(field)
): RuleDraft {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `rule-${Math.random().toString(36).slice(2, 10)}`,
    field,
    pattern,
    caseInsensitive: supportsCaseInsensitiveMatching(field) ? caseInsensitive : false
  };
}

export function parseRuleText(text: string): RuleDraft[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const separatorIndex = line.indexOf("=");
      if (separatorIndex === -1) {
        return [];
      }

      const field = line.slice(0, separatorIndex).trim();
      const pattern = line.slice(separatorIndex + 1);

      if (!isRuleField(field)) {
        return [];
      }

      const nextRule = splitCaseInsensitivePrefix(field, pattern);
      return [createRuleDraft(field, nextRule.pattern, nextRule.caseInsensitive)];
    });
}

export function compileRuleText(rules: RuleDraft[]): string {
  return rules
    .map((rule) => {
      const prefix =
        supportsCaseInsensitiveMatching(rule.field) && rule.caseInsensitive
          ? CASE_INSENSITIVE_PREFIX
          : "";

      return `${rule.field}=${prefix}${rule.pattern}`;
    })
    .join("\n")
    .trim();
}

export function countRules(text = ""): number {
  return parseRuleText(text).length;
}

export function hasRules(feed: Pick<MinifluxFeed, "blocklist_rules" | "keeplist_rules">): boolean {
  return countRules(feed.blocklist_rules) > 0 || countRules(feed.keeplist_rules) > 0;
}

export function getFeedBlockRules(feed: Partial<MinifluxFeed>): string {
  return feed.block_filter_entry_rules ?? feed.blocklist_rules ?? "";
}

export function getFeedAllowRules(feed: Partial<MinifluxFeed>): string {
  return feed.keep_filter_entry_rules ?? feed.keeplist_rules ?? "";
}

export function hasEntryFilterRules(
  feed: Pick<
    MinifluxFeed,
    "block_filter_entry_rules" | "keep_filter_entry_rules" | "blocklist_rules" | "keeplist_rules"
  >
): boolean {
  return countRules(getFeedBlockRules(feed)) > 0 || countRules(getFeedAllowRules(feed)) > 0;
}
