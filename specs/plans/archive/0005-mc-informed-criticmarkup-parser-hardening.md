# 0005 — MC-Informed CriticMarkup Parser Hardening

**Status:** Superseded on 2026-07-13 by
[`0006-criticmarkup-production-readiness-closure.md`](0006-criticmarkup-production-readiness-closure.md)
**Created:** 2026-07-11  
**Branch:** `feat/native-criticmarkup`  
**Evidence branch:** `markupdown-inline-comments` at
`2b53d30f859f7ab3738f7ae98593b29045cfb66b` (merge base
`25caabad3b48b253b2d4bff90ae4d20ad5c66598`)

## Outcome

> Historical plan. All unfinished obligations were transferred to plan 0006;
> the MC-derived findings and evidence below remain a hardening record, not an
> active execution queue.

Apply the durable parser-hardening lessons from the mature `MC` implementation
to native CriticMarkup without transplanting MC's proprietary format or runtime
representation.

The finished CriticMarkup implementation has one Markdown-context authority,
one immutable source-semantic analysis with checked mapped document views, one
source-coordinate algebra, and one mutation gateway. Every parser-facing
consumer agrees on which items exist and what their ranges and projections
mean. Valid, malformed, literal-context, Unicode, and large/adversarial
documents are lossless, bounded, and proven through the real application.

This is a focused hardening companion to:

- [`0003-native-criticmarkup-integration.md`](0003-native-criticmarkup-integration.md),
  which owned product completeness; and
- [`0004-thermonuclear-criticmarkup-remediation.md`](0004-thermonuclear-criticmarkup-remediation.md),
  which owned the architectural consolidation and wider code-quality program.

It is not a competing architecture. Work that satisfies both plans should be
implemented once and checked against both exit bars. Plan 0005 adds the
MC-derived acceptance corpus, concrete parser defects, dependency contracts,
resource limits, and losslessness obligations that plan 0004 does not yet
state explicitly.

## Audit boundary and concurrent-work note

The comparison covered the complete `markupdown-inline-comments` history and
tip, the complete current CriticMarkup working tree, the current architecture
spec, and active plans 0003/0004. The MC branch contains 178 commits after its
merge base; the relevant lesson is its hardening trajectory, not its final
syntax.

The current working tree changed concurrently during this read-only audit.
Plan 0004 began landing red architecture/range tests and then a branded
`ExcludedRanges` implementation while the comparison was in progress. The
latest observed direction is correct: the Critic grammar is becoming
Markdown-agnostic and the Markdown adapter supplies validated opaque ranges.
That work was still transiently red while callers and tests were moving, so
this plan treats it as **in progress, not complete**, and does not prescribe a
rollback to the old code-span/fence scanner.

Except for this plan file, this audit made no working-tree changes and checked
out no branch.

## What the MC branch actually taught us

MC did not become robust by accumulating more guards. It became robust by
deleting parallel interpretations and making one layer authoritative.

