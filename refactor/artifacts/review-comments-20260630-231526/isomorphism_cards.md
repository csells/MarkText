# Isomorphism Cards

Run: `review-comments-20260630-231526`

## D1: Source Mode Uses Muya Metadata Replacement

- Files: `packages/desktop/src/renderer/src/components/editorWithTabs/sourceCode.vue`, `packages/muya/src/index.ts`, `packages/desktop/src/types/muya-core.d.ts`.
- Before: source mode scanned CodeMirror lines, ignored ranges, decoded metadata, rebuilt the metadata data URI, and chose the target line independently.
- After: source mode calls `updateCommentMetadataInMarkdown()` from Muya, then applies the single changed metadata line through `cm.replaceRange()`.
- Equivalence axes:
  - Same success/failure shape: returns `false` when no live parser-selected metadata definition is available.
  - Same undo shape: still one CodeMirror `replaceRange()` of the metadata line, not a whole-document `setValue()`.
  - Stronger parser alignment: the live metadata definition is now selected by Muya's parser/serializer semantics.
  - Byte behavior: unrelated lines, line endings, BOM handling, and target-line trailing spaces are preserved by the Muya helper and single-line replacement.
- Tests: desktop source harness, Muya comment API tests, full desktop unit suite, full Muya suite.

## D2: Shared Reply Metadata Helper

- Files: `packages/muya/src/comments/edit.ts`, `packages/muya/src/muya.ts`, `packages/desktop/src/renderer/src/components/editorWithTabs/sourceCode.vue`, `skills/markdown-comments/src/edit.ts`.
- Before: Muya, source mode, and the skill each constructed reply metadata patches manually.
- After: `appendCommentReplyMetadata(metadata, reply)` owns the author-list/update-time/replies merge.
- Equivalence axes:
  - Preserves created-at fallback to `new Date().toISOString()` when the caller does not provide `createdAt`.
  - Preserves unique author append behavior.
  - Preserves `mergeCommentMetadataPatch()` normalization.
  - Aligns the skill with Muya/desktop for empty author-list normalization.
- Tests: Muya reply tests, skill reply tests, desktop source harness, full desktop unit suite.

## D3: Dead Source Commit Timer Removal

- File: `packages/desktop/src/renderer/src/components/editorWithTabs/sourceCode.vue`.
- Before: `commitTimer` was declared and cleared in two places but was never assigned.
- After: declaration and clears removed.
- Equivalence axes:
  - Reference scan found no assignment sites.
  - Removing `clearTimeout(null)`-guarded code has no observable side effect.
- Tests: desktop source harness, full desktop unit suite.

## D4: Source Candidate Uses One Markdown Snapshot

- File: `packages/desktop/src/renderer/src/components/editorWithTabs/sourceCode.vue`.
- Before: source add-comment candidate checks re-read `cm.getValue()` through two wrappers and again when building the simulated comment markdown.
- After: `getSourceCommentCandidate()` takes one markdown snapshot, computes ignored ranges once, reuses those ranges for syntax checks, and passes the snapshot into `sourceCommentMarkdown()`.
- Equivalence axes:
  - Same range predicates and same `parseMarkdownComments()` validation.
  - Fewer CodeMirror reads during one candidate decision.
  - More internally consistent if the editor value changes between helper calls.
- Tests: desktop source harness, full desktop unit suite.

## D5: Muya Cross-Leaf Predicate Consolidation

- File: `packages/muya/src/comments/edit.ts`.
- Before: two pass-through wrappers called `selectionIntersectsAcrossLeaves()` with fixed predicates, and `wrapCommentRange()` repeated inline-code checks already covered by the cross-leaf predicate.
- After: `wrapCommentRange()` calls `selectionIntersectsAcrossLeaves()` directly for inline code and comment markers; redundant inline-code checks removed.
- Equivalence axes:
  - Single-leaf and multi-leaf selections are both covered by the same cross-leaf predicate with the same start/end offsets.
  - Non-commentable state checks remain unchanged.
  - Comment-marker intersection checks remain unchanged.
- Tests: Muya comment add/reject tests, full Muya suite.

## D6: Shared Path-Key Helper

- Files: `packages/muya/src/comments/parse.ts`, `packages/muya/src/inlineRenderer/index.ts`.
- Before: parse and renderer code had local `JSON.stringify(path)` helpers/methods.
- After: both use `commentPathKey()` from `packages/muya/src/comments/range.ts`.
- Equivalence axes:
  - The shared helper is the same implementation: `JSON.stringify(path)`.
  - Only key construction changed; map contents and lookup order remain unchanged.
- Tests: Muya parse/render comment specs, full Muya suite.

## D7: Remove Skill Metadata Façade

- Files: `skills/markdown-comments/src/metadata.ts`, skill source/tests.
- Before: `src/metadata.ts` only re-exported symbols from `packages/muya/src/comments`.
- After: skill imports Muya comment helpers directly, matching existing `parse.ts`.
- Equivalence axes:
  - No runtime wrapper logic existed.
  - Import graph is shorter and keeps Muya as the only metadata source.
- Tests: skill test suite.
