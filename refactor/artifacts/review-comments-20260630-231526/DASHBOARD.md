# Refactor Dashboard

Run: `review-comments-20260630-231526`

## Summary

The portable inline review comments implementation now follows the project architecture more tightly:

- Muya owns portable comment metadata and parser-selected metadata replacement.
- Desktop source mode keeps CodeMirror-specific line replacement and selection behavior, but no longer duplicates metadata parsing/update decisions.
- The markdown-comments skill imports Muya's comment format helpers directly instead of carrying a pass-through metadata façade.

## Change Summary

- Added `appendCommentReplyMetadata()` to Muya and reused it from Muya, desktop source mode, and the skill.
- Exported `updateCommentMetadataInMarkdown()` through `@muyajs/core` and used it for source-mode metadata edits.
- Removed dead `commitTimer` state from source mode.
- Reused one source markdown snapshot for source add-comment candidate validation.
- Simplified Muya comment range wrapping by removing pass-through wrappers and redundant inline-code checks.
- Reused `commentPathKey()` from Muya range helpers in parser/rendering paths.
- Deleted `skills/markdown-comments/src/metadata.ts`.

## Metrics

- Product diff: 14 files changed, 106 insertions, 211 deletions, net -105 lines.
- Desktop source file diff: 40 insertions, 81 deletions.
- Muya comments edit diff: 28 insertions, 50 deletions.
- Skill edit diff: 4 insertions, 22 deletions, plus the 15-line deleted metadata façade.
- Muya lint warnings: 8 before, 7 after.

## Verification

See `verification_after.md` for command details. The important green checks:

- Desktop typecheck passed.
- Muya typecheck passed.
- Skill tests: 22/22 passed.
- Desktop unit tests: 754/754 passed.
- Muya tests: 1473/1473 passed.
- Electron/Vite build passed.
- Root lint passed with the same existing 128 warnings.
- Muya lint passed with 7 existing warnings.

## Artifact Index

- `architecture_patterns.md`
- `candidate_decisions.md`
- `isomorphism_cards.md`
- `verification_after.md`
- `slop/desktop.md`, `slop/muya.md`, `slop/skill.md`
- Baseline logs: `*_before.txt`, `long_files.md`, `circular_before.txt`, `skill_inventory.json`
