# 0002 — CriticMarkup (Pure, Full-Fidelity) Implementation Handoff

**Audience: the implementation agent taking this forward. Read this top to
bottom, then read the specs it points at, before writing any code.**
**Status: kickoff brief (2026-07-10).**

---

## 1. Your mission, in one paragraph

On a **new branch cut from `markupdown-inline-comments`**, replace this repo's
proprietary `MC` inline-annotation format with **CriticMarkup**, implemented
**completely, at full fidelity, with NO extensions** — the standard exactly as
specified, nothing invented on top. Reuse the excellent parser-integration,
merge, anchoring, CLI, and test machinery already built on this branch; swap the
*format* underneath it from `MC` to CriticMarkup. Some feature degradation is
**expected and accepted** (see §7). The payoff: a genuinely standard,
cross-tool-portable, agent-native annotation implementation that other editors
(Obsidian, iA Writer, MultiMarkdown, VS Code) already understand, built on top
of work that's already production-grade.

You are **not** designing the format. CriticMarkup is the design. Your job is a
faithful implementation and a clean swap.

## 2. What this branch is, and why (get up to speed)

MarkText is a WYSIWYG Markdown editor (Electron + Vue 3 desktop app in
`packages/desktop`, the `@muyajs/core` editor engine in `packages/muya`, a docs
site in `packages/website`, agent skills in `skills/`). See `AGENTS.md` for the
full monorepo layout and commands.

This branch turned MarkText into a **local-first Markdown review editor** with
three intertwined capabilities, all keyed off plain-Markdown-on-disk as the only
source of truth:

1. **Portable inline comments** — anchored review comments stored *in the
   Markdown itself*, today as `MC` markers + a metadata appendix.
2. **Agent support** — a CLI (`skills/markdown-comments/`) so coding agents can
   read/mutate the review state in a file safely and byte-preservingly.
3. **Safe on-disk merge** — when a file changes on disk (e.g. an agent rewrites
   it) while the user has unsaved edits, a three-way merge reconciles the two,
   with a resolver for true conflicts.

The vision and the "why" are in `specs/vision/review-comment-vision.md` and
`specs/plans/review-comment-plan.md`. The settled technical contracts are in
`specs/architecture/`. **These are excellent and current — treat them as the
authoritative description of the machinery you're inheriting.**

## 3. The decision you are implementing (and the trade)

We are moving off `MC` (a bespoke HTML-comment format) onto **CriticMarkup**,
the de-facto plain-text track-changes standard. Rationale: it has real and
growing cross-editor support, and agents already know it from their training
data (so they emit/parse it with zero custom instructions). That interoperability
and agent-nativeness is judged worth the degradation it costs us.

**Full context for this decision — read it — is `specs/plans/0001-criticmarkup-adoption-gap-analysis.md`.**
That gap analysis is your map: it inventories every subsystem, the integration
seams (with `file:line`), the three lossy axes of the merge mapping, and the
accepted-degradation list. This handoff is the marching orders; 0001 is the
terrain.

The maintainer has explicitly chosen the gap analysis's **"V1 — Pure
CriticMarkup"** path: **no proprietary metadata appendix, no invented block-level
construct, no invisible-marker variant.** Standard only. The whole point is a
clean standard implementation; do not re-introduce proprietary machinery to
recover a lost feature (that would defeat the exercise — raise it with the
maintainer instead).

## 4. Read these first (in order)

1. `AGENTS.md` (+ `CLAUDE.md`) — working agreements, layout, commands. Note
   especially the two "read first" agreements: **no fallbacks/heuristics that
   hide bugs**, and **wait for the maintainer's actual answer** to any question
   you raise (they are deliberately away; elapsed time is never an answer).
2. `specs/plans/0001-criticmarkup-adoption-gap-analysis.md` — the full gap map.
3. `specs/architecture/comment-format.md` — the `MC` wire format you're
   replacing (its round-trip and merge-friendliness contracts are the bar).
4. `specs/architecture/parser-integration.md` — the **one-grammar-owner** rule
   and the parser↔analyzer dependency boundary. CriticMarkup must obey the same.
5. `specs/architecture/comment-anchors.md` + `editing-invariants.md` — the
   OT-anchor runtime and the "one coordinate space / every edit is an operation"
   invariants.
6. `specs/architecture/external-merge.md` — the merge pipeline's no-data-loss
   invariants and the disk-bytes contract.
7. `specs/architecture/agent-cli.md` + `skills/markdown-comments/SKILL.md` — the
   agent CLI you'll mirror.
8. `specs/architecture/test-infrastructure.md` — the conformance ratchet and the
   test topology.

## 5. Scope: replace / reuse / do-NOT-build

