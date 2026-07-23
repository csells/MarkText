# CriticMarkup view-fork reconvergence — how "parse once, fork at divergence" actually behaves

**Question.** ADR-0013 says the parse "forks only across a region where eliding a marker changes
Markdown structure, and reconverges after it." An adversarial review flagged that "reconverges after
it" is false for block-structural markers (a fence opened inside an addition runs to EOF in one view,
a heading in the other). This note establishes the *right* fork model from evidence.

**Method — spike as oracle, not as design.** Original (reject-all) and Revised (accept-all) block
trees are the correct answer any conforming implementation must produce, independent of how it computes
them. A throwaway spike opened representative sources and compared the two projected block trees'
top-level structure, measuring where they diverge and where (if) they re-agree. The measurements below
are properties of **CommonMark + CriticMarkup semantics**, read off correct outputs — not of the
current per-view-parse engine, which ADR-0013 replaces.

## Measured behavior

| Case | Source | Original blocks | Revised blocks | Reconverges? |
| --- | --- | --- | --- | --- |
| Inline addition | `Hello {++brave ++}world.` | `[para, para]` | `[para, para]` | identical — no block divergence |
| Inline emphasis | `a*{--X--}*b` | `[para(3 inline), para]` | `[para(1 inline), para]` | divergence contained **within one block**, reconverges at block end |
| Deleted heading marker | `{--# --}Title` | `[heading, para, para]` | `[para, para, para]` | **yes — at the first blank line** |
| Addition splits para | `a{++\n\n++}b` | `[para, para]` | `[para, para, para]` | yes — shared tail |
| Deleted list marker | `{--- --}item` | `[list, para]` | `[para, para]` | yes — at the first blank line |
| Deleted blockquote marker | `{--> --}q` + long tail | `[blockquote, h1, p, p, p]` | `[para, h1, p, p, p]` | yes — 4-block tail shared |
| **Closed** fence in addition | `{++```\ncode\n```++}` | `[para]` | `[code-block, para]` | yes — reconverges right after the closing fence |
| **Unclosed** fence in addition | `{++```++}\n# Heading` | `[heading, para]` | `[code-block]` | **no — runs to EOF** |

## The property this establishes

Every divergence reconverges at the **next top-level blank line** — *except* when a resolution has an
**open fenced-code or HTML block** at that line. This is exactly CommonMark's own rule: a blank line
ends a paragraph and separates blocks, and the *only* leaf blocks a blank line does not close are
fenced code (blank lines are literal content until the closing fence) and HTML blocks. So:

- **A "safe point" is a top-level blank line at which neither resolution has an open fenced-code/HTML
  block and no open container a blank line does not close** (a list needs two blank lines, or content
  dedent, to fully close). At a safe point both resolutions are in the identical *document-root,
  nothing-open* block state, so the remaining source parses identically in both → **it is parsed once.**
- **Inline divergence** never escapes its block; it reconverges at that block's end at the latest.
- **Block-structural divergence** reconverges at the next safe point — usually the next blank line,
  measured at 1–2 blocks later in every non-fence case above.
- **The only divergence that reaches EOF** is an *unclosed* fenced-code/HTML block opened inside the
  divergent region. That input runs to EOF under plain CommonMark too (an unclosed fence always does);
  it is degenerate, not the common case. A *closed* fence reconverges immediately after it.

## Consequences for the fork model

1. **"Reconverges after it" should read "reconverges at the next safe point (a top-level blank line
   with no open fence/HTML block), possibly at EOF for an unclosed fence."** The reconvergence point is
   real, sound, and cheaply detectable — not hand-waved.
2. **"Parse once" holds for all convergent text**, which is everything outside divergent spans — the
   overwhelming majority of any review document, because inline markers (word/phrase edits) never
   change block structure and block-structural markers are rare and reconverge within a block or two.
3. **Worst case is a bounded constant times n**: `O(views · n)` only if divergence is pervasive or an
   unclosed fence forces a full forked tail. `views` is a small constant (Original, Revised, editing,
   plus one per comment), so this is a constant multiple, not a complexity class change. Common case is
   `O(n)`.
4. **No language deviation is needed to get locality.** Bounding a fork at its enclosing block (forcing
   a fence shut at a block edge) would buy predictability by changing what the document *means* — a
   MarkText-only reading another CriticMarkup tool would not share, against the vision's "alter nothing"
   principle. The evidence shows divergence is *already* mostly-local under faithful CommonMark, so the
   deviation buys little and costs fidelity.

## The exception that block-local reasoning misses: reference definitions

Block reconvergence governs **block** structure. It does not govern **inline**
resolution, because CommonMark reference definitions are *document-scoped*.
Verified against the engine:

```markdown
[link]

{++[link]: /url++}
```

The first block contains **no marker at all**, yet its inline structure is `text`
in Original (the definition is rejected, so the reference does not resolve) and
`link` in Revised (accepted, so it does). A block can therefore diverge across
views with nothing marked inside it.

Consequences for the fork model:

1. **"No marker in this block" does not imply "shared."** Any fork plan keyed on
   marker positions alone is unsound. When a divergent region may carry a
   reference definition, no block is safely shared.
2. **Block sharing and inline sharing are different problems.** Block structure
   reconverges at a safe point; inline resolution depends on a document-wide
   definition index that is itself view-dependent. A parse-once implementation
   must compute the definition index per view (cheap — it is a scan of
   definitions, not a full parse) and re-resolve references, even where block
   structure is shared.
3. **Conservative over-approximation is the correct interim posture.**
   Over-marking a block divergent only forgoes an optimization; under-marking one
   serves a view another view's tree. `forkPlanOf` currently refuses all sharing
   when a divergent run looks like it carries a definition, and should take
   parser-supplied definition ranges when the fork lands — deciding what a
   definition *is* belongs to the parser (ADR-0009), not to a view-layer probe.

Setext underlines and lazy continuation are the same shape of hazard (a marker
changing how a *later or earlier* line is read) and want the same treatment:
identify them from parser-owned facts, not from a view-layer scan.

## Unification with incremental parsing (Phase 5/11)

The "safe point" detector — a position of canonical, nothing-open block state where a parse can start
knowing its full block context — is the **same primitive** an incremental parser needs to pick a
restart boundary after an edit (the fragment-reuse boundary in `@lezer/markdown` / tree-sitter; see
`specs/research/0001`). Cross-view reconvergence and cross-edit fragment reuse are the same problem:
*find a position where block-parser state is known and empty.* Building the safe-point detector once
serves both the fork model (now) and 0-lag incremental parsing (later).

## Recommendation

Adopt the **faithful, safe-point-precise** fork model (was "honest tiered"): parse convergent text
once; fork at a marker that changes structure; reconverge at the next safe point; accept the unclosed-
fence-to-EOF degenerate case as the honest worst bound. Keep 100% CommonMark fidelity — do not bound
forks by changing block semantics. Build the safe-point detector as a shared primitive for the eventual
incremental parser.
