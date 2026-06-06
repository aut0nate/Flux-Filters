import { describe, expect, it } from "vitest";

import {
  compileRuleText,
  countRules,
  createRuleFromEntry,
  createRuleDraft,
  createRuleDraftFromText,
  getRegexPatternSuggestion,
  hasFeedFailure,
  parseRuleText,
  supportsCaseInsensitiveMatching
} from "../src/shared/miniflux";

describe("Miniflux rule helpers", () => {
  it("parses valid newline-based rules", () => {
    const rules = parseRuleText(
      [
        "EntryTitle=(?i)Prime Day",
        "EntryContent=(?i)newsletter",
        "EntryDate=max-age:7d"
      ].join("\n")
    );

    expect(rules).toHaveLength(3);
    expect(rules[0]?.field).toBe("EntryTitle");
    expect(rules[0]?.pattern).toBe("Prime Day");
    expect(rules[0]?.caseInsensitive).toBe(true);
    expect(rules[0]?.mode).toBe("regex");
    expect(rules[2]?.pattern).toBe("max-age:7d");
    expect(rules[2]?.caseInsensitive).toBe(false);
  });

  it("ignores blank lines and invalid fields", () => {
    const rules = parseRuleText(
      [
        "",
        "Nope=something",
        "EntryTitle=(?i)valid",
        "broken-rule"
      ].join("\n")
    );

    expect(rules).toHaveLength(1);
    expect(rules[0]?.field).toBe("EntryTitle");
  });

  it("compiles rules back into Miniflux format", () => {
    const compiled = compileRuleText(
      parseRuleText(
        ["EntryTitle=(?i)Delta", "EntryContent=(?i)newsletter=form"].join("\n")
      )
    );

    expect(compiled).toBe(["EntryTitle=(?i)Delta", "EntryContent=(?i)newsletter=form"].join("\n"));
  });

  it("compiles new draft rules as regex patterns by default", () => {
    const compiled = compileRuleText([createRuleDraft("EntryTitle", "Prime Day")]);

    expect(compiled).toBe("EntryTitle=(?i)Prime Day");
  });

  it("preserves regex rule patterns when compiling", () => {
    const compiled = compileRuleText([createRuleDraft("EntryTitle", "\\b(Prime Day)\\b", true, "regex")]);

    expect(compiled).toBe("EntryTitle=(?i)\\b(Prime Day)\\b");
  });

  it("creates escaped regex rules with word boundaries from selected text", () => {
    const compiled = compileRuleText([createRuleDraftFromText("EntryTitle", "Save $50 (today)")]);

    expect(compiled).toBe("EntryTitle=(?i)\\bSave \\$50 \\(today\\)\\B");
  });

  it("uses a non-boundary when selected text ends with a symbol", () => {
    const compiled = compileRuleText([createRuleDraftFromText("EntryTitle", "AU$")]);

    expect(compiled).toBe("EntryTitle=(?i)\\bAU\\$\\B");
  });

  it("formats URL text rules as escaped path regex patterns", () => {
    const compiled = compileRuleText([createRuleDraftFromText("EntryURL", "/sport/cricket")]);

    expect(compiled).toBe("EntryURL=(?i)\\/sport\\/cricket\\/");
  });

  it("can compile possessive forms for regex alternatives", () => {
    const compiled = compileRuleText([
      createRuleDraft(
        "EntryTitle",
        "\\b(?:Amazon|Best Buy)\\b",
        true,
        "regex",
        true
      )
    ]);

    expect(compiled).toBe("EntryTitle=(?i)\\b(?:Amazon(?:['’]s)?|Best Buy(?:['’]s)?)\\b");
  });

  it("suggests replacing a trailing word boundary after a non-word symbol", () => {
    expect(getRegexPatternSuggestion("\\bAU\\$\\b")).toMatchObject({
      fixedPattern: "\\bAU\\$\\B"
    });
  });

  it("suggests escaping URL path slashes and closing simple path fragments", () => {
    expect(getRegexPatternSuggestion("/thefilter", "EntryURL")).toMatchObject({
      fixedPattern: "\\/thefilter\\/"
    });
  });

  it("does not suggest URL fixes when path slashes are already escaped", () => {
    expect(getRegexPatternSuggestion("\\/thefilter\\/", "EntryURL")).toBeNull();
  });

  it("does not rewrite grouped alternatives ending in a word boundary", () => {
    expect(getRegexPatternSuggestion("\\b(?:Amazon|Best Buy)\\b")).toBeNull();
  });

  it("counts rules based on valid entries only", () => {
    expect(countRules("EntryTitle=(?i)test\nbroken\nEntryDate=max-age:1d")).toBe(2);
  });

  it("detects failed feeds from parsing errors", () => {
    expect(
      hasFeedFailure({
        parsing_error_count: 2,
        parsing_error_message: ""
      })
    ).toBe(true);
    expect(
      hasFeedFailure({
        parsing_error_count: 0,
        parsing_error_message: "Access to this website is forbidden."
      })
    ).toBe(true);
    expect(
      hasFeedFailure({
        parsing_error_count: 0,
        parsing_error_message: ""
      })
    ).toBe(false);
  });

  it("defaults new regex rules to case-insensitive matching", () => {
    expect(createRuleDraft("EntryTitle")).toMatchObject({
      field: "EntryTitle",
      pattern: "",
      caseInsensitive: true,
      mode: "regex"
    });
    expect(createRuleDraft("EntryDate")).toMatchObject({
      field: "EntryDate",
      pattern: "",
      caseInsensitive: false
    });
  });

  it("keeps date rules free of regex flags when compiling", () => {
    const compiled = compileRuleText([
      createRuleDraft("EntryDate", "after:2026-04-01"),
      createRuleDraft("EntryTitle", "Weekly Digest", false)
    ]);

    expect(compiled).toBe(["EntryDate=after:2026-04-01", "EntryTitle=Weekly Digest"].join("\n"));
    expect(supportsCaseInsensitiveMatching("EntryDate")).toBe(false);
  });

  it("creates bounded regex rules from starred entries", () => {
    const rule = createRuleFromEntry(
      {
        id: 10,
        feed_id: 2,
        title: "NBA: Two fans banned after incident",
        url: "https://example.com/story",
        author: "Example Author",
        published_at: "2026-06-06T10:00:00Z",
        status: "read",
        starred: true,
        tags: ["Sport"]
      },
      "EntryTitle"
    );

    expect(rule).toMatchObject({
      field: "EntryTitle",
      pattern: "\\bNBA: Two fans banned after incident\\b",
      mode: "regex",
      caseInsensitive: true
    });
  });
});