| Lesson | Failure that forced it | Mature MC evidence | CriticMarkup application |
| --- | --- | --- | --- |
| Recognize syntax in the parser with explicit precedence | Generic Marked reference definitions case-folded/deduplicated MC metadata and silently dropped user bytes | `6123c61d`; `packages/muya/src/utils/marked/extensions/commentMetadata.ts` on the evidence branch | Keep CriticMarkup parser-native and pin precedence against GFM `~~`; do not add post-parse regex repair |
| Derive context from the real Markdown token stream | Flat scanners misclassified loose-list continuations, blockquoted fences, nested definitions, and multiline code spans | `7f7bd871`, `f82fe345`; `parserConsistency.spec.ts` | One AST adapter owns all excluded ranges and parser options; every consumer uses its result |
| One grammar and one semantics owner | Analyzer/model forks disagreed on duplicate opens and diagnostic detail | `08a139bb`; `parseMarkdownComments = commentModelView(extractCommentModel(...))` | One immutable source-neutral `CriticMarkupAnalysis` owns parser semantics; mapped `CriticMarkupDocument<Path>` views, renderers, projections, commands, and review state adapt it |
| Enforce dependency direction mechanically | A post-hoc parser repair imported analysis back into parsing, creating a cycle and mutual-recursion risk | `6123c61d`, `6f59bb70`; transitive import-graph test | Grammar stays framework-free; parser adapters may depend on it, while base parsing cannot reach UI/analysis layers |
| Preserve bytes that are not confidently understood | Regex repairs and generic token lowering reordered, duplicated, or destroyed malformed/duplicate source | `767aa4b8`, `08a139bb`; residue/round-trip corpus | Incomplete and invalid CriticMarkup stays literal and byte-preserved; diagnostics may annotate it but never rewrite it |
| Centralize edits at the operation choke point | Per-surface marker guards missed paste, IME, tables, splits, and other mutation paths | `2a0fd669`, `0bca1abf`; OT-anchor runtime and real Enter-op tests | Keep CriticMarkup in-band, but capture exact JSON/OT intents once and apply one prepared semantic transaction |
| Treat coordinate and boundary policy as architecture | Hidden-marker arithmetic drifted across selection, highlights, search, copy, and source mode | `6a7d138e`, `543cb982`; astral and one-pass materialization tests | Carry branded mapped source positions end to end; define half-open boundary affinity once |
| Performance is correctness | Ordinary no-MC files paid full parse cost; long word runs froze the inline lexer | `1de10779`, `a48e7b15`; `parsePerf.spec.ts`, `lexerPerf.spec.ts` | Sound no-syntax fast path, revision cache, indexed model, and scaling/resource tests on the final pipeline |

The intermediate MC attempt to share helper functions between multiple
handwritten block scanners (`0967cf46`, `1cd26f60`) is a negative lesson. Two
heuristic grammars do not become authoritative merely because they share
utilities.

## Validated current findings

These are fresh findings against the current work, not hypothetical items
copied from the MC history.

