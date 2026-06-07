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
export type RuleMode = "text" | "regex";

export interface RuleDraft {
  id: string;
  field: RuleField;
  pattern: string;
  caseInsensitive: boolean;
  mode: RuleMode;
  matchPossessive: boolean;
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
  checked_at?: string;
  parsing_error_message?: string;
  parsing_error_count?: number;
  disabled?: boolean;
  category?: {
    id: number;
    title: string;
  };
  blocklist_rules?: string;
  keeplist_rules?: string;
  block_filter_entry_rules?: string;
  keep_filter_entry_rules?: string;
}

export interface MinifluxEntry {
  id: number;
  feed_id: number;
  title: string;
  url: string;
  comments_url?: string;
  author?: string;
  content?: string;
  published_at: string;
  created_at?: string;
  changed_at?: string;
  status: "read" | "unread" | "removed";
  starred: boolean;
  tags?: string[];
  feed?: MinifluxFeed;
}

export interface MinifluxEntriesResponse {
  total: number;
  entries: MinifluxEntry[];
}

export interface RegexPatternSuggestion {
  fixedPattern: string;
  message: string;
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
const POSSESSIVE_PATTERN = "(?:['’]s)?";
const WORD_BOUNDARY_FIELDS = new Set<RuleField>([
  "EntryTitle",
  "EntryContent",
  "EntryAuthor",
  "EntryTag"
]);
const URL_FIELDS = new Set<RuleField>(["EntryURL", "EntryCommentsURL"]);

export function supportsCaseInsensitiveMatching(field: RuleField): boolean {
  return field !== "EntryDate";
}

export function supportsWordBoundaryMatching(field: RuleField): boolean {
  return WORD_BOUNDARY_FIELDS.has(field);
}

function supportsUrlPatternFormatting(field: RuleField): boolean {
  return URL_FIELDS.has(field);
}

function parseUrlLikeValue(value: string): URL | null {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return null;
  }

  try {
    return new URL(trimmedValue);
  } catch {
    if (!/^[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(trimmedValue)) {
      return null;
    }

    try {
      return new URL(`https://${trimmedValue}`);
    } catch {
      return null;
    }
  }
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
  caseInsensitive = supportsCaseInsensitiveMatching(field),
  mode: RuleMode = "regex",
  matchPossessive = false
): RuleDraft {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `rule-${Math.random().toString(36).slice(2, 10)}`,
    field,
    pattern,
    caseInsensitive: supportsCaseInsensitiveMatching(field) ? caseInsensitive : false,
    mode: field === "EntryDate" ? "regex" : mode,
    matchPossessive: supportsWordBoundaryMatching(field) ? matchPossessive : false
  };
}

