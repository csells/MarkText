# CriticMarkup integration with existing MarkText services

**Status:** Standing requirement, reaffirmed on 8 September 2026. Intrinsic parser and native UI integration were explicit in the July conversations; plan 0009 already required model-owned editing and prohibited post-hoc reconstruction on 19 July. The current implementation violates that requirement. [Plan 0012](../plans/0012-criticmarkup-upstream-integration-review.md) tracks the confirmed gaps.

The [vision](../vision/criticmarkup-vision.md), [Profile 1](../language/marktext-markdown-profile-1.md), and [document-authority ADR](../adr/0001-core-document-authority.md) remain authoritative. This note refines integration and reuse; it does not replace the language core or reset the architecture.

## One parser-to-UI stack

All MarkText Markdown and CriticMarkup behavior uses one parser stack and its common
document model. Raw-source recognition, syntax and source positions, editing operations,
rendering, and UI context form one stack. CM constructs are intrinsic to that model,
with the same status as ordinary Markdown constructs. The shared language core is the
language engine for existing MarkText features as well as Review; it is not an additional
engine maintained alongside a CM-unaware editor engine.

Muya's existing editor and widgets must operate on this shared model. Formatting state,
literal boundaries, structural editing, and selection meaning come from the same syntax
used to render the document. Source highlighting, search, clipboard, comment bodies,
reader modes, and exports use the same language implementation. No consumer reparses a
flattened projection to recover Markdown or CM meaning.

User actions enter the model's editing operations directly. The operation retains its
actual affected locations and meaning, including separate changes within one formatting
action. It is not reconstructed afterward from before/after strings or recognized native
operation shapes. Replacement and formatting must not become interchangeable because
they happen to produce similar visible text.

The next user action must use the common model's resulting document and selection.
Correcting saved source later cannot repair an action already captured against the
wrong selection. Input pairing, syntax shortcuts and selection changes therefore
belong to the same editing decision, not to an independent presentation predictor.

There is no parallel CM store, semantic side channel, or extra metadata field attached
to legacy change events to compensate for missing integration.
Transport and view bindings may carry the common model's operations and positions;
they may not supply a second interpretation or an optional more-accurate editing lane.
Superseded parsers and semantic reconstruction paths must be retired from production
call paths as their consumers move onto the unified stack, rather than retained as
fallbacks. Reuse existing MarkText components and services on that stack.

The existing acknowledged-save, history, pending-input and recovery guarantees remain
required. Recovery artifacts preserve user work; they are not another store of language
meaning. One durable authority is necessary but does not, by itself, establish this
unified architecture.

### Verification gate

Before implementing a semantic change, trace its intended production path against
this contract. Existing noncompliant code is migration work, not precedent for a
new adapter or fallback. If the approach cannot satisfy the contract, keep the
affected requirement open in the active plan and revise the approach. Weakening
the contract requires an explicit decision from the project owner; a passing test
subset, review approval, handoff or plan archival cannot change it.

For changes to document semantics or their consumers, implementation and review
must establish the following in the existing PR description or active plan:

1. **Trace the production path.** Identify the source parser/model, the operation
   receiving the actual user action, and the rendering/UI consumers, with code
   references. Show that syntax context and edit locations come from the common
   model. One save owner, matching screenshots or an import diagram alone is
   insufficient.
2. **Prove behavior through real callers.** Reproduce the failure before the fix,
   then verify independent expected source and relevant UI context using existing
   Markdown and CM cases through the same production entry points. For editing,
   cover the affected selection/command behavior and history/save round-trip;
   include repeated or identical visible text when location or intent is involved.
   Core-only commands and synthetic adapter events do not establish native input
   integration. Run the affected upstream tests alongside the new regressions.
3. **Account for the replaced path.** Name the superseded semantic parser, store
   or reconstruction path and verify its production callers have migrated. Any
   remaining consumer keeps unification incomplete; record it in the existing
   CURRENT blocker list. Reusing widgets and presentation services is expected;
   retaining their independent language interpretation is not.
4. **Report only demonstrated closure.** Record the tested revision/worktree and,
   for installed checks, artifact identity. Keep failing, unperformed and externally
   blocked checks explicit. Preserve input/recovery and the full product scope.

Package-boundary checks enforce dependencies, not this entire contract. Behavioral
regressions must run in the relevant existing test suites; production-path review
is also required. These documentation and review gates do not themselves prove
that the current implementation complies.

## One implementation for shared MarkText behavior

Extend existing components, services, and public package interfaces when the behavior already belongs to MarkText. Copying their appearance or logic creates another maintenance responsibility and does not satisfy native integration. Where a useful implementation is private, expose a narrow interface or extract the shared operation in its owning package, with both existing and Core consumers using it. Preserve upstream behavior and tests through that change.

The comparison recorded on 7 September is upstream HEAD, `develop` at `33777a7abc435468201aec1b914c39f2b27e115d`; upstream has no `main` branch. Refresh the target before an eventual PR. Avoid importing package internals directly or building a general extension framework for hypothetical consumers.

## Ownership and reuse