| ID | Priority | Finding | Evidence and failure | Required closure |
| --- | --- | --- | --- | --- |
| MH-01 | P0 | Valid front matter is not excluded from Critic parsing | `lexBlock` emits `frontmatter`, but `criticMarkupContext.ts` omits it from `LITERAL_TOKEN_TYPES`. The live document model can therefore surface Critic-looking YAML/TOML/JSON while export code, which removes front matter first, does not. No current Critic test covers front matter. | YAML, TOML, semicolon-JSON, and brace-JSON front matter produce zero Critic items and remain byte-identical in all projections. A bare/unterminated `---` remains ordinary Markdown so the fix does not over-exclude. |
| MH-02 | P0 | Identical substitution arms can corrupt literal link destinations during projection | `visitCriticMarkupToken` locates old/new/projected child arrays independently against the whole token view. For `{~~[x](u{++v++})~>[x](u{++v++})~~}`, revised `getHighlightHtml` was reproduced as a link to `uv` instead of the literal `u{++v++}`. | Context is derived once from a Critic-disabled parser/document view; repeated arm text cannot alias the first occurrence. A regression test proves both projection directions and all adapters. |
| MH-03 | P0 | Leaf-local and block-spanning items still use competing token/render pipelines | Live Muya has `tryCriticMarkup` and `tryCriticMarkupDocumentFragment`; Marked has `criticMarkupExtension` and `criticMarkupDocumentExtension`; both stacks implement offset shifting and literal classification. Leaf and spanning DOM contracts already differ in ID/role attributes. | One all-fragments document pipeline for every item; legacy token/renderer/Marked families and local offset shifters are absent. This is already TN-01/TN-06 in plan 0004. |
| MH-04 | P0 | Excluded ranges previously admitted hangs and context leaks | Raw ranges were unvalidated and could be empty, reversed, overlapping, or tied to the wrong source revision. | Finish the in-progress `ExcludedRanges` migration: bounds and source length validated, empties dropped, overlap merged, every skip strictly forward, and no raw range array crosses the scanner boundary. This is already TN-05 in plan 0004. |
| MH-05 | P0/P1 | Source-map boundaries can map to the wrong side of generated Markdown | Legacy `sourceOffsetAt`/`localPositionAt` treat half-open ends as inclusive and return the first matching piece. At a shared local boundary separated by a generated quote/list/table prefix, the caret can map before structural syntax instead of into the next identity span. Cross-block authoring consumes these offsets. | Carry the new mapped-source abstraction through `CriticMarkupDocument`; delete legacy lookup/validation. Pin next-span-first/half-open policy and explicit affinity at every gap/boundary. This extends TN-07 in plan 0004. |
| MH-06 | P1 | Supported nesting can crash downstream consumers | A 12,000-deep balanced addition scans iteratively but reproduced `Maximum call stack size exceeded` during revised projection. Other recursive consumers include document flattening, item lookup, Track Changes flattening, offset shifting, and renderer/plain-text walks. | Make downstream traversals iterative, or define a documented resource budget that preserves excess bytes literally and reports a nonblocking diagnostic. Never crash, truncate, or silently drop nested source. |
| MH-07 | P1 | Authoring eligibility does not consume the parser's full literal-context truth | `hasProhibitedAuthoringContext` checks inline code and existing Critic tokens, not every excluded Markdown range. A selection in a link destination, math, HTML attribute, definition, or similar context can be wrapped even though the canonical document parser will ignore the result. | All authoring commands ask the canonical document/exclusion model. Every literal context is in the command matrix and fails closed with no mutation/history/event. |
| MH-08 | P1 | Track Changes validates the proposed source without proposed-source Markdown context | The survival check reparses `after` with the syntax scanner alone. Once the grammar correctly stopped hand-parsing Markdown code spans, delimiter-like bytes in new code/link/math context could be misclassified or rejected. | Build or translate both before and after parser documents, then prove `Original=before` and `Revised=after`; do not validate by token type/start/end alone. |
| MH-09 | P1 | Round-trip coverage is much narrower than parser/render coverage | `criticMarkupRoundTrip.spec.ts` has three focused cases, while the system supports nesting, malformed recovery, container mapping, block-spanning items, projections, clipboard, and source-mode handoff. | Shared losslessness corpus covers all syntax/context/byte axes below, repeated saves, source handoff, and real save/reopen. Only pre-existing documented MarkText serializer normalizations are allowed. |
| MH-10 | P1 | Consumer parity is not a permanent invariant | Current tests cover many scenarios in separate suites, but do not require the live document model, Marked/static renderer, clipboard, commands, and projection transforms to identify the same item set/ranges under the same parser options. MC shipped real drift until such parity tests existed. | One table-driven corpus asserts the same semantic roots, source ranges, literal ranges, projections, and item order at every adapter boundary. |
| MH-11 | P1/P2 | Projection sinks need a complete semantic and security policy | Static HTML is fairly well covered, but normal copy/search behavior in Marked view is not settled, and malicious Critic payloads are not exercised end to end. | Decide raw-source versus visible-text behavior per sink; test static/styled HTML, PDF, print, normal/rich/Markdown copy, search, cut, and paste in all projections. Add hostile HTML/URL/attribute/title payloads and prove sanitizer preservation plus no execution. |
| MH-12 | P2 | Final-pipeline performance is unproven | Revision caching and two focused structural performance tests exist, but the final document adapter has no no-Critic fast-path/scale contract; item/path queries repeatedly scan arrays; per-code-unit maps and per-character binary range lookup can dominate large documents. | Grammar-owned opener prefilter, one parse per revision, indexed items/fragments, forward exclusion cursor, and scale tests for ordinary, dense, malformed, deeply nested, and exclusion-heavy documents. |

## Explicitly already owned by plan 0004

Do not create parallel work for these items:

- TN-01/TN-06: one all-fragments semantic pipeline and one Markdown AST
  context owner;
- TN-05: validated excluded ranges and guaranteed scanner progress;
- TN-07: branded mapped text/source positions;
- TN-02/TN-03/TN-04: exact operation capture, one prepared commit, and one
  Direct/Tracked/ReadOnly mutation sink; and