export function createRuleDraftFromText(
  field: RuleField,
  text: string,
  caseInsensitive = supportsCaseInsensitiveMatching(field)
): RuleDraft {
  const trimmedText = text.trim();
  const escapedPattern = supportsUrlPatternFormatting(field)
    ? formatUrlRegexPattern(trimmedText)
    : escapeRegExp(trimmedText);
  const pattern =
    escapedPattern && supportsWordBoundaryMatching(field)
      ? `${getBoundaryForTextEdge(trimmedText, "start")}${escapedPattern}${getBoundaryForTextEdge(trimmedText, "end")}`
      : escapedPattern;

  return createRuleDraft(field, pattern, caseInsensitive, "regex");
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
      return [createRuleDraft(field, nextRule.pattern, nextRule.caseInsensitive, "regex")];
    });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeRegexSlashes(value: string): string {
  return value.replace(/(^|[^\\])\//g, "$1\\/");
}

function hasUnescapedSlash(value: string): boolean {
  return /(^|[^\\])\//.test(value);
}

function hasUnescapedDot(value: string): boolean {
  return /(^|[^\\])\./.test(value);
}

function formatUrlRegexPattern(value: string): string {
  const escapedPattern = escapeRegexSlashes(escapeRegExp(value));

  if (!value.startsWith("/") || value.endsWith("/")) {
    return escapedPattern;
  }

  return `${escapedPattern}\\/`;
}

function isReusableUrlPathSegment(segment: string): boolean {
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

export function getUrlRuleCandidates(value: string): string[] {
  const url = parseUrlLikeValue(value);
  if (!url) {
    return [];
  }

  const candidates = new Set<string>();
  if (url.hostname) {
    candidates.add(url.hostname);
  }

  url.pathname
    .split("/")
    .filter(Boolean)
    .filter(isReusableUrlPathSegment)
    .slice(0, 4)
    .forEach((segment) => {
      const candidate = `/${segment}/`;
      if (candidate.length > 2 && candidate.length <= 80) {
        candidates.add(candidate);
      }
    });

  return [...candidates].slice(0, 6);
}

function isAsciiWordCharacter(value: string): boolean {
  return /^[A-Za-z0-9_]$/.test(value);
}

function getBoundaryForTextEdge(value: string, edge: "start" | "end"): "\\b" | "\\B" {
  const character = edge === "start" ? value[0] : value[value.length - 1];
  return character && isAsciiWordCharacter(character) ? "\\b" : "\\B";
}

function applyTextPattern(field: RuleField, pattern: string): string {
  const trimmedPattern = pattern.trim();
  if (!supportsCaseInsensitiveMatching(field) || !trimmedPattern) {
    return trimmedPattern;
  }

  if (supportsUrlPatternFormatting(field)) {
    return formatUrlRegexPattern(trimmedPattern);
  }

  return escapeRegExp(trimmedPattern);
}

function addPossessiveToAlternative(alternative: string): string {
  const trimmedAlternative = alternative.trim();
  if (!trimmedAlternative || trimmedAlternative.includes(POSSESSIVE_PATTERN)) {
    return alternative;
  }

  if (trimmedAlternative.endsWith("\\b")) {
    return `${trimmedAlternative.slice(0, -2)}${POSSESSIVE_PATTERN}\\b`;
  }

  return `${trimmedAlternative}${POSSESSIVE_PATTERN}`;
}

function applyPossessivePattern(pattern: string): string {
  const trimmedPattern = pattern.trim();
  const wrappedAlternatives = trimmedPattern.match(/^\\b\(\?:(.+)\)\\b$/);
  if (wrappedAlternatives) {
    return `\\b(?:${wrappedAlternatives[1]
      .split("|")
      .map(addPossessiveToAlternative)
      .join("|")})\\b`;
  }

  const wrappedSingle = trimmedPattern.match(/^\\b(.+)\\b$/);
  if (wrappedSingle) {
    return `\\b${addPossessiveToAlternative(wrappedSingle[1])}\\b`;
  }

  return trimmedPattern.split("|").map(addPossessiveToAlternative).join("|");
}

export function compileRulePattern(rule: RuleDraft): string {
  const pattern =
    rule.mode === "text" ? applyTextPattern(rule.field, rule.pattern) : rule.pattern.trim();

  if (rule.matchPossessive && supportsWordBoundaryMatching(rule.field)) {
    return applyPossessivePattern(pattern);
  }

  return pattern;
}

function getLiteralCharacterBeforeBoundary(pattern: string, boundaryIndex: number): string {
  if (boundaryIndex <= 0) {
    return "";
  }

  const previousCharacter = pattern[boundaryIndex - 1];
  if (previousCharacter !== "\\") {
    return previousCharacter;
  }

  if (boundaryIndex <= 1) {
    return "";
  }

  const escapedCharacter = pattern[boundaryIndex - 2];
  if (["b", "B", "d", "D", "s", "S", "w", "W"].includes(escapedCharacter)) {
    return "";
  }

  return escapedCharacter;
}

function shouldUseNonBoundaryAfterLiteral(value: string): boolean {
  return ["$", "£", "€", "¥", "¢", "%", "+", "/", "#", "@", "&", "=", ":", ";", ",", ".", "-"].includes(value);
}

function fixTrailingBoundaryAfterNonWord(pattern: string): string {
  let fixedPattern = "";
  let lastIndex = 0;

  for (const match of pattern.matchAll(/\\b/g)) {
    const boundaryIndex = match.index ?? 0;
    const previousLiteral = getLiteralCharacterBeforeBoundary(pattern, boundaryIndex);
    fixedPattern += pattern.slice(lastIndex, boundaryIndex);
    fixedPattern += shouldUseNonBoundaryAfterLiteral(previousLiteral) ? "\\B" : "\\b";
    lastIndex = boundaryIndex + 2;
  }

  return fixedPattern + pattern.slice(lastIndex);
}

function getUrlPatternSuggestion(pattern: string): RegexPatternSuggestion | null {
  const trimmedPattern = pattern.trim();
  let fixedPattern =
    hasUnescapedSlash(trimmedPattern) || hasUnescapedDot(trimmedPattern)
      ? formatUrlRegexPattern(trimmedPattern)
      : escapeRegexSlashes(trimmedPattern);
  const startsWithPathSlash = fixedPattern.startsWith("\\/");
  const endsWithPathSlash = fixedPattern.endsWith("\\/");

  if (startsWithPathSlash && !endsWithPathSlash) {
    fixedPattern = `${fixedPattern}\\/`;
  }

  if (
    fixedPattern === trimmedPattern &&
    !hasUnescapedSlash(trimmedPattern) &&
    !hasUnescapedDot(trimmedPattern)
  ) {
    return null;
  }

  return {
    fixedPattern,
    message:
      "URL rules should escape literal dots and slashes. Simple path fragments should include the closing slash so they match a path segment."
  };
}

export function getRegexPatternSuggestion(pattern: string, field?: RuleField): RegexPatternSuggestion | null {
  const trimmedPattern = pattern.trim();
  const fixedPattern = fixTrailingBoundaryAfterNonWord(trimmedPattern);

  if (field && supportsUrlPatternFormatting(field)) {
    const urlSuggestion = getUrlPatternSuggestion(fixedPattern);
    if (urlSuggestion) {
      return urlSuggestion;
    }
  }

  if (fixedPattern === trimmedPattern) {
    return null;
  }

  return {
    fixedPattern,
    message:
      "`\\b` only matches between a word character and a non-word character. The previous token is non-word, so `\\B` is the safer boundary here."
  };
}

export function compileRuleText(rules: RuleDraft[]): string {
  return rules
    .map((rule) => {
      const prefix =
        supportsCaseInsensitiveMatching(rule.field) && rule.caseInsensitive
          ? CASE_INSENSITIVE_PREFIX
          : "";

      return `${rule.field}=${prefix}${compileRulePattern(rule)}`;
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

export function hasFeedFailure(
  feed: Pick<MinifluxFeed, "parsing_error_count" | "parsing_error_message">
): boolean {
  return (feed.parsing_error_count ?? 0) > 0 || Boolean(feed.parsing_error_message?.trim());
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

export function createRuleFromEntry(
  entry: MinifluxEntry,
  field: Extract<RuleField, "EntryTitle" | "EntryURL" | "EntryAuthor" | "EntryTag">
): RuleDraft | null {
  const firstTag = entry.tags?.find((tag) => tag.trim());
  const values: Record<typeof field, string | undefined> = {
    EntryTitle: entry.title,
    EntryURL: entry.url,
    EntryAuthor: entry.author,
    EntryTag: firstTag
  };

  const value = values[field]?.trim();
  if (!value) {
    return null;
  }

  return createRuleDraftFromText(field, value, true);
}