| Responsibility                     | Owner and integration rule                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language meaning and exact changes | Framework-free document-core owns canonical Markdown/CM recognition, scopes, projections, mappings, and validated atomic edits. A document actor owns acknowledged revision/history. Renderers never rescan flattened text to establish a second interpretation.                                                                                                          |
| Immediate editing                  | Muya and CodeMirror use the common document model and editing operations while retaining their native input, selection, composition and widgets. Session/view bindings coordinate presentation and acknowledgement; they do not reconstruct semantics from native diffs or supplemental metadata. Views and Pinia never become canonical save authority.                  |
| Preferences                        | The session owner maps existing Markdown preferences into Core options at open and on supported live changes. Apply options coherently with view refresh and pending work, without resetting source or undo history. A preference must not change Muya alone.                                                                                                             |
| Rendering and exports              | Core supplies semantic nodes; existing MarkText/Muya presentation services supply math, diagrams, highlighting, resource handling, themes, and export processing. Reuse or expose those services without invoking a second Markdown/CM recognition pass. Read-only views, comment bodies, clipboard and exports must retain their declared projection and trust boundary. |
| Images and links                   | Reuse desktop resource resolution and link activation, including document-relative paths. Pass document context explicitly where needed; do not resolve against the application bundle or duplicate scheme/path policy.                                                                                                                                                   |
| Search and replacement             | Share upstream pure query and capture-expansion policy. Core retains semantic traversal, scoped matches, source coordinates and transaction submission. Reusing the DOM-mutating search/history implementation would violate authority ownership.                                                                                                                         |
| Counts and headings                | Reuse `wordCount` and Muya’s complete heading-ID allocation policy, including chained collisions. Core-specific source identity and mapping remain necessary for revision-safe navigation.                                                                                                                                                                                |
| Native UI                          | Reuse the existing left sidebar, layout store, scroll/resize conventions, selection toolbar, menus, context menu, palette and keybindings. Review remains a tab alongside Files, Search and TOC.                                                                                                                                                                          |
| Ordinary controls                  | Use existing button/input components or shared control classes and theme states; keep only feature-specific layout locally. Reuse existing translation keys such as `common.cancel`.                                                                                                                                                                                      |
| Accessibility and language         | Preserve logical focus across composer closure, visible keyboard focus, localized accessible names and live language changes. Pass document writing direction to teleported review excerpts, comment bodies and entry fields; shell direction is a separate concern.                                                                                                      |
| File and recovery lifecycle        | Main retains bytes, encoding/BOM/EOL, atomic persistence and native effects behind typed IPC. Rejected drafts remain durable and discoverable, separate from acknowledged saves. Existing replaceable buffers or transient notifications cannot substitute for this preservation contract.                                                                                |

Literal-block payload—code, math, diagrams, HTML and front matter—is intrinsic
text and soft-break syntax, with exact source ranges and parser-supplied values. Those values retain entity,
backslash and CM-looking spelling; they are not run through inline Markdown
recognition. Code reset, literal edit-view mapping and intrinsic selection consumers use
these same children instead of reconstructing indentation from rendered strings.
Existing scalar payloads remain the input to the existing media/export services;
those consumers must not render the new children a second time. Source normalization
can make a displayed position differ from a raw UTF-16 offset; input must retain
that model position rather than round it to a source boundary. Intrinsic text
positions identify a current parser-owned value and an offset within it; they
carry no cached interpretation. History, composition, clipboard and Source
handoff retain or project that same position. Materialization belongs to an
accepted mutation, never to selection capture, copy or a no-op. Remaining
intrinsic-selection consumers and verification remain U1 in plan 0012.

Native table spelling and its output-size preflight also share one Muya owner. Desktop retains table admission, source replacement boundaries and EOL provenance; it does not calculate padding or Unicode column widths.

Native typing policies and delimiter tables share the framework-free
`@marktext/input-policy` package, used by Muya and document-core. Core owns syntax
context and source-coordinate planning; the policy package does not parse Markdown
documents or own document state. Its code-Tab abbreviation policy reuses Muya's
existing `html-tags@5.1.0` tag data; that explicit data dependency does not admit
DOM, framework or application runtime dependencies. Its separate package boundary preserves Muya's published
dependency contract without introducing a dependency on a private application
package. Input capture distinguishes the user's selection from the browser's
replacement target range, particularly for collapsed deletion.

The shared implementations now include Muya's `MarkdownToHtml.fromHtml`, `renderMath`, `highlightCode`, footnote presentation and pure search helpers. Core supplies semantic HTML to the existing media/export pipeline without another Markdown parse. Desktop image normalization reuses `resolveImageSrc`; links use `FORMAT_LINK_CLICK` and its existing resolution policy. Review and recovery actions use shared `.button`/`.button-primary` states. Async projection rendering publishes only the latest result and disposes only its own temporary rendering container.

Preference changes and reads are serialized by the document session owner. Waiting for pending work and dispatching the following read form one operation at that boundary; a separately awaited drain would let a configuration transaction intervene. This applies to saves, projections, selection, search and review reads. Configuration retains the actor, source and history while adapters reconcile their pending presentation. Explicit sidebar navigation supersedes pending caret-follow reads through the existing latest-view owner; an enabled entry must not silently discard a click during refresh.

The shared print service prepares the hidden print container and loads the fonts used by its text before native PDF/Print dispatch. Readiness and cleanup belong to that specific preparation. Superseded work cannot dispatch against, or remove, a newer container.

## Justified feature-specific modules

The review list, retained comment composer, rejected-draft presentation, source-coordinate adapters, canonical EOL index and acknowledged transaction history have responsibilities existing widgets do not provide. Keep them small and integrated. A hierarchical TOC tree is not a substitute for a flat review list with comment bodies; an expiring notification is not durable recovery. Reuse primitives and services without weakening those contracts.

Extracting review orchestration from `editor.vue` is optional unless a concrete fix benefits from it. File size alone does not authorize a new controller hierarchy or architecture reset.

## Verification at the shared boundary

Demonstrate reuse through behavior: existing and Core paths use the same supported preferences, regex queries, media fixtures, theme states and translated controls. Tests must retain independent expected source/output, cover failures as well as the happy path, and inspect the actual visible projection. Passing a wiring test or importing an existing helper does not establish compatibility.

Changes to a shared service require its existing callers' regression checks as well as Core integration checks. Final installed, default-enabled verification and sustained input/recovery remain release requirements in the active plan.