- the existing architecture fitness tests and size ceilings.

Plan 0005 strengthens their acceptance criteria with MH-01 through MH-12 and
the shared corpora below. If an implementation choice in plan 0004 would make
those parity/losslessness assertions impossible, stop and correct the common
owner rather than adding a consumer exception.

## Shared executable corpus

Create one data-only CriticMarkup corpus imported by boundary-specific tests.
Do not copy fixtures between suites. Each row declares source, parser options,
expected semantic items/ranges, literal spans, original/revised output, and
whether byte normalization is allowed.

### Syntax axis

- all five canonical forms;
- empty forms and empty substitution arms;
- adjacent forms, especially `{==text==}{>>note<<}`;
- same-type and mixed nesting;
- identical old/new substitution arms;
- escaped openers, closers, separators, and odd/even backslash runs;
- incomplete openers, dangling/mismatched closes, zero/multiple substitution
  separators, malformed outer plus valid inner, and valid later recovery;
- soft-line and block-spanning forms, including nested block-spanning forms;
- delimiter-like content inside payload Markdown; and
- ordinary GFM strikethrough beside Critic substitution.

### Markdown-context axis

- plain paragraphs, headings, setext headings, emphasis/strong, and soft/hard
  line breaks;
- inline code on one line and across a soft-wrapped paragraph;
- fenced and indented code, including fences inside blockquotes/lists;
- inline/block math, diagrams, and enabled/disabled extension options;
- all raw-HTML block classes plus inline HTML tags/attributes;
- link/image visible text, destinations, titles, autolinks, reference links,
  and reference definitions;
- tight/loose/nested lists, tabs, lazy continuations, blockquotes, and
  combinations of those containers;
- tables with repeated cell text and escaped pipes;
- footnotes and nested definitions; and
- valid YAML/TOML/semicolon-JSON/brace-JSON front matter plus bare and
  unterminated front-matter-looking prefixes.

### Byte and scale axis

- LF and CRLF, BOM, no final newline, and repeated blank lines;
- astral characters before, inside, and after every marker boundary;
- repeated identical text and repeated identical substitution arms;
- long prose/JSON/LaTeX/log lines containing braces and delimiter characters
  but no Critic opener;
- dense adjacent items and many excluded ranges;
- long malformed-opener runs; and
- deep and wide nesting at, below, and above the supported resource budget.

### Assertions at each boundary

For every applicable corpus row, assert:

1. the canonical document model's item type, raw slice, parent/depth, range,
   fragment paths, and document order;
2. exact agreement from live Muya, Marked/static HTML, clipboard parsing,
   Review snapshots, and command targeting;
3. original/revised projection laws and per-item/bulk resolution equivalence;
4. no-op load/serialize byte preservation, or the one explicitly named
   pre-existing serializer normalization;
5. source↔local round trips at every character and structural boundary;
6. no mutation/history/event when authoring or editing is rejected; and
7. bounded work with no crash, hang, quadratic suffix allocation, or silent
   truncation.

## Execution plan

Every implementation wave is red-green. Record the failing assertion before
production changes. Run only the narrowest relevant checks while concurrent
plan-0004 work is active; the root agent owns full sequential gates.

### Wave 0 — Stabilize the in-progress grammar boundary and close P0 defects

- [ ] Let the concurrent `ExcludedRanges`/Markdown-agnostic grammar change
  reach a stable tree, then rerun its focused unit, type, lint, and import
  checks. Record any remaining red tests rather than papering over them.
- [ ] Move old direct-parser code-span/fence expectations to the Markdown
  adapter corpus. Do not restore Markdown parsing inside the grammar merely to
  keep an obsolete test green.
- [x] Add MH-01 front-matter red tests across canonical document parsing,
  projections, live Review items, static rendering, and clipboard.
- [x] Add the MH-02 repeated-substitution-arm regression using literal link
  destinations in both arms and both projections.
