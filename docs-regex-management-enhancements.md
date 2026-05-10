# Regex Management Enhancement Ideas

This note captures practical feature ideas to reduce manual work when managing regex rules across many feeds.

## 1) Cross-feed rule library (highest impact)

Add a reusable library of named rule snippets that can be applied to one feed, many feeds, or all feeds.

- Store snippets as plain rule lines with metadata (name, notes, tags).
- Apply snippets without changing Miniflux rule format.
- Show a preview diff before applying.
- Support both `blocklist_rules` and `keeplist_rules`.

Why this helps:
- You can define common patterns once (for example ad, repost, and sponsored markers) and reuse them everywhere.

Implementation fit:
- Add client-side snippet state first (session/local storage), then optional server-side persistence later if needed.
- Reuse existing parse/compile helpers so output remains line-based Miniflux text.

## 2) Bulk edit mode across selected feeds

Add a multi-select feed mode with batch actions:

- Append rules to selected feeds.
- Insert rules at top (higher priority).
- Remove matching rule lines from selected feeds.
- Replace one pattern with another.

Why this helps:
- Cuts repeated edits when onboarding many feeds.

Implementation fit:
- Extend feed sidebar with checkboxes and an action bar.
- Use existing `saveFeedRules` flow in a queue with per-feed success/failure feedback.

## 3) Rule deduplication and conflict checks

Add a validation layer before save:

- Detect exact duplicate rules in a tab.
- Warn when allow rules are shadowed by earlier block rules (or vice versa by order).
- Warn on empty patterns or malformed expressions.

Why this helps:
- Prevents accidental no-op or contradictory rule sets.

Implementation fit:
- Keep checks advisory; do not auto-rewrite text.
- Surface warnings in editor and compiled preview panels.

## 4) Regex testing sandbox in-app

Provide a small test harness:

- Paste sample title/content/author/category/date.
- Evaluate against current rules in order.
- Show first matching rule and tab (block/allow).

Why this helps:
- Speeds up tuning without bouncing to external tools.

Implementation fit:
- Local-only evaluator for regex-capable fields.
- For date fields, clearly show unsupported local simulation if exact Miniflux logic differs.

## 5) Templates and quick starts

Add starter packs of common patterns:

- “Marketing noise”, “Crypto spam”, “Job board flood”, etc.
- One-click import into current feed or selected feeds.

Why this helps:
- Reduces blank-page effort and gives safe examples.

Implementation fit:
- Ship as static JSON in `src/shared` and map to existing `RuleDraft` shape.

## 6) Import/export for backup and migration

Add export/import for all managed rules:

- Export feed IDs/titles with block + allow rule text.
- Re-import with preview and merge mode.

Why this helps:
- Easier backups, sharing, and rollback.

Implementation fit:
- JSON format only; keep Miniflux payload untouched on save.

## 7) Productivity UX improvements

Small upgrades that save time daily:

- Keyboard shortcuts (add rule, move rule, save, switch tabs).
- Clone rule and clone to other feeds.
- Autosave draft locally per feed (until explicit save to Miniflux).
- “Recent patterns” picker.

## Suggested delivery order

1. Cross-feed rule library
2. Bulk edit mode
3. Validation and conflict warnings
4. In-app testing sandbox
5. Import/export
6. Templates and minor UX polish

This order focuses on immediate time savings while keeping behaviour aligned with Miniflux’s line-by-line rule model.
