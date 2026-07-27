# document-core — module design record

> Design-review record (2026-07-25, three-axis deep-module review; run wf_03017769) for
> `@marktext/document-core` as a standalone module. Owner intent: **doc-core is not being
> published to npm now, but must remain standalone from MarkText so that option stays open.**
> Vocabulary per the codebase-design skill: module / interface / seam / adapter / depth.

## Verdict

document-core is a **deep module at a real seam**: the main-owned session host,
`@marktext/document-view`, and static materializers consume one small public
entry; dependency direction is strictly one-way (zero runtime dependencies;
`boundary-policy.json` forbids document-view/marked/vue/pinia/electron);
nothing MT-specific flows in through any adapter — hosts pass only source text, doc-core-owned
`ParseConfiguration` profile IDs, and model selections. The exercised host surface is five
functions plus documented UTF-16/revision invariants, hiding parsing, revisions, leases, and
render planning — the deletion test scatters all of that across three hosts, so the module is
earning its keep.

## Standalone-ness: enforced, with two closed gaps

- Public entry sealed by the exports map; `packed-consumer.spec.ts` proves deep imports fail at
  runtime and type level; zero deep-import consumers exist in the workspace.
- Pure ES2022: no DOM/Electron/Node globals in `src` (tsconfig `types: []` makes DOM references
  a typecheck failure); CI runs the full package check plus the real browser view.
- **Fixed 2026-07-25:** the desktop's phantom dependency (imported doc-core via hoisting
  without declaring it) — now a declared `workspace:*` edge; and the enforcement gap where
  boundary policy checked manifests but not actual `src` import statements — the
  dependency-policy spec now walks `src` and asserts every import specifier is relative.
- Accepted as versioned language/budget decisions behind profile IDs (plan 0009 decision 9),
  NOT host-knowledge leaks: `marktext-profile-1` (the language's name),
  `DIAGRAM_FENCE_LANGUAGES` (classifies fences into generic `diagram` nodes; hosts without
  diagram renderers simply receive `diagram` nodes), `desktop-v1` (a budget class a host
  selects; if ever renamed pre-publish, prefer a capability name like `standard-v1`).
- Publish mechanics deliberately deferred (option-preserving, not action items): `private:
true` stays; at publish time drop it, add LICENSE/README to the package dir, add a
  `repository` field. `publishConfig`, `files`, `prepack`, `sideEffects` are already correct.

## Obligation-1 audit (balanced block sequence) — ANSWERED

Today's shape does **not** foreclose the Wagner & Graham balanced sequence:

- The top-level block array is a closure capture inside `createNode`
  (`markdownParser.ts`); it never escapes. All consumers — internal and both external
  adapters — reach blocks through the accessor seam `MarkdownNode.childCount/childAt` +
  `MarkdownDocument.nodeAt(offset, affinity)`, which is exactly the interface an
  order-statistic balanced tree implements at O(lg N). **The Phase 5/11 swap touches one
  constructor site.** `nodeAt`'s per-level linear scan is acceptable now; the O(lg N) lookup
  falls out of the storage swap (do not add a side index meanwhile).
- The true W&G-critical internal sequence is `PlainMarkdownLaneParse.lines` (absolute-offset
  line records; the ADR-0013 reuse path splices it, `shiftPlainMarkdownLane` rebuilds it) —
  marked in source as the Phase 5/11 replacement site; `lines` must not leak out of
  `internal/profile1`.
- Public array-ness leaks to close while the package has no external consumers:
  `CriticMarkupForest.roots` and `MarkupProjection.runs` → the package's existing
  `count/at` accessor idiom (`DiagnosticIndex`, `SourceOwnershipIndex`) in one breaking
  change. (Scheduled; test sites migrate with it.)
- View-layer positional vocabulary (`blockIndex`, `groupRenderBlocks`' flat return) is
  per-snapshot and tree-compatible; acceptable through Phase 0.5. Rule: no new consumer may
  store `blockIndex` across revisions.

## HTML materialization (owner ruling, 2026-07-25)

An AST→HTML mapping exists as a doc-core module: **not part of the parser** (a consumer of the
revision's markdown/CM AST, peer to `view/markupRender`), **packaged and exported with
doc-core** (any editor host gets HTML materialization without reimplementing it). CommonMark
and Profile 1 corpora compare literal expected HTML with that shipped materializer, so tests
exercise the public behavior rather than a test-only renderer.

Profile 1 extensions have one safe dependency-free base representation:

- subscript and superscript use semantic `<sub>` and `<sup>` elements;
- inline math uses `<span class="math-inline">` and math blocks use
  `<pre class="math-block"><code>`, with parser-owned content HTML-escaped;
- diagrams use `<pre class="diagram" data-language="…"><code>`, preserving a safe readable
  base representation without host enhancement; and
- resolved footnotes use numbered references plus a final semantic footnote section, while
  unresolved references stay literal.

Product hosts may enhance math or diagram nodes visually, but the target-owned base representation and
its hostile-content behavior are complete public semantics. CriticMarkup-decorated HTML uses
only inert `ins`, `del`, and `mark` wrappers plus sanitized Comment-note references.

Semantic text/search materialization follows the same emitted tree: subscript,
superscript, and inline math expose their content; math and diagram blocks
expose parser-owned block content; table cells are tab-separated; resolved
footnotes use numbered references and a final numbered body; unresolved
references remain literal. No text consumer re-reads Markdown delimiters.

## Seam refinements (scheduled from the review)

1. `DocumentSessionOpenOptions` forces four singleton-literal fields every host restates —
   default them (or export an `openMarkupSession` convenience) so hosts state only what
   varies.
2. Subscription lifecycle contract: unify on the production view's `Disposable` return for
   `onChange` across `DocumentCoreBinding`/mirror/host; the mirror's `dispose` detaches what
   it attached.
3. Before any future publish: split the entry into the session + render-plan surface every
   editor host needs vs parser-level/forensic exports (only unit tests use
   `createLanguageEngine` et al. today).
4. Keep one engine-owned view↔model coordinate mapping. The production view
   consumes parser-issued ranges and must not infer model positions from DOM.