### Replace (rip out `MC`, put in CriticMarkup)
- The `MC` grammar owner `packages/muya/src/comments/syntax.ts` → a CriticMarkup
  grammar owner (same single-owner discipline; a new module, e.g.
  `packages/muya/src/criticmarkup/syntax.ts`).
- The `<!--MC:id-->…<!--MC:~id-->` markers + `[MC:id]:`/`[MC:id.N]:` appendix →
  CriticMarkup's five marks (§6). **No appendix.**
- The `commentMetadata` marked block extension + the `comment_marker` inline
  token → CriticMarkup inline marked extension + tokens.

### Reuse (this is the machinery worth keeping)
- The **parser-integration pattern** (first-class marked extension + inline
  lexer rule + single grammar owner + dependency boundary).
- The **merge subsystem**: `packages/desktop/src/renderer/src/util/threeWayMerge.ts`,
  `store/mergeSession.ts` (the pure reducer), `store/dirtyExternalMergeActions.ts`
  (the interpreter), and its race/supersede/no-data-loss guards. You are changing
  what a conflict *renders as*, not the merge engine.
- The **anchoring/OT concepts** where they still apply.
- The **agent CLI harness** in `skills/markdown-comments/` (byte-preservation +
  deterministic-JSON contracts).
- The **test topology**: muya vitest specs, CommonMark/GFM conformance ratchet,
  desktop vitest, Playwright e2e, dependency-boundary tests.

### Do NOT build (the "no extensions" guardrails)
- ❌ No `[MS:id]` / `[XX:id]` / any proprietary JSON metadata appendix.
- ❌ No invented block-level CriticMarkup construct to beat the single-block
  spec limit. If a change can't be a legal CriticMarkup mark, it does **not**
  become one (see §8 for the merge fallback).
- ❌ No invisible-marker (HTML-comment) variant of CriticMarkup. CriticMarkup
  marks are visible in-band content, by design.
- ❌ No thread/reply/status data model bolted onto `{>>…<<}`. Comments are flat
  (see §7).

## 6. The CriticMarkup spec (implement all five, exactly)

| Intent | Syntax | Accept → | Reject → |
|---|---|---|---|
| Insertion | `{++ text ++}` | keep `text` | drop `text` |
| Deletion | `{-- text --}` | drop `text` | keep `text` |
| Substitution | `{~~ old ~> new ~~}` | `new` | `old` |
| Highlight | `{== text ==}` | keep `text` (drop marks) | keep `text` (drop marks) |
| Comment | `{>> text <<}` | drop | drop |

- "Complete / full fidelity" = **all five** marks parse, render, round-trip
  byte-identically, and transform correctly under accept/reject — plus export,
  import, in-editor authoring/accept/reject UI, CLI, and the merge mapping.
- Accept-all → the new document; reject-all → the original. This is the defining
  operation and must be a pure, tested transform.
- **Spec limitation to honor, not fight:** a mark must be contained within a
  single block. Marks that would span blocks are simply not emitted (see §8).

## 7. Comments become CriticMarkup — the accepted degradation (CONFIRM)

Today's `MC` comments are rich: threads/replies, open/resolved status,
authors, timestamps, all invisible (HTML comments) so commented prose renders
clean. Pure CriticMarkup comments are `{== anchored text ==}{>> note <<}` —
**flat, single note, visible, no thread/status/author schema.**

**Accepted degradations under this decision (maintainer: confirm these are
intended):**
- Comments lose **threaded replies**, **open/resolved status**, and structured
  **author/timestamp** metadata. A comment is a flat `{>>…<<}` note on a
  `{==…==}` span.
- Annotations are **visible** in-band; other tools show literal braces, and our
  own export must strip/resolve them (see §8).
- Multi-block and overlapping comment ranges (which `MC` supported) are no longer
  expressible.

These are consequences of "pure CriticMarkup, no extensions." They are listed
here so they are a deliberate choice, not a silent regression. **If any of these
losses is unacceptable, stop and raise it with the maintainer before building —
the fix would be an extension, which is out of scope by decision.**

## 8. Merge conflict → CriticMarkup mapping (the hard part)

The merge engine (`threeWayMerge.ts`) produces line-based, 3-way conflict
regions: `ThreeWayMergeConflict { baseStartLine, baseEndLine, baseText,
localText, remoteText }` (`local` = the user's unsaved buffer; `remote` = the
incoming disk/agent change), with `ConflictChoice = 'local' | 'remote' | 'both'`.
CriticMarkup marks are inline, single-block, and 2-way. Map as follows.

**Per-hunk classification** (run an inner diff of `local` vs `remote`; `base`
is used only to classify which side changed, never emitted):
- remote-only addition → `{++ remote ++}`
- remote-only deletion → `{-- local --}`
- both changed → `{~~ local ~> remote ~~}`

