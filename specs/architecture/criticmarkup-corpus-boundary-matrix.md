# CriticMarkup corpus-to-boundary proof matrix

> **Status: legacy implementation proof inventory, not a target contract.**
> This matrix records the pre-rebuild branch described by archived plans
> 0006/0007. Its
> BOM stripping, CRLF normalization, serializer canonicalization, depth-64/128
> limits, literal fallback, and named old-engine suites are historical evidence
> only and are superseded by ADRs 0005–0012 and plan 0009. The replacement is
> plan 0009's checked-in Profile 1 manifests, interaction matrices, resource
> boundary corpus, installed-artifact gates, and deletion ledger. Retain this
> file only as a migration oracle; do not use any row to approve the target
> engine unless plan 0009 explicitly imports it into a new red-green fixture.

Purpose: archived plan
`specs/plans/archive/0006-criticmarkup-production-readiness-closure.md`,
Wave 5, final bullet, requires a checked-in corpus-to-boundary matrix
"covering every shared row", where the file-backed desktop E2E includes a
named minimum set and "every other row names its equivalent parser, state,
static, clipboard, persistence, or artifact proof — no uncited
'representative' set." This document is that matrix. The shared corpus is
`packages/muya/src/criticMarkup/__tests__/sharedCorpus.ts`
(`CRITIC_MARKUP_CORPUS`, 45 rows, plus the derived exports
`FRONT_MATTER_CORPUS`, `FRONT_MATTER_LOOKALIKE_CORPUS`,
`FRONT_MATTER_DISABLED_CORPUS`, `IDENTICAL_SUBSTITUTION_ARM_CORPUS`,
`HOSTILE_CRITIC_MARKUP_CORPUS`, and the 7-entry
`CRITIC_MARKUP_SCALE_CORPUS_LINKS` manifest). Every cell below was verified
against the consuming spec source on branch `feat/native-criticmarkup`; no
cell is aspirational. Rows are cited by corpus `id`; the row number column
matches declaration order in `sharedCorpus.ts`.

## Proof keys

Every matrix cell uses one of these keys. Each key is one spec file plus the
exact suite/test that iterates the corpus.

