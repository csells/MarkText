# Full-parse latency vs. document size — is incremental parsing needed?

**Question.** Phase 5 hard-requires incremental-parse equivalence; Phase 11 (backed by
`specs/research/0001`) says fragment reuse is likely unnecessary because main-thread time-slicing is
the real 0-lag lever. Which is right *for MarkText's workload* (large documents, cross-block
CriticMarkup)? Decide from measured latency, not assertion.

**Method.** A throwaway spike timed `LanguageEngine.open` (a full parse) over synthetic review prose
at increasing sizes, plain-Markdown and with realistic CriticMarkup density (~1 tracked change per 12
paragraphs) separately. Warm (post-JIT), median of 3. The current engine parses **per view** and is
unoptimized, so these are an **upper bound** on the parse-once target. Comments were excluded on
purpose: the current engine's `O(comments·n)` eager comment projections are a known current-impl
artifact the target removes, not a language cost.

## Measured

| lines | plain full-parse | plain ms/1k-ln | CM full-parse | CM ms/1k-ln |
| --- | --- | --- | --- | --- |
| 310 | 4.6 ms | 14.98 | 19.2 ms | 62.05 |
| 776 | 8.9 ms | 11.51 | 44.7 ms | 57.60 |
| 1,550 | 17.8 ms | 11.50 | 90.8 ms | 58.56 |
| 3,100 | 36.0 ms | 11.62 | 191.1 ms | 61.66 |
| 6,200 | 72.2 ms | 11.65 | 403.0 ms | 65.00 |
| 12,400 | 162.3 ms | 13.09 | 912.6 ms | 73.59 |
| 24,800 | 310.2 ms | 12.51 | 2,082.5 ms | 83.97 |

## Reading the numbers (against the "current impl ≠ target" caveat)

- **Plain Markdown is flat-linear at ~12 ms / 1,000 lines.** This is the fair proxy for the
  **parse-once target**: with no CriticMarkup the engine already parses once (Revised reads Original;
  the CM guard is skipped). So the target's cost on convergent text is ~12 ms/1k lines, `O(n)`.
- **The CriticMarkup path costs ~5× plain and creeps mildly superlinear (58 → 84 ms/1k-ln).** That
  penalty is the *current-impl tax the rebuild deletes*: per-view parsing plus the guard's redundant
  `parseCriticMarkup` per projection. The parse-once target with sparse markers should land near the
  plain line (fork only at rare divergences), not at 5×. The mild superlinearity is a warning to
  confirm the target stays linear, not evidence the language is superlinear.
- **Two real current-engine bugs surfaced** (current-impl artifacts, but genuine):
  1. **Stack overflow on very large documents** — `items.push(...sourceSlices(...))` in
     `canonicalMarkdownArtifact.ts:469` spreads a huge array through the call stack and throws
     `RangeError: Maximum call stack size exceeded` (~50k paragraphs). A spread-as-args size limit;
     the rebuild's emit-don't-reconstruct path should not build such arrays, but flag it.
  2. **CriticMarkup ~5× plain** — the per-view + redundant-recognition tax, expected to disappear
     under ADR-0013; worth a regression check that it does.

## What this means for 0-lag typing

Estimating the parse-once target at the plain-Markdown rate (~12 ms/1k-ln, linear):

| Document | Target full parse | Sync reparse per keystroke? | Verdict |
| --- | --- | --- | --- |
| Typical (≤ 2,000 lines) | ≤ ~24 ms | fine even naively | time-slicing trivially 0-lag; **no incremental** |
| Large (10,000 lines) | ~120 ms | would drop frames | time-slice + debounce covers it; **no incremental** |
| Very large (50,000 lines +) | ~600 ms + | no | full reparse wastes CPU per edit; **fragment reuse earns its keep here** |

- **Time-slicing covers everything up to large documents.** The keystroke shows immediately
  (optimistic surface update); the authoritative parse catches up within a frame or two, sliced across
  idle time — the `specs/research/0001` mechanism. No fragment reuse required.
- **Fragment reuse (incremental parsing) is a *very-large-document* optimization.** Only when a full
  reparse is hundreds of ms — tens of thousands of lines — does re-parsing only the edited block
  (bounded by the same safe points the fork model uses) beat a time-sliced full reparse. That is a
  real but narrow regime.

## Recommendation

**Split the dimensions (confirms the "split" option with data).**

- **Phase 5 hard exit** = full-parse correctness + deterministic resources + **checkpoint-restart /
  resumable** equivalence. Resumability is required regardless: it is what main-thread time-slicing
  runs on, and it shares the safe-point primitive with the fork model (`specs/research/0002`).
- **Incremental (fragment-reuse) equivalence** stays *defined* in Phase 5 as the acceptance contract,
  but **gated on Phase 11 actually building fragment reuse** — which Phase 11 does only if measurement
  on real very-large-document workloads shows time-slicing insufficient. Until then, "fall back to a
  clean full parse" (already in Phase 5 Green) is the shipped behavior. No phase requires an
  incremental parser to *exist* unless the numbers demand it.
- **First, fix the two current-engine facts** the target must not inherit: the large-array stack
  overflow, and confirming the CriticMarkup path collapses toward the linear plain-Markdown rate once
  it parses once.

The measured floor (~12 ms/1k-ln, linear) makes time-slicing sufficient for the documents almost every
user edits; incremental parsing is a deferrable optimization for the tail, exactly as Phase 11 frames
it.