- [ ] Keep the architecture tests red for the competing token/render families
  until Wave 2 deletes them.

**Gate:** validated ranges are the only scanner input; no front-matter item
leaks; the repeated-arm fixture preserves literal bytes; grammar-only and
Markdown-aware API contracts are unambiguous.

**Evidence (2026-07-11):** The shared corpus's four valid front-matter rows
failed in both the canonical document and live Review adapters (8 failures;
each leaked one addition). Classifying the parser's `frontmatter` token as
literal made the canonical, live Review, both projection, static HTML, and
clipboard checks green (3 files / 48 tests). Bare and unterminated prefixes and
`frontMatter: false` remain ordinary Markdown (2 files / 22 tests). The exact
identical-arm MH-02 fixture was already green after the plan-0004 one-document
pipeline: both arms preserve `u{++v++}` through canonical projections, Review,
static HTML, and clipboard; the dormant Critic-enabled context traversal still
must be deleted under Wave 1.

### Wave 1 — Establish one corpus and parser-context authority

- [ ] Add the shared data-only corpus above and adapters that expose comparable
  semantic summaries without normalizing away differences.
- [ ] Make the one Markdown AST adapter classify every literal context,
  including active extension options. It must consume the actual parser token
  stream, not a line approximation.
- [x] Delete or quarantine every second literal classifier as consumers migrate.
- [x] Add a transitive import-graph fitness test modeled on MC commit
  `6f59bb70`: grammar/domain code cannot reach Marked/UI/Electron; base Markdown
  parsing cannot reach Critic command/render layers.
- [x] Add a production delimiter-owner census: no Critic delimiter string or
  recognizer exists outside the grammar owner.

**Gate:** all parser-facing consumers agree on the corpus, parser options flow
end to end, and impossible source alignment throws with context instead of
guessing.

**Evidence (2026-07-11):** The architecture/affinity tranche was observed red
with 8 failures: the implicit leaf-local document builder, renderer dependency
from base parsing, non-grammar delimiter recognizers, and five ambiguous mapped
boundaries. The leaf-local classifier/fallback is deleted; syntax-only callers
explicitly disable Critic parsing; base parsing no longer imports the
renderer-bearing extension; delimiter recognition/escape normalization is
grammar-owned; and the transitive graph/census are AST-backed permanent tests.
The tranche is green at 2 files / 10 tests.

### Wave 2 — Finish plan 0004's one-model pipeline

- [ ] Make one `CriticMarkupAnalysis` materialize semantic roots once per source
  revision (reusing the provisional scan when normalized exclusions are
  unchanged, otherwise performing one required final scan), then let mapped
  `CriticMarkupDocument<Path>` views index every item/fragment and supply
  fragments for leaf-local and block-spanning items alike.
- [ ] Make live Muya and Marked render adapters consume that same fragment
  model and expose one stable DOM/token contract regardless of block span.
- [x] Delete the legacy leaf-local token family, renderer family, inline Marked
  extension, `WeakMap` call-order scan state, duplicate offset shifters, and
  duplicate export orchestration.
- [x] Fix MH-02 structurally by deriving Markdown context from a Critic-disabled
  AST once, not by locating each projected arm back into a Critic-tokenized raw
  view.
- [ ] Preserve the revision cache while replacing its internals; add indexes by
  item ID, path, parent, and source interval.

**Gate:** plan 0004's TN-01/TN-06 fitness checks pass, one document parse serves
every adapter, and leaf/spanning items have identical semantics and attributes.

### Wave 3 — Carry mapped source positions end to end

- [ ] Complete TN-07: the serializer emits one immutable mapped document using
  branded state-path, parser-path, local-offset, and source-offset types.
- [x] Keep that mapping object inside `CriticMarkupDocument`; do not convert it
  back to legacy unbranded pieces and reimplement validation/lookup.
- [x] Define half-open boundary and affinity rules for adjacent pieces,
  generated prefixes, marker edges, substitution separators, block boundaries,
  and empty spans. Use next-span-first semantics unless an explicitly named
  editing operation requires another affinity.
