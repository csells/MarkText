# Candidate Decisions

Run: `review-comments-20260630-231526`

## Applied

| ID | Candidate | Reason | Result |
| --- | --- | --- | --- |
| D1 | Source metadata write path calls Muya helper | Removes duplicated parser-selected metadata-line logic | Applied |
| D2 | Shared reply metadata helper | Removes three manual reply merge implementations | Applied |
| D3 | Remove dead source `commitTimer` | Never assigned; only cleared | Applied |
| D4 | Reuse one source markdown snapshot in add-comment candidate checks | Removes duplicate `cm.getValue()`/ignored-range computation | Applied |
| D5 | Collapse Muya pass-through selection wrappers and redundant inline-code checks | Generic predicate already covers all selected leaves | Applied |
| D6 | Reuse `commentPathKey()` in parse/render paths | Existing helper has identical implementation | Applied |
| D7 | Delete skill metadata pass-through module | Private package façade only re-exported Muya symbols | Applied |

## Rejected Or Deferred

| Candidate | Decision | Reason |
| --- | --- | --- |
| Replace source raw range scanners with `parseMarkdownComments()` | Rejected | CodeMirror needs raw character indexes for selection/focus; parsed paths/offsets are not a drop-in substitute. |
| Replace source metadata edits with full-document `cm.setValue()` | Rejected | Simpler code, but changes undo and selection behavior. The applied refactor keeps targeted line replacement. |
| Extract shared source ignored-context scanner for overlay and source mode | Deferred | Meaningful duplication exists, but stream-mode overlay and whole-document source logic differ enough to require new focused tests first. |
| Extract sidebar edit-box component | Deferred | UI cleanup, not a core format/architecture seam; lower value than parser/helper consolidation in this pass. |
| Localize comments filter label `All` | Deferred | Architecture-alignment issue but not simplification; should be handled with locale coverage separately. |

## Metrics

- Product diff: 14 files, 106 insertions, 211 deletions, net -105 lines.
- Muya lint warnings: baseline 8 warnings; after 7 warnings. The removed warning was `comments/edit.ts` `wrapCommentRange` complexity.
- Root lint warnings: unchanged at 128 warnings, all pre-existing.
