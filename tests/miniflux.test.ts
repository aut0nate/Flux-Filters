import { describe, expect, it } from "vitest";

import {
  compileRuleText,
  countRules,
  createRuleDraft,
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

    expect(compiled).toBe(
      ["EntryTitle=(?i)Delta", "EntryContent=(?i)newsletter=form"].join("\n")
    );
  });

  it("counts rules based on valid entries only", () => {
    expect(countRules("EntryTitle=(?i)test\nbroken\nEntryDate=max-age:1d")).toBe(2);
  });

  it("defaults new text rules to case-insensitive matching", () => {
    expect(createRuleDraft("EntryTitle")).toMatchObject({
      field: "EntryTitle",
      pattern: "",
      caseInsensitive: true
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
});