**Direction — get this right or you silently destroy user work.** With the
mapping above, CriticMarkup **accept = take the incoming (`remote`) change**;
**reject = keep the user's (`local`) edit.** That is the *opposite* of a naive
reading of "accept my changes." **In the UI, never show bare "Accept/Reject" for
merge marks — label them by side ("Take disk version" / "Keep my version"),** and
default nothing destructive.

**Block-spanning conflicts (the case pure CriticMarkup cannot represent):** when
a conflict hunk spans block boundaries (blank lines, multiple paragraphs, list
items, fences), do **not** emit an illegal cross-block mark and do **not** invent
a block construct. Instead **fall back to the existing modal resolver**
(`components/editorWithTabs/mergeConflictDialog.vue`) for that conflict. Inline
CriticMarkup handles single-block conflicts; the proven modal handles the rest.
Yes, that's two resolution surfaces — that is the accepted cost of staying pure.
(Per-block splitting is the alternative but it lets a user accept half of one
atomic conflict and produce a document neither side authored — a data-integrity
regression; prefer the modal fallback unless the maintainer directs otherwise.)

**`'both'` and `base`:** pure CriticMarkup is 2-way, so `base` is dropped and the
`'both'`/union resolution has no single-mark form. Route `'both'` through the
modal fallback, or represent "keep both" as `local{++ remote ++}`. **Raise this
with the maintainer; do not silently pick.**

**Validity gate:** mirror the existing escalation gate (which reuses
`analyzeMarkdownComments` + `containsConflictScaffolding`, `mergeSession.ts:166-205`)
with a CriticMarkup analyzer that refuses to let malformed, nested, or
block-spanning marks reach disk — the same "no scaffolding reaches the document"
discipline the merge subsystem already enforces.

## 9. Migration of existing `MC` documents (rule zero)