- [x] Add source↔local round-trip/property tests over containers, tables,
  escapes, structural gaps, CRLF, and astral text.
- [ ] Compose all source edits in one coordinate space and apply them once in
  descending order. Two independent passes must never splice the same source
  offsets.

**Gate:** MH-05 is closed; mapping errors cannot compile across brands; every
corpus boundary maps deterministically and untouched bytes remain untouched.

### Wave 4 — Bound malformed, nested, and large inputs

- [ ] Turn malformed behavior into a closed decision table and test exact raw
  preservation plus completed-item recovery at every consumer.
- [ ] Prefer iterative traversal for nested item projection, flattening,
  lookup, rendering, and Track Changes so documented nesting semantics do not
  change merely to avoid a stack overflow.
- [ ] If a resource ceiling is still needed, specify it in
  `specs/architecture/criticmarkup.md`, preserve over-budget source literally,
  and surface a nonblocking diagnostic. Never silently truncate.
- [ ] Add a grammar-owned sound no-opener fast path before Markdown context
  analysis and document construction.
- [ ] Add structural and scale-ratio tests on the final adapter for ordinary,
  dense, malformed, exclusion-heavy, deep, and wide inputs. Prefer allocation/
  call-count invariants where timing would be flaky.
- [ ] Use a forward exclusion cursor during sequential scans if measurement
  confirms per-character binary lookup is material.

**Gate:** MH-06/MH-12 are closed; arbitrary untrusted Markdown cannot hang or
overflow within the declared contract; ordinary no-Critic files do not pay for
the full Critic pipeline.

### Wave 5 — Put authoring and Track Changes on the canonical documents

- [x] Route every authoring capability check through the canonical mapped
  document and excluded ranges; close MH-07 across the full context corpus.
- [x] Capture exact JSON/OT operation intents at one gateway before mutation.
- [x] For a tracked transaction, build validated before and proposed-after
  documents, transform exact touched ranges, and prove both projection
  invariants before committing.
- [ ] Characterize and test the actual emitted operations for typing at every
  delimiter edge, selection replacement, Backspace/Delete, Enter/split, join,
  block conversion, cut, paste, search/replace-all, spellcheck, IME, tables,
  lists, undo, redo, and whole-document replace.
- [x] Prepare state, inverse/history, selection, tree rebuild, and events as one
  transaction. Failure publishes nothing and restores every observable.
- [x] Prove one undo boundary for every semantic command and exact restoration
  after coalesced edits.

**Gate:** MH-07/MH-08 and plan 0004 TN-02/TN-03/TN-04 are closed; every tracked
edit satisfies `Original=before` and `Revised=after` without unrelated Markdown
churn.

**Evidence (2026-07-11):** The canonical-context tranche first failed 23 of 24
rows: 15 authoring contexts were admitted or unmappable and all 8
create/destroy-context Track Changes transitions were rejected. Authoring now
asks `CriticMarkupDocument.authoringRange`; 16 code/link/image/math/HTML/
autolink/sub/sup rows reject with no Markdown, state, history, selection, or
event change. Track Changes builds fresh before/proposed/tracked documents with
one option set and the persisted parser rebuilds Markdown context inside each
semantic arm, so context created after a Critic delimiter survives commit and
reload without side metadata. The new suites are green at 2 files / 24 tests;
the existing single/multi-edit suites remain green (4 files / 40 tests in the
combined closure run before the final two residual fixes, then 24/24 focused).

### Wave 6 — Certify losslessness, sinks, security, and the real artifact

- [ ] Run the shared corpus through load/save, repeated save, edit/save/reopen,
  and WYSIWYG↔source no-op handoff.
- [ ] Settle and document each sink's policy. Recommended default: normal copy
  and search operate on the visible active projection; `Copy as Markdown`
  remains the explicit raw-source path.
- [ ] Test normal/rich/HTML/Markdown copy, cut, paste, search, HTML/PDF/print,
  word count, and source mode in Marked/Original/Revised views.