| Key | Spec file (repo-relative) | Suite › test (corpus binding) |
| --- | --- | --- |
| RT | `packages/muya/src/state/__tests__/criticMarkupRoundTrip.spec.ts` | `criticMarkup state round trip` › `preserves $id through repeated no-op serialization` — `it.each(CRITIC_MARKUP_CORPUS)`, all 45 rows, byte-exact (or declared known normalization) across two serializations |
| PAC | `packages/muya/src/state/__tests__/criticMarkupProductionAdapterCorpus.spec.ts` | `criticMarkup production Markdown-state adapter corpus` › `keeps $id native through its declared serialization contract` — `it.each(SEMANTIC_CORPUS)` = every row with ≥ 1 declared item (41 rows; excludes the four pure front-matter rows), asserts no `markdown-parser-residue`, byte-exact serialization, and declared item type/raw order |
| CP | `packages/muya/src/state/__tests__/criticMarkupConsumerParity.spec.ts` | `criticMarkup cross-consumer parity corpus` › `keeps canonical/live/Review/HTML/clipboard parity for $id` — `it.each(CRITIC_MARKUP_CORPUS)`, all 45 rows: canonical document model, live Muya document, Review snapshot, command items, live DOM / `renderToStaticHTML` / `getClipBoardHtml` item parity, original/revised projections, source-offset bijection, focus/navigation, and individual-vs-bulk accept/reject resolution |
| DOC | `packages/muya/src/state/__tests__/criticMarkupDocument.spec.ts` | `parser-native CriticMarkup document model` › `it.each(FRONT_MATTER_CORPUS)` "keeps $id literal and byte-identical in both projections"; `it.each(FRONT_MATTER_LOOKALIKE_CORPUS)` "does not over-exclude $id"; `it.each(FRONT_MATTER_DISABLED_CORPUS)` "treats $id as ordinary Markdown"; `it.each(IDENTICAL_SUBSTITUTION_ARM_CORPUS)` "maps $id without aliasing repeated source text" |
| HTML | `packages/muya/src/state/__tests__/criticMarkupHtml.spec.ts` | `criticMarkup HTML pipelines` › `it.each(FRONT_MATTER_CORPUS)` "keeps $id non-semantic in static and clipboard HTML"; `it.each(IDENTICAL_SUBSTITUTION_ARM_CORPUS)` "preserves repeated literal link destinations for $id in every HTML adapter" |
| RSNAP | `packages/muya/src/__tests__/criticMarkupReviewSnapshot.spec.ts` | `atomic CriticMarkup Review snapshot` › `it.each(FRONT_MATTER_CORPUS)` "does not surface Review items from $id"; `it.each(FRONT_MATTER_LOOKALIKE_CORPUS)` "surfaces ordinary Markdown changes from $id"; `it.each(FRONT_MATTER_DISABLED_CORPUS)` "surfaces Review items when $id is disabled"; `it.each(IDENTICAL_SUBSTITUTION_ARM_CORPUS)` "exposes one Review item for $id" |
| SEC | `packages/muya/src/state/__tests__/criticMarkupSecurity.spec.ts` | `criticMarkup final HTML sink security` › `keeps $id inert in static and sanitized clipboard HTML` — `it.each(HOSTILE_CRITIC_MARKUP_CORPUS)` (7 rows), plus the suite-level completeness test `covers every semantic Critic form with hostile final-sink input` |
| TBC | `packages/muya/src/clipboard/__tests__/trackBCopy.spec.ts` | `track B — copyAsRich still writes both slots` › `sanitizes $id before writing the rich HTML slot` — `it.each(HOSTILE_CRITIC_MARKUP_CORPUS)` through the real clipboard copy handler |
| E2E-FILE | `packages/desktop/test/e2e/critic-markup-review.spec.ts` | `CriticMarkup file-backed losslessness` › `survives exact source handoff, projected copy, undo/redo, repeated save, and reopen` — the `FILE_CORPUS_ROW_IDS` rows are concatenated into `FILE_LOSSLESS_CORPUS`, written to a real temp file, and driven through open, source-mode handoff, projected copy (Marked/Original/Revised), word count, repeated exact save, reopen, authoring, undo/redo, and targeted sidebar resolution with byte-exact file reads at every step |
| E2E-FILE-ROW | `packages/desktop/test/e2e/critic-markup-review.spec.ts` | `CriticMarkup file-backed corpus rows (plan minimum)` › `$id round-trips real file IO, review enumeration, and reopen` — each `FILE_ROW_CASES` row is written to its OWN real file and driven through open (asserting the documented desktop open normalization: BOM strip + CRLF→LF, byte-exact otherwise), Review-sidebar item enumeration against the row's declared item types, repeated explicit save (with an mtime-advance write proof and byte-exact reads — BOM/CRLF restored by the recorded encoding/line-ending bookkeeping), and reopen; option rows apply their desktop-settable preference profile (`superSubScript`) through the real `mt::set-user-preference` round trip, and hostile rows additionally pass a live-editor inertness scan (no script element, no `on*`/`srcdoc` attribute, no executable URL scheme, no `__criticXss` global) |
| E2E-PDF | `packages/desktop/test/e2e/export-pdf.spec.ts` | `hidden Electron PDF generation — CriticMarkup projections` › `prints all five Critic forms and the Original projection to distinct PDF artifacts` — real `webContents.printToPDF` bytes of the `all-five-canonical-forms` document (`%PDF-` header, `%%EOF` trailer, exactly one `/Type /Page` object, artifact persisted to the Playwright output dir with byte-count parity) under the Marked and Original projections, with DOM-anchored projected-content assertions and a byte-difference check between the two artifacts |
| DSAVE | `packages/desktop/test/unit/specs/flush-before-save.spec.ts` + `packages/desktop/test/unit/specs/critic-markup-autosave.spec.ts` | `editor store — explicit save under CriticMarkup projections` and `editor store — autosave writes canonical CriticMarkup bytes` — FILE_SAVE / FILE_SAVE_AS and LISTEN_FOR_CONTENT_CHANGE → HANDLE_AUTO_SAVE send the canonical `all-five-canonical-forms` bytes byte-exact through `mt::response-file-save(-as)` (with the tab's persistence options untouched) while the Review store holds an active Original/Revised projection |
| DPRINT | `packages/desktop/test/unit/specs/critic-markup-print-security.spec.ts` | `desktop print pipeline — hostile CriticMarkup final-sink security` › `keeps $id inert with Critic semantics intact in the final print document` — `it.each(HOSTILE_CRITIC_MARKUP_CORPUS)` through the desktop `exportStyledHTML` sanitizer entry (final boundary: `sanitizeExportHtml`) into the real print-service container, asserting muya-parity inertness plus surviving `data-critic-*` semantics, and inertness again under the Original/Revised projections |
| FAS | `packages/muya/src/state/__tests__/criticMarkupFinalAdapterScale.spec.ts` | `criticMarkup executable final-adapter scale matrix` › `runs $id through static Marked and live Muya adapters` — `it.each(CRITIC_MARKUP_SCALE_CORPUS_LINKS)`, all 7 scale entries |

Cell markers:

- `—` — boundary intentionally not applicable to the row (stated inline);
  never used where the plan demands coverage.
- `— (gap: …)` — coverage the plan requires (or an untransported byte class)
  that no spec currently provides. Do not cite this document as proof for a
  gap cell.
- `eq:` — the named equivalent proof required by the plan for rows outside
  the file-backed set (see the equivalence rule below).

## File-backed desktop set: plan minimum vs. current state

The plan's Wave 5 final bullet names the minimum file-backed desktop E2E
rows: **all five canonical forms; nested and block-spanning forms; malformed
recovery; BOM+CRLF+astral text; repeated table cells with escaped pipes;
front matter; and hostile cross-block payloads.**

`FILE_CORPUS_ROW_IDS` in
`packages/desktop/test/e2e/critic-markup-review.spec.ts` contains six ids:

1. `all-five-canonical-forms`
2. `mixed-nested-forms`
3. `escaped-opener-and-closer-like-payload`
4. `block-spanning-addition`
5. `inline-fenced-and-indented-code-contexts`
6. `nested-block-spanning-addition-and-deletion`

The `fileCorpusRows` guard still rejects any row whose
`normalization.kind !== 'exact'` or whose `options` object is non-empty —
that constraint is structural for the CONCATENATED document (a BOM or
front-matter row must occupy the exact start of a file, an options row would
change its neighbours' parse, and a malformed dangling opener would capture
`++}` closers from later rows). The plan-minimum rows outside that class are
file-backed one row per real file by the `FILE_ROW_CASES` suite in the same
spec (proof key `E2E-FILE-ROW` above). Two of those rows declare
`superSubScript: true`, which the suite applies through the real
`mt::set-user-preference` round trip; `frontMatter`/`math` have no desktop
preference (the renderer always boots the engine defaults, both enabled) —
that profile matches the front-matter row's declaration, the two option rows
contain neither front-matter-opening nor math-delimiter bytes, and the
declared-options parse proof for every row remains with RT/PAC.

### Gap list — plan-minimum rows and their file-backed proof

| Plan minimum category | Corpus row(s) required | File-backed proof | Blocker | Status |
| --- | --- | --- | --- | --- |
| All five canonical forms | `all-five-canonical-forms` | E2E-FILE | — | Covered |
| Nested forms | `mixed-nested-forms` | E2E-FILE | — | Covered |
| Block-spanning forms | `block-spanning-addition` | E2E-FILE | — | Covered |
| Nested **and** block-spanning combined (reading the plan strictly) | `nested-block-spanning-addition-and-deletion` | E2E-FILE (added to `FILE_CORPUS_ROW_IDS`) + E2E-FILE-ROW | — | Covered |
| Malformed recovery | `malformed-outer-recovers-inner-and-later-items` (representative; rows 6–7 cite it) | E2E-FILE-ROW | — | Covered |
| BOM+CRLF+astral text | `bom-crlf-and-astral-boundaries` | E2E-FILE-ROW — BOM and CRLF now cross real file IO: the desktop open boundary canonicalizes to LF in-editor and the save path restores the source bytes (BOM + CRLF) byte-exact; muya's declared `known` normalization applies to the raw-parser boundary and is fully subsumed by that documented desktop open normalization (the suite guards this equivalence) | — | Covered |
| Repeated table cells with escaped pipes | `repeated-table-cells-and-escaped-pipes` | E2E-FILE-ROW (with the `superSubScript` preference applied) | — | Covered |
| Front matter | `yaml-front-matter` (representative; rows 18–20 cite it) | E2E-FILE-ROW (`frontMatter: true` is the desktop's fixed engine default) | — | Covered |
| Hostile cross-block payloads | `hostile-cross-block-addition` | E2E-FILE-ROW (with the `superSubScript` preference applied), including the live-editor inertness scan | — | Covered |

### Additional byte-class rows outside the named minimum (all closed)

These rows carry byte classes that formerly never crossed real file IO
(the plan's third Wave 5 bullet independently demands "no final newline,
repeated blank lines" byte coverage):

| Corpus row | Untransported byte class | Status |
| --- | --- | --- |
| `identical-substitution-arms-with-literal-link-destinations` | no final newline | Closed — E2E-FILE-ROW (open→save×2→reopen→save, byte-exact without a final newline) |
| `no-final-newline-repeated-blanks-astral-and-identical-text` | no final newline; repeated blank lines | Closed — E2E-FILE-ROW (with the `superSubScript` preference applied) |
| `hostile-addition-html-and-url` | no final newline | Closed — E2E-FILE-ROW, including the live-editor inertness scan |
| `hostile-comment-title` | no final newline | Closed — E2E-FILE-ROW, including the live-editor inertness scan |
| `toml-front-matter`, `semicolon-json-front-matter`, `brace-json-front-matter` | front-matter file transport | Closed — the front-matter transport class now crosses real file IO via row 17 (`yaml-front-matter`, E2E-FILE-ROW); rows 18–20 cite it |

## Equivalence rule for rows outside the file-backed set

Desktop file IO is content-agnostic UTF-8 byte transport plus the
serializer's canonicalization. For a row whose canonical bytes fall in a
class already driven through `E2E-FILE` (ASCII, LF line endings, terminal
newline — the class of all six current `FILE_CORPUS_ROW_IDS` rows, which also cover
backslash escapes, multi-block sources, and protected literal code
contexts), the file boundary adds nothing beyond what RT (byte-exact,
idempotent serialization under the row's own parser options) and CP (full
consumer-surface parity on the same bytes) already prove; such rows cite
`eq: RT+CP; <class> via E2E-FILE`. Rows whose bytes leave that class (BOM,
CRLF, missing final newline, repeated blank lines) or whose file-level risk
is semantic rather than byte transport (front matter handling on the desktop
open path; hostile payload rendering in the real renderer) cannot claim
equivalence and are marked `— (gap)` until the E2E set covers them. The
BOM/CRLF, front-matter, hostile-rendering, missing-final-newline, and
repeated-blank-line classes are all covered by the per-row `E2E-FILE-ROW`
suite; no untransported byte class remains open.

A desktop unit meta-guard pins the corpus wiring itself:
`packages/desktop/test/unit/specs/e2e-background-safety.spec.ts` ›
`e2e background safety` › `drives the hidden file-backed workflow from the
shared executable corpus` asserts the E2E imports `CRITIC_MARKUP_CORPUS`
from `sharedCorpus`.

## Matrix — `CRITIC_MARKUP_CORPUS` (45 rows)

FB set = the six current `FILE_CORPUS_ROW_IDS` rows (see above).

| # | Row id | Tags | Parser/state proof | Round-trip/persistence proof | Consumer-parity proof (live/Review/HTML/clipboard) | Security/sink proof | File-backed desktop proof |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `all-five-canonical-forms` | syntax, canonical, adjacent | PAC | RT, PAC, DSAVE (desktop explicit-save and autosave transport under active projections) | CP | — (not a hostile fixture; sink policy proven over rows 39–45) | E2E-FILE, E2E-PDF (real PDF artifacts under Marked and Original projections) |
| 2 | `empty-forms-and-substitution-arms` | syntax, empty | PAC | RT, PAC | CP | — | — eq: RT+CP; ASCII/LF/final-newline class via FB set |
| 3 | `mixed-nested-forms` | syntax, nested | PAC | RT, PAC | CP | — | E2E-FILE |
| 4 | `same-type-nested-additions` | syntax, nested, same-type | PAC | RT, PAC | CP | — | — eq: RT+CP; nested-form class via FB row `mixed-nested-forms` |
| 5 | `malformed-outer-recovers-inner-and-later-items` | syntax, malformed, recovery | PAC | RT, PAC | CP | — | E2E-FILE-ROW |
| 6 | `multiple-substitution-separators-recover-later-item` | syntax, malformed, recovery | PAC | RT, PAC | CP | — | — eq: RT+CP; ASCII/LF class via FB set; malformed-recovery file representative covered at row 5 (E2E-FILE-ROW) |
| 7 | `dangling-mismatched-zero-and-multiple-separators` | syntax, malformed, recovery, dangling-close, mismatched-close, zero-separator, multiple-separator | PAC | RT, PAC | CP | — | — eq: RT+CP; ASCII/LF class via FB set; malformed-recovery file representative covered at row 5 (E2E-FILE-ROW) |
| 8 | `escaped-opener-and-closer-like-payload` | syntax, escape | PAC | RT, PAC | CP | — | E2E-FILE |
| 9 | `odd-and-even-backslash-runs-at-delimiters` | syntax, escape, odd-even | PAC | RT, PAC | CP | — | — eq: RT+CP; backslash-escape class via FB row `escaped-opener-and-closer-like-payload` |
| 10 | `block-spanning-addition` | syntax, block-spanning | PAC | RT, PAC | CP | — | E2E-FILE |
| 11 | `nested-block-spanning-addition-and-deletion` | syntax, nested, block-spanning | PAC | RT, PAC | CP (incl. declared `resolution` normalization through accept/reject) | — | E2E-FILE (in `FILE_CORPUS_ROW_IDS`), E2E-FILE-ROW |
| 12 | `inline-fenced-and-indented-code-contexts` | context, code, literal-context | PAC | RT, PAC | CP | — | E2E-FILE |
| 13 | `soft-wrapped-inline-code-span` | context, code, soft-wrap, literal-context | PAC | RT, PAC | CP | — | — eq: RT+CP; literal code-context class via FB row `inline-fenced-and-indented-code-contexts` |
| 14 | `fenced-code-inside-blockquote-and-list` | context, code, fence, blockquote, list, literal-context | PAC | RT, PAC | CP | — | — eq: RT+CP; literal code-context class via FB row `inline-fenced-and-indented-code-contexts` |
| 15 | `ordinary-gfm-strike-beside-substitution` | syntax, gfm-strikethrough | PAC | RT, PAC | CP | — | — eq: RT+CP; ASCII/LF class via FB set |
| 16 | `bom-crlf-and-astral-boundaries` | bytes, bom, crlf, astral | PAC | RT, PAC (incl. canonical reparse of the declared `known` normalization) | CP | — | E2E-FILE-ROW (BOM + CRLF cross real file IO: LF-canonical in-editor, source bytes restored on save, byte-idempotent across reopen; astral additionally corroborated by the non-corpus `Astral 😀 tail.` line in FILE_LOSSLESS_CORPUS) |
| 17 | `yaml-front-matter` | front-matter, literal-context | DOC, CP (zero items, declared literal range) | RT | CP, HTML, RSNAP | — | E2E-FILE-ROW (zero Review items enumerated; front matter byte-exact through open/save/reopen) |
| 18 | `toml-front-matter` | front-matter, literal-context | DOC, CP | RT | CP, HTML, RSNAP | — | — eq: RT + DOC/CP; front-matter file-transport class via row 17 (E2E-FILE-ROW) |
| 19 | `semicolon-json-front-matter` | front-matter, literal-context | DOC, CP | RT | CP, HTML, RSNAP | — | — eq: same as row 18 |
| 20 | `brace-json-front-matter` | front-matter, literal-context | DOC, CP | RT | CP, HTML, RSNAP | — | — eq: same as row 18 |
| 21 | `unterminated-yaml-front-matter-looking-prefix` | front-matter-lookalike, recovery | PAC, DOC | RT, PAC (canonical reparse of `known` normalization) | CP, RSNAP | — | — eq: RT+CP; canonical form is ASCII/LF class via FB set |
| 22 | `bare-yaml-front-matter-looking-prefix` | front-matter-lookalike, recovery | PAC, DOC | RT, PAC | CP (incl. declared `resolution`), RSNAP | — | — eq: RT+CP; ASCII/LF class via FB set |
| 23 | `yaml-front-matter-option-disabled` | front-matter-disabled, parser-options | PAC, DOC | RT, PAC (canonical reparse of `known` normalization) | CP, RSNAP | — | — eq: RT+CP; canonical form is ASCII/LF class via FB set; option-profile semantics are parser-level (DOC/RSNAP), not file-level |
| 24 | `identical-substitution-arms-with-literal-link-destinations` | substitution, repeated-text, link-destination | PAC, DOC | RT, PAC | CP, HTML, RSNAP | — | E2E-FILE-ROW (no-final-newline byte class byte-exact across real file IO) |
| 25 | `substitution-new-arm-inline-math-owns-inner-critic-bytes` | substitution, semantic-arm, math, literal-context | PAC | RT, PAC | CP | — | — eq: RT+CP; ASCII/LF class via FB set; math-arm literal ownership is parser-level (PAC/CP) |
| 26 | `additions-construct-inline-math-delimiters` | addition, constructed-context, math | PAC | RT, PAC | CP | — | — eq: RT+CP; ASCII/LF class via FB set |
| 27 | `three-root-additions-construct-inline-math` | addition, constructed-context, math, adjacent | PAC | RT, PAC | CP | — | — eq: RT+CP; ASCII/LF class via FB set |
| 28 | `comment-arm-inline-code-owns-inner-critic-bytes` | comment, semantic-arm, code, literal-context | PAC | RT, PAC | CP | — | — eq: RT+CP; literal code-context class via FB row `inline-fenced-and-indented-code-contexts` |
| 29 | `headings-emphasis-and-line-breaks` | context, heading, emphasis, line-break | PAC | RT, PAC | CP (incl. declared `resolution` normalization) | — | — eq: RT+CP; ASCII/LF multi-block class via FB rows `block-spanning-addition` + `all-five-canonical-forms` |
| 30 | `links-images-autolinks-and-reference-definitions` | context, link, image, autolink, reference-definition, literal-context | PAC | RT, PAC | CP (incl. declared plain-text image-alt items) | — | — eq: RT+CP; ASCII/LF class via FB set; literal destination/title protection is parser-level (PAC/CP), corroborated by the non-corpus literal-URL line in FILE_LOSSLESS_CORPUS |
| 31 | `repeated-identical-link-labels-and-image-alternatives` | context, link, image, image-alt, repeated-text, plain-text-owner | PAC | RT, PAC | CP (plain-text owner identity per declared ranges) | — | — eq: RT+CP; ASCII/LF class via FB set |
| 32 | `inline-and-all-raw-html-block-classes` | context, html, literal-context | PAC | RT, PAC | CP | — (literal-context row; hostile HTML sink policy proven by SEC rows 39–45) | — eq: RT+CP; ASCII/LF class via FB set; raw-HTML literal exclusion is parser-level (PAC/CP) |
| 33 | `active-inline-block-gitlab-math-and-diagram-contexts` | context, math, gitlab, diagram, literal-context | PAC | RT, PAC | CP | — | — eq: RT+CP; ASCII/LF class via FB set |
| 34 | `math-option-disabled-makes-dollar-content-semantic` | context, math-disabled, parser-options | PAC | RT, PAC | CP | — | — eq: RT+CP; ASCII/LF class via FB set; option-profile semantics are parser-level |
| 35 | `nested-tight-loose-list-blockquote-lazy-and-tab-contexts` | context, list, blockquote, lazy-continuation, tab, literal-context | PAC | RT, PAC (canonical reparse of `known` tab/list normalization; RT proves idempotence) | CP | — | — eq: RT+CP; canonical form is ASCII/LF class via FB set (tab bytes exist only pre-canonicalization, and RT proves the canonical form is stable) |
| 36 | `repeated-table-cells-and-escaped-pipes` | context, table, repeated-text, escaped-pipe | PAC | RT, PAC | CP | — | E2E-FILE-ROW (with the `superSubScript` preference applied through the real preference round trip) |
| 37 | `footnote-body-nested-list-and-definition-contexts` | context, footnote, nested-list, reference-definition, literal-context | PAC | RT, PAC | CP | — | — eq: RT+CP; ASCII/LF class via FB set; footnote option profile is parser-level |
| 38 | `no-final-newline-repeated-blanks-astral-and-identical-text` | bytes, no-final-newline, repeated-blanks, astral, repeated-text | PAC | RT, PAC | CP | — | E2E-FILE-ROW (no-final-newline and repeated-blank-line byte classes byte-exact across real file IO, with the `superSubScript` preference applied; astral additionally corroborated by row 16) |
| 39 | `hostile-addition-html-and-url` | hostile, addition, security | PAC | RT, PAC | CP | SEC, TBC, DPRINT | E2E-FILE-ROW (no-final-newline byte class byte-exact across real file IO, including the live-editor inertness scan) |
| 40 | `hostile-comment-title` | hostile, comment, security | PAC | RT, PAC | CP | SEC, TBC, DPRINT | E2E-FILE-ROW (same coverage as row 39) |
| 41 | `hostile-deletion-html-events-script-and-url` | hostile, deletion, security | PAC | RT, PAC | CP | SEC, TBC, DPRINT | — eq: sink inertness proven on exact bytes by SEC+TBC+DPRINT; ASCII/LF transport class via FB set; real-app hostile-file rendering representative covered at row 45 (E2E-FILE-ROW) |
| 42 | `hostile-substitution-both-arms` | hostile, substitution, security | PAC | RT, PAC | CP | SEC, TBC, DPRINT | — eq: same as row 41 |
| 43 | `hostile-highlight-markdown-image-fields` | hostile, highlight, image, security | PAC | RT, PAC | CP | SEC, TBC, DPRINT | — eq: same as row 41 |
| 44 | `hostile-highlight-quote-breaking-attributes` | hostile, highlight, attribute, security | PAC | RT, PAC | CP | SEC, TBC, DPRINT | — eq: same as row 41 |
| 45 | `hostile-cross-block-addition` | hostile, addition, block-spanning, security | PAC | RT, PAC | CP | SEC, TBC, DPRINT | E2E-FILE-ROW (with the `superSubScript` preference applied; includes the live-editor inertness scan) |

Notes on non-corpus corroboration: `FILE_LOSSLESS_CORPUS` in the desktop E2E
appends extra lines beyond the six corpus rows (an inline five-form
paragraph, an adjacent `{==focus==}{>>note<<}` pair, a `reviewable` token
for menu authoring, a literal code span plus literal-URL link, and an astral
tail). These strengthen the file-backed workflow but are not corpus rows and
are never credited as corpus coverage above.

`packages/muya/src/criticMarkup/__tests__/compatibilityCorpus.spec.ts` pins
the five canonical projections and several recovery behaviors with inline
fixtures; it does not consume `sharedCorpus.ts`, so it is deliberately not
cited in any cell.

## Matrix — `CRITIC_MARKUP_SCALE_CORPUS_LINKS` (7 entries)

Scale fixtures are generated inside their dedicated specs (the shared data
module must not allocate multi-megabyte sources); the manifest in
`sharedCorpus.ts` is the explicit bridge. Every entry additionally runs
through FAS (`runs $id through static Marked and live Muya adapters`), which
regenerates the declared shape, renders static HTML, boots live Muya, and
asserts item counts, byte-exact `getMarkdown`, and the declared
depth/diagnostic behavior.

| # | Entry id | Axis | Declared shape | Dedicated proof (verified) | Shared adapter proof |
| --- | --- | --- | --- | --- | --- |
| S1 | `ordinary-no-opener-4096-lines` | long-no-opener | 4,096 ordinary Markdown/JSON/link lines | `packages/muya/src/criticMarkup/__tests__/resourceScaleContracts.spec.ts` › `criticMarkup grammar-owned no-opener fast path` › `skips Markdown context analysis for a large ordinary document` (`.repeat(4_096)`) | FAS |
| S2 | `malformed-opener-run-16000` | long-malformed | 16,000 incomplete addition openers | `packages/muya/src/criticMarkup/__tests__/parser.spec.ts` › `criticMarkup grammar` › `does not rescan the remaining suffix for every malformed opener` (`'{++x '.repeat(16_000)`) | FAS |
| S3 | `deep-balanced-additions-12000` | above-budget-depth | 12,000 nested balanced additions | `packages/muya/src/criticMarkup/__tests__/deepNesting.spec.ts` › `criticMarkup deep-nesting resource contract` › `scans and projects 12,000 balanced levels without recursive stack use` and `flattens and addresses 12,000 document levels without recursive stack use` (`DEEP_NESTING = 12_000`) | FAS (also asserts the 64-item render cap and `critic-markup-render-depth-limit` marker) |
| S4 | `deep-context-additions-1024` | below-budget-depth | 1,024 nested balanced additions | `packages/muya/src/criticMarkup/__tests__/resourceScaleContracts.spec.ts` › `criticMarkup final-adapter structural scale` › `bounds Markdown context parsing independently of semantic depth` (`depth = 1_024`) | FAS |
| S5 | `native-markdown-nesting-5000` | above-budget-markdown-depth | 5,000 nested native blockquotes around one addition | `packages/muya/src/state/__tests__/criticMarkupFinalAdapterScale.spec.ts` — the FAS test itself carries this entry's dedicated assertions (`data-markdown-diagnostic="marked-block-nesting-limit"` in both static HTML and live DOM) | FAS |
| S6 | `wide-adjacent-additions-257` | wide-dense-items | 257 adjacent mapped additions | `packages/muya/src/criticMarkup/__tests__/resourceScaleContracts.spec.ts` › `criticMarkup final-adapter structural scale` › `indexes mapped spans once instead of rescanning all spans per item` (`itemCount = 257`) | FAS |
| S7 | `exclusion-heavy-prefix-1024` | many-excluded-ranges | 1,024 disjoint exclusions before one valid addition | `packages/muya/src/criticMarkup/__tests__/resourceScaleContracts.spec.ts` › `criticMarkup final-adapter structural scale` › `uses a forward exclusion cursor during a sequential grammar scan` (1,024-entry exclusion set) | FAS |

## Maintenance

- Adding a corpus row: RT and CP pick it up automatically (`it.each` over the
  full corpus); PAC picks it up if it declares at least one item. Add a
  matrix row here in the same change, decide its file-backed cell (FB,
  `eq:`, or `— (gap)`), and extend `FILE_CORPUS_ROW_IDS` (canonical-form,
  default-option rows only) or `FILE_ROW_CASE_DEFS` (per-row files: BOM/
  front-matter/options/malformed rows) if it introduces a new byte class or
  falls in a plan-minimum category.
- Closing a file-backed gap: extend `FILE_CORPUS_ROW_IDS` when the row is
  byte-canonical under default options, otherwise add a `FILE_ROW_CASE_DEFS`
  entry (its guard only admits `known` normalizations that the desktop open
  boundary — BOM strip + CRLF→LF — fully subsumes); then flip the row's
  Status in the gap tables above and replace its `— (gap: …)` cell with
  `E2E-FILE` / `E2E-FILE-ROW`.
- The derived-corpus membership used by DOC/HTML/RSNAP/SEC/TBC is tag-driven
  (`front-matter`, `front-matter-lookalike`, `front-matter-disabled`,
  `repeated-text`+`link-destination`, `hostile`); retagging a row silently
  changes which suites bind it — re-verify this matrix when tags change.