Files created on this branch contain `MC` markers + `[MC:]` metadata. The global
**rule zero** (never destroy the user's data) applies. `MC → pure CriticMarkup`
is **lossy** (threads/status/authors have nowhere to go). Do **not** silently
drop that data. Options to put to the maintainer: (a) a one-way importer that
preserves the anchored text and the comment *bodies* (collapsing a thread into
its concatenated flat `{>>…<<}` notes) and **loudly reports** what could not be
represented; or (b) treat `MC` as unsupported on this branch and refuse to
mangle it. **Pick nothing here without the maintainer's decision.** Whatever you
build must be proven lossless *or* fail loudly — never a silent lossy rewrite.

## 10. Integration-seam cheat sheet (from the grounded survey)

| Concern | Where | Note |
|---|---|---|
| Inline rules for the 5 marks | `packages/muya/src/inlineRenderer/rules.ts:22-83` | gate substitution on leading `{` |
| Inline tokenizer | `packages/muya/src/inlineRenderer/lexer.ts:262-283` (`tryCommentMarker` shape) | insert `tryCriticMarkup` **before** `tryChunks`/`del` (`:825-843`) — the `~~` collision |
| Token union | `packages/muya/src/inlineRenderer/types.ts:49-70` | add mark token types; a missing renderer **throws** in dispatch |
| Renderers | `packages/muya/src/inlineRenderer/renderer/index.ts:44-77`, `delEmStrongFactory.ts` | ins→`<ins>`, del→`<del>`; style distinctly from GFM `~~` |
| Serialize | `packages/muya/src/state/stateToMarkdown.ts:322-330` | inline marks round-trip verbatim in `paragraph.text` (no new case) |
| Caret/offset math | `packages/muya/src/block/base/format.ts:103-153,1721-1746` | marks affect `getOffset`; add parallel cases |
| Accept/reject transform | new; model on `packages/muya/src/comments/analyze.ts:175` (`stripAnalyzedCommentSyntaxFromMarkdown`) | must be **directional & mark-type-dependent** (strip is not) |
| Export strip/resolve | `renderToStaticHTML.ts:55`, `markdownToHtml.ts:174`, `getClipboardHtml.ts:12` | or marks leak into HTML/PDF/clipboard |
| Export direction UX | `editor.vue:1305` (export dialog) | accept-all / reject-all / preserve — a real choice |
| Import recognizer | `packages/desktop/src/main/menu/actions/file.ts` (`openPandocFile`) + direct `.md` open | external `{++…++}` files render as marks |
| Suggestions panel/rail | `sideBar/help.ts:16-45`, `sideBar/index.vue:51-60` | hardcoded icon array + `v-if`; mirror `comments.vue` |
| Engine methods + commands | `packages/muya/src/muya.ts:263-280`, `commands/index.ts`, `review/commentCommandRouter.ts` | `add/accept/reject` + `review.*` |
| Merge → marks | `threeWayMerge.ts:3-24` + `mergeSession.ts` + `dirtyExternalMergeActions.ts:446` | §8; buffer injection at `loadChange` |
| Conformance ratchet | `packages/muya/test/spec/expected-failures.json` | any `~~` change that regresses GFM/CommonMark **fails CI** |

## 11. Working agreements (non-negotiable)

- **Red-green TDD by default.** Write the failing test, watch it fail, implement
  the minimum, verify green. A test that never failed proves nothing.
- **Done = verified in the real artifact.** Drive the running app
  (`pnpm run dev`), not just unit tests. Report exactly what you exercised.
- **No fallbacks/heuristics that hide bugs; fail loudly.** When two sources of
  truth disagree, fix the source, don't read whichever is convenient. (`AGENTS.md`)
- **Byte-identical round-trip.** Load→edit→save must not churn bytes; save writes
  `getMarkdown()` verbatim (`markdown.ts:82`) — a lossy tokenizer corrupts files.
  Pin canonical forms (spacing inside `{++ ++}`, `~~old~>new~~` ordering) with
  tests, exactly as `comment-format.md` does for `MC`.
- **Conformance ratchet only goes up.** Reconcile every `expected-failures.json`
  shift the `~~` disambiguation causes; do not weaken tests to pass.
- **One grammar owner; respect the parser↔analyzer dependency boundary**
  (`parser-integration.md`). No second CriticMarkup recognizer in the CLI or
  source mode — everything routes through the owner.
- **Rule zero on data** (§9). **Wait for the maintainer's real answers** to the
  open decisions below — do not self-resolve them.

## 12. Build / test / verify

From the repo root (see `AGENTS.md`; if `pnpm` isn't on PATH, use
`npx -y pnpm@10.33.4 …`):

```
pnpm install
pnpm run dev                                   # drive the real app
pnpm --filter @muyajs/core test                # muya unit + conformance
pnpm -C packages/muya/e2e e2e:chromium         # muya e2e
pnpm run test:unit                             # desktop vitest
pnpm run test:e2e                              # desktop Playwright
pnpm run test:skills                           # agent CLI
pnpm run lint && pnpm run typecheck            # CI-enforced
```

Branch setup (step 0), only if not already done for you:
```
git checkout -b criticmarkup markupdown-inline-comments
```
Keep every commit on `markupdown-inline-comments`. Do not push or open a PR
without the maintainer's explicit go-ahead.

## 13. Suggested phase order (derisk the crux early)

1. **Grammar owner + inline parser** for all five marks; `~~` disambiguation;
   round-trip specs; reconcile the conformance ratchet. *(collision + ratchet
   risk lives here)*
2. **Accept/reject transform** (the defining operation) + export/clipboard
   wiring + the export-direction UX.
3. **Editor rendering + accept/reject affordances + Suggestions panel/rail.**
4. **Comments on CriticMarkup** (`{==…==}{>>…<<}`) replacing `MC`, with the §7
   degradations; **CLI** verbs.
5. **Merge → CriticMarkup** mapping (§8): single-block inline marks, modal
   fallback for cross-block, the validity gate, the direction labeling.
6. **`MC` migration** (§9), proven lossless or fail-loud, behind a guard.

## 14. Definition of done

- All five CriticMarkup marks: parse, render, byte-identical round-trip, correct
  accept/reject — with red-green tests and the conformance ratchet intact.
- Accept-all / reject-all is a pure, tested document transform; export and
  clipboard never leak marks; import renders external CriticMarkup as marks.
- Comments, suggestions, and single-block merge conflicts all authored,
  displayed, and resolved in the running app (verified live), with cross-block
  conflicts falling back to the existing resolver.
- The agent CLI can list/accept/reject/apply.
- `MC` is gone from the format layer; no proprietary extension was added; the
  §7 degradations are the only functional losses and are documented.
- `pnpm run lint && pnpm run typecheck` and all suites green.
- `specs/architecture/` updated to describe CriticMarkup as shipped (retire/replace
  the `MC` wire-format doc), and this branch's specs kept honest.

## 15. Open decisions — raise with the maintainer, do NOT self-resolve

1. Confirm the §7 comment degradations (loss of threads/status/author) are
   intended.
2. `'both'` / `base` merge resolution: modal fallback vs `local{++remote++}`?
3. `MC` migration policy (§9): lossy-but-loud importer vs unsupported?
4. Export default direction: accept-all / reject-all / preserve — and dialog vs
   global preference?
5. Are struck deletion bytes "real" for copy / search / word-count / caret?

---

*This brief is derived from `specs/plans/0001-criticmarkup-adoption-gap-analysis.md`
(the grounded gap map) and the `specs/architecture/` contracts. When they
disagree with this brief, the architecture specs win — flag the discrepancy.*
