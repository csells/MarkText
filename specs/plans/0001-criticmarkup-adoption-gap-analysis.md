# 0001 — CriticMarkup Adoption: Gap Analysis

**Status: ASSESSMENT ONLY (2026-07-10). Not committed, not scheduled.**
This document exists so that *if* we decide to move off the proprietary `MC`
comment format onto the CriticMarkup standard, we already know the true cost.
It is a gap analysis, not an achievement plan. No code has been written; nothing
here is decided.

## The proposal under assessment

Replace the in-house `MC` annotation format **entirely** with
[CriticMarkup](https://fletcher.github.io/MultiMarkdown-6/syntax/critic.html),
and use that one standard for the whole annotation stack:

- **Comments** (today: `<!--MC:id-->…<!--MC:~id-->` + `[MC:id]: {json}`) → CriticMarkup `{==text==}{>>note<<}`
- **Suggestions** (new) → CriticMarkup `{++ins++}` / `{--del--}` / `{~~old~>new~~}`
- **On-disk merge conflicts** (today: a modal 3-pane resolver) → inline CriticMarkup marks with accept/reject

The motivation is real and worth taking seriously: CriticMarkup is the de-facto
plain-text track-changes standard, it is rendered by Obsidian, iA Writer,
Marked 2, MultiMarkdown, VS Code and PyMdown, it is almost certainly in every
LLM's training data (so agents emit and parse it with no custom spec), and it
ships a defined accept/reject transform. Adopting it deletes a proprietary
format — squarely in the spirit of "don't reinvent a standard."

## Bottom line (read this first)

1. **"Pure CriticMarkup, delete everything proprietary" is not actually
   reachable without regressing the comments feature.** CriticMarkup marks carry
   **no id** and its `{>>…<<}` payload is a **flat string**. Today's comments
   carry `status` (open/resolved), `authors`, `createdAt`/`updatedAt` and
   **threaded replies** (`[MC:id.N]` lines) — see `packages/muya/src/comments/types.ts:7-35`,
   `packages/muya/src/comments/syntax.ts:99-107`. To keep those you must re-add
   an id-keyed JSON appendix on top of CriticMarkup — i.e. you delete MC's
   *marker grammar* but keep an MC-shaped *metadata sidecar*. The realistic end
   state is **"CriticMarkup markers + a slim owned appendix,"** not a clean
   single-standard document.

2. **CriticMarkup is suggestion-shaped, not comment-shaped.** Its marks are
   *visible in-band content* (a deletion shows the struck text; other tools show
   literal braces). That is exactly right for suggestions and merge conflicts,
   and a **regression for comments**, whose whole value in MC is being
   *invisible* so commented prose renders clean.

3. **The merge-conflict → CriticMarkup mapping is lossy on three independent
   axes** and cannot be made clean: 3-way→2-way, multi-block→single-block,
   id-keyed→id-less. This is the hardest part and is discussed in full below.

4. This is a **large** change — greenfield parser + renderer + transform + UI +
   CLI + tests in muya and desktop, plus a lossless migration of existing `MC`
   documents. It is not a mechanical port.

Independent blind-panel framing (a separate debate, recorded for context):
greenfield, *pure* CriticMarkup was eliminated on the merits (no block-level, no
metadata); the contest was between a fully-bespoke format and a
CriticMarkup-plus-appendix hybrid, decided by whether mid-annotation readability
in **other tools** is a real user requirement. That product question is the
crux and is still open (see Decisions Required).

## What we are replacing (MC today)

`MC` is a mature, single-owner subsystem — the baseline any replacement must
match:

- Grammar owner: `packages/muya/src/comments/syntax.ts` (markers
  `<!--MC:(~?)id-->`; appendix `^ {0,3}\[MC:id\]:(.*)$`; reply lines `[MC:id.N]`).
- First-class parser integration: a marked **block extension**
  `packages/muya/src/utils/marked/extensions/commentMetadata.ts` for `[MC:]`
  defs, and an inline `comment_marker` token
  (`packages/muya/src/inlineRenderer/lexer.ts:262-283`).
- **Invisible** markers (HTML comments) that round-trip byte-identically through
  marked v18 (proven by the CommonMark/GFM conformance fixtures).
- Ranges **may overlap and span blocks** via explicit close-ids
  (`specs/architecture/comment-format.md:30-33`).
- Structured, mergeable metadata + threads; OT-anchor runtime that transforms
  anchors at the json1 choke point (`specs/architecture/comment-anchors.md`).
- A validating agent CLI (`skills/markdown-comments/`).
- Test-pinned byte-identical round-trip and a parser/comments dependency
  boundary (`specs/architecture/parser-integration.md`).

CriticMarkup, as a *standard*, provides none of: ids, structured metadata,
threads, block-spanning, invisibility, or overlap.

## Three structural constraints that shape the entire design

### C1 — Metadata has no home on an id-less mark (the floor)
CriticMarkup marks carry no id and `{>>…<<}` is a flat string. Every option for
attaching author/origin/created/accept-state to a mark is a compromise:
- an owned `[XX:id]: {json}` appendix keyed by an **injected** id → **breaks
  cross-tool portability** (the entire reason to adopt the standard), and
- stuffing JSON into `{>>…<<}` → non-standard, human-hostile in diffs, fragile.

There is no accept/reject/pending state field anywhere today; `TCommentStatus`
is only `'open'|'resolved'` (`packages/muya/src/comments/types.ts:3`).

### C2 — Single-block containment
The CriticMarkup spec forbids a mark spanning blocks. muya has **no text field
that crosses a block boundary** (`packages/muya/src/state/types.ts:1-4`), and
merge conflict regions are line-ranges that routinely cover multiple paragraphs,
list items or fences (`packages/desktop/src/renderer/src/util/threeWayMerge.ts:3-16`).
Whole-paragraph/structural changes therefore have **no single-mark form** and
force either per-block splitting or a new block-level construct (which pulls in
`markdownToState`/`stateToMarkdown` + a marked extension).

### C3 — Visibility asymmetry
CriticMarkup marks are visible in-band bytes. The renderer can only display text
that exists in `block.text` (`packages/muya/src/inlineRenderer/renderer/highlight.ts:47-49`),
so a struck deletion's text must be *real document bytes* — good for suggestions,
but it breaks the comments model's "markers are invisible anchors, one
coordinate space" invariant (`specs/architecture/editing-invariants.md:10-15`)
and forces decisions about whether struck bytes participate in copy/search/
word-count/caret navigation.

### C4 (hazard) — the `~~` collision
`{~~old~>new~~}`'s outer `~~` is byte-identical to GFM strikethrough, tokenized
earlier in `tryChunks`/`del` (`packages/muya/src/inlineRenderer/rules.ts:56`,
`packages/muya/src/inlineRenderer/lexer.ts:825-829`). A CriticMarkup handler must
run **before** `del`, gated on a leading `{`, while a bare `~~x~~` still
tokenizes as strikethrough — and the CommonMark/GFM ratchet
(`packages/muya/test/spec/expected-failures.json`) will fail CI on any
unreconciled regression.

## Two variants (assess both)

| | **V1 — Pure CriticMarkup** | **V2 — CriticMarkup + owned appendix** |
|---|---|---|
| Comment metadata | Flat `{>>…<<}` only | `[XX:id]: {json}` sidecar |
| Threads / status / authors | **Lost** (feature regression) | Preserved |
| Cross-tool portability | Full (standard only) | Partial (marks port; appendix is proprietary noise elsewhere) |
| Deletes proprietary code | Most of it | Marker grammar only; appendix machinery stays |
| Honest verdict | Clean but a real comments downgrade | Keeps parity but is *not* a pure-standard file |

V2 is the only variant that preserves today's comments feature. V1 is only
viable if we accept flat, unthreaded, no-status comments.

## Gap inventory by subsystem

Severity: blocker = feature can't ship without it; major = substantial;
minor = contained. Effort: S/M/L/XL. All evidence is from a file-grounded survey.

### 1. Parser + lexer + serialize (muya)
- **[blocker/XL]** No CriticMarkup parser exists — inline rules, lexer
  tokenizers, token-union types, and per-token renderers must all be built.
  Five mark kinds × (rule + handler + token type + renderer); a missing renderer
  **throws** in `dispatch` (`packages/muya/src/inlineRenderer/renderer/index.ts:186-190`).
- **[major/M]** `~~` collision (C4). Insert `tryCriticMarkup` before `tryChunks`
  (`lexer.ts:825-843`), gate on `{`, add conformance fixtures.
- **[minor/M]** Greedy `{`/`}` matching can over-eat LaTeX/code/JSON-in-prose;
  needs escape + boundary rules and literal-context exemptions (the
  `LITERAL_COMMENT_TEXT_STATES` precedent).
- **Good news:** inline marks live verbatim in `paragraph.text` and round-trip
  through `stateToMarkdown` with **no new serializer case**
  (`packages/muya/src/state/stateToMarkdown.ts:322-330`) — *unless* we add a
  block-level construct for C2, which then needs new state-node + serializer +
  marked-extension work.
- **[major/M]** Byte-identical round-trip properties (canonical spacing inside
  `{++ ++}`, ordering of `~~old~>new~~`) must be specified and test-pinned like
  `comment-format.md`, or a save silently corrupts the file (save writes
  `getMarkdown()` bytes verbatim, `packages/desktop/.../markdown.ts:82`).

### 2. Rendering + editing affordances + UI (muya + desktop)
- **[blocker/L]** In-band representation forced (C3): `highlight()` can only
  slice existing bytes, so ins/del/subst need real in-band tokens, not the
  comments' out-of-band anchor+decoration path.
- **[major/L]** No inline-token-bound accept/reject affordance exists; per-mark
  controls need new `attachments` nodes (block-level precedent only:
  `taskListCheckbox`) or a hover float. **No gutter rail exists.**
- **[major/L]** The accept/reject transform must run through JSONState ops
  (every edit is an operation) and reconcile with undo, clipboard, search,
  word-count.
- **[minor/S]** Rail/panel registration is a hardcoded icon array + `v-if` chain
  (`packages/desktop/src/renderer/src/components/sideBar/help.ts:16-45`,
  `sideBar/index.vue:51-60`); a `Suggestions.vue` panel mirroring `comments.vue`
  is a straightforward multi-file edit (+ i18n in 10 locales).
- **[major/M]** Engine + command surface: new `addSuggestion/accept/reject`
  engine methods (`packages/muya/src/muya.ts:263-280`) and `review.*` commands
  for both WYSIWYG and source surfaces, following the comment CRUD template.

### 3. Accept/reject transform + export/interop (muya + desktop)
- **[blocker/L]** No accept/reject (accept-all/reject-all) transform exists. The
  one strip fn `stripAnalyzedCommentSyntaxFromMarkdown`
  (`packages/muya/src/comments/analyze.ts:175`) is uniform keep-wrapped-text and
  is **not** reusable — CriticMarkup is directional and mark-type-dependent
  (`{--del--}` accept≠reject; `{~~a~>b~~}` has two outputs). Needs a CriticMarkup
  source index analogous to `buildCommentSourceIndex`.
- **[blocker/M]** Export leaks marks: `renderToStaticHTML.ts:55`,
  `markdownToHtml.ts:174`, and clipboard `getClipboardHtml.ts:12` (which strips
  nothing today) must all apply the transform, or `{++…++}` leaks into
  HTML/PDF/copied output.
- **[major/M]** Product decision with no home today: MC comments have **one**
  export (always stripped); CriticMarkup has **two** (accept vs reject) plus
  "leave marks." Needs an export-dialog/preference option
  (`editor.vue:1305` only branches on pdf/print/styledHtml). A wrong hard-coded
  default silently discards suggested/deleted text on export — a data-loss-shaped
  surprise.
- **[minor/S]** Import: `openPandocFile` uses no critic reader; an on-open
  recognizer is needed so external Obsidian/iA-Writer `{++…++}` files render as
  annotations, not literal text. (Direct `.md` open, not pandoc, is the primary
  import surface.)

### 4. Metadata model + CLI + tests (muya + skills)
- **[blocker/L]** No pending/accepted/rejected state model and no way to key
  metadata to an id-less mark (C1).
- **[major/M]** No suggestions CLI. `skills/markdown-comments/src/cli.ts` has no
  accept/reject/apply verbs; mirror the `reply`/`resolve` delegation once
  `@muyajs/core` suggestion mutations exist, preserving the byte-preservation +
  deterministic-JSON contracts.
- **[major/L]** No test corpus: muya parse/serialize/round-trip + accept/reject
  + tilde-collision specs; a conformance-ratchet reconciliation; a
  parser/suggestions import-boundary test (clone
  `commentsDependencyBoundaries.spec.ts`); skills CLI tests; desktop
  merge→CriticMarkup tests; Playwright e2e for accept/reject.
- **[minor/S]** Build vs buy: no npm CriticMarkup parser is in-tree, and a
  bolt-on side-scanner violates the "recognized by the base parser" rule
  (`specs/architecture/parser-integration.md`). A marked **inline** extension
  must be built.

### 5. Merge-conflict → CriticMarkup mapping (the crux)
The existing pipeline is line-based and proven no-data-loss:
`ThreeWayMergeConflict {id, baseStartLine, baseEndLine, baseText, localText,
remoteText, markerText}`, `ConflictChoice = 'local'|'remote'|'both'`, via
`node-diff3` (`packages/desktop/src/renderer/src/util/threeWayMerge.ts:3-24`),
consumed by `mergeSession.ts` and injected via
`dirtyExternalMergeActions.ts:446` (`store.loadChange`), with a modal resolver
(`components/editorWithTabs/mergeConflictDialog.vue`).

Mapping it to CriticMarkup is lossy on three axes:

- **[blocker/XL] Block-spanning conflicts do not map (C2).** A conflict region
  routinely spans paragraphs/lists/fences; a CriticMarkup mark can't. Options,
  all imperfect: (a) split into one mark per block — **loses the atomic-conflict
  grouping**, letting a user accept half of one logically atomic conflict and
  produce a document neither side authored (a data-integrity regression vs
  today's all-or-nothing); (b) keep the modal as a fallback for cross-block
  conflicts — **two resolution mental models** through the same
  supersede/accept/reload race handling; (c) whole-file escalation
  (`createWholeFileConflict`, `threeWayMerge.ts:180-207`); (d) represent
  structural changes as adjacent `{--old--}{++new++}` — doubles content.
- **[blocker/L] 3-way → 2-way.** CriticMarkup is 2-way; the merge is 3-way.
  `base` and the `'both'` (union) `ConflictChoice` have no faithful
  representation. Proposed reduction: `local`=original, `remote`=new →
  reject=keep local, accept=take remote.
- **[major/M] Direction ambiguity is dangerous.** With that reduction,
  CriticMarkup "accept" = **take the incoming disk/agent change**, which may be
  the *opposite* of a user's intuition ("accept **my** edits"). Getting it
  backwards silently discards user work on accept-all.
- **[major/L] Inline OT fragility.** Merge output is a markdown string re-parsed
  into the OT block tree; injected inline marks must survive subsequent
  ot-json1/ot-text edits and re-serialize byte-identically — more fragile than
  today's block-line splice, which never touches inline content.
- **[major/M] Validity gate.** Today the escalation gate reuses
  `analyzeMarkdownComments` + `containsConflictScaffolding`
  (`mergeSession.ts:166-205`, `threeWayMerge.ts:246-249`); a CriticMarkup flow
  needs an equivalent "valid, un-nested, single-block, no raw scaffolding"
  analyzer or mangled/block-spanning marks reach disk.

Honest summary: **CriticMarkup is an inline, single-block, 2-way, id-less diff
format being asked to carry block-level, 3-way, provenance-bearing merges.** Only
the narrow case (single-block, drop-base, 2-way, inline) maps cleanly.

## Migration: MC → CriticMarkup (rule zero applies)

Existing user files contain `<!--MC:-->` markers + `[MC:]`/`[MC:id.N]` metadata.
Converting to **V1 (pure)** is **lossy** — threads, status, authors, timestamps
have nowhere to go in flat `{>>…<<}`; that would destroy metadata users created
and is unacceptable without their explicit say-so. **V2** can migrate losslessly
only by carrying the same JSON into the new appendix (so V2's appendix schema
must be a superset of the MC payload). A migration must be proven byte-lossless
or refuse to run — matching the existing merge subsystem's no-data-loss invariant
(`specs/architecture/external-merge.md:56-63`).

## Decisions required (blocking a real plan)

1. **Comments: keep threads/status/invisibility, or accept the CriticMarkup
   downgrade?** This picks V1 vs V2 and is the single biggest fork.
2. **Is mid-annotation readability in *other tools* a real requirement?** It is
   the entire upside of switching; if negotiable, the case for leaving comments
   on MC (and only adding suggestions) strengthens.
3. **Metadata portability vs richness** (C1): standard-only, or an owned
   appendix that is noise in other tools?
4. **Merge**: replace the modal entirely, or inline-CriticMarkup for single-block
   conflicts + modal fallback for cross-block? How are `both` and `base`
   represented, and which side is "old" vs "new"?
5. **Export default**: accept-all / reject-all / preserve — dialog choice or
   global preference?
6. **Are struck deletion bytes "real"** for copy/search/word-count/caret?
7. **Do `{>>…<<}` comments unify with the existing thread model or stand alone?**

## Rough effort & phasing (if we proceed)

Large; sequenced to derisk the crux early:
1. **Grammar owner + inline parser** for the five marks, `~~` disambiguation,
   round-trip specs, conformance reconciliation. *(the collision + ratchet risk)*
2. **Accept/reject transform** + export/clipboard wiring + export-direction UX.
3. **Rendering + accept/reject affordances + Suggestions panel/rail**.
4. **Metadata sidecar** (V2) + CLI verbs + boundary tests.
5. **Merge → CriticMarkup** mapping with the explicit cross-block fallback, the
   direction decision, and the validity gate. *(highest-risk; do last)*
6. **MC → CriticMarkup migration**, proven lossless, behind a guard.

## Recommendation (framed, not decided)

If the goal is **suggestions + inline merge conflicts**, CriticMarkup is a strong
fit and worth adopting *for that*. If the goal is also **retiring MC comments**,
the honest cost is either a comments feature regression (V1) or a
CriticMarkup-plus-owned-appendix hybrid (V2) that is not the clean single-standard
end state the proposal imagines — plus a lossy-by-default migration. The
deciding input is product, not engineering: Decision #1 and #2 above. This
analysis is ready to become a numbered achievement plan once those are answered.