- [ ] Add hostile additions, deletions, substitutions, highlights, and comments
  containing script tags, event attributes, `javascript:` URLs, hostile image
  alternatives, quote-breaking titles, and cross-block payloads. Prove no
  execution or unsafe output while required Critic semantics survive sanitizing.
- [ ] Add a read-only desktop test bridge for canonical tab Markdown so byte
  assertions do not enter source mode and thereby mutate the handoff being
  tested. Keep separate tests whose subject is source-mode behavior.
- [ ] Exercise the hidden, freshly built desktop application: open corpus
  files, inspect review items, author/resolve changes, toggle projections, copy,
  save, reopen, undo, and redo with renderer-error capture enabled.

**Gate:** MH-09/MH-10/MH-11 are closed; focused/unit/conformance/E2E gates are
green; the real app proves the letter and spirit of the parser contract.

## Permanent fitness checks

Keep these after implementation; they are architectural tripwires, not
temporary migration tests:

- one transitive grammar/parser dependency-boundary test;
- one forbidden-legacy-pipeline/delimiter-owner test, extending
  `criticMarkupArchitecture.spec.ts`;
- one normalized excluded-range/forward-progress test;
- one mapped-source brand, boundary-affinity, and round-trip property suite;
- one shared parser/consumer parity corpus;
- one malformed-byte/nesting/resource-budget suite;
- one all-five-forms byte-preservation suite across source handoff and reopen;
- one exact-operation/projection-invariant/atomic-rollback suite; and
- one final-pipeline performance scale suite plus one hidden real-app workflow.

Each fitness check must be observed red against the behavior or structure it
forbids. Where practical after migration, temporarily reintroduce one forbidden
pattern, prove the fitness test fails, and immediately revert that mutation.

## What must not be transplanted from MC

- No `[MC:id]` metadata block extension, definition appendix, v1/v2 codec,
  stable IDs, threads, replies, authors, timestamps, status, or orphan metadata.
- No MC overlap-by-explicit-ID model or sticky end-of-file placement runs.
- No literal copy of MC's out-of-band clean-text anchor runtime. CriticMarkup
  additions, deletions, and substitutions are intentionally in-band semantic
  content. Transfer the single operation choke point and transaction discipline,
  not the representation.
- No MC-specific cut guards, ID remapping, metadata cleanup, CLI encoding rules,
  or external-merge state machine unless a separately approved feature needs
  them.
- No second CodeMirror regex/streaming grammar. If source decorations are later
  added, they consume the canonical batch parser result.
- No return to the MC branch's transitional shared handwritten block scanners.
- Do not revive the old evidence-branch plan 0002 assumption that CriticMarkup
  must be single-block. The current authority,
  `specs/architecture/criticmarkup.md`, deliberately supports block-spanning
  pure marker syntax; this plan hardens that decision rather than relitigating
  it.

## Completion criteria

Plan 0005 can be archived when:

- MH-01 through MH-12 are closed with red-green evidence or explicitly waived
  in this plan with validated, current evidence and rationale;
- plan 0004's one-document/one-context/mapped-source/mutation-gateway work passes
  the stronger corpus and fitness checks here;
- every parser-facing consumer agrees on item identity, ranges, literal
  contexts, ordering, and projections under the same options;
- valid and malformed input survives no-op persistence exactly except for a
  documented pre-existing serializer normalization;
- mapped positions have one branded algebra and one boundary-affinity policy;
- nested and large untrusted input has proven bounded behavior with no crash,
  hang, or silent truncation;
- exact mutation intents preserve both projection invariants and atomic undo;
- the complete Muya unit/spec/conformance, desktop unit/E2E, lint, typecheck,
  circular-dependency, and build gates pass sequentially; and
- a freshly built hidden desktop application completes the corpus workflow with
  no captured main/renderer error.

Lasting truths discovered while implementing this plan belong in
`specs/architecture/criticmarkup.md`; the plan freezes and moves to
`specs/plans/archive/` only after unimplemented items have been carried forward
or consciously dropped with rationale.
