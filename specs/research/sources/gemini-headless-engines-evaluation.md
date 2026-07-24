# Architectural Evaluation of Headless Markdown Engines for Custom WYSIWYG Document Modeling

## Architectural Context and the Profile 1 Specification

The engineering objective at the core of this evaluation is to determine the optimal architectural path for MarkText, an Electron, Vue, and TypeScript-based WYSIWYG editor, in implementing a source-authoritative document engine. The target specification, designated "Profile 1," mandates strict adherence to the CommonMark 0.31.2 specification, significantly extended by GitHub Flavored Markdown (GFM) features including tables, task lists, strikethrough, and autolinks. Furthermore, the specification requires intrinsic support for mathematical environments (both inline and block), YAML front matter, programmatic diagram fences (including Mermaid, PlantUML, Flowchart, Sequence, and Vega-Lite), footnotes, and the five standard CriticMarkup annotation forms.

The defining characteristic of this engine must be its "source-authoritative" nature. In such an architecture, the raw Markdown source text remains the single source of truth, and the parsed syntax tree must act as a lossless, exact map of that text. This requires an engine capable of accounting for every single character, including whitespace and line endings, with exact positional offsets. Because the editor operates within a TypeScript and DOM-based environment, these offsets must strictly correspond to UTF-16 code units. Any deviation from UTF-16 indexing will result in synchronization failures between the parser's syntax tree, the editor's internal state, and the browser's native DOM selection APIs.

Currently, the project contains approximately 15,000 lines of custom TypeScript code dedicated to parsing and document modeling, with roughly 8,500 lines forming an incomplete Markdown-recognition layer. Incremental reparsing—the ability to reuse unmodified syntax tree fragments on a per-keystroke basis—has not yet been implemented in this custom engine. The critical decision is whether to continue investing in this custom parser, absorbing the massive engineering complexity of CommonMark edge cases and incremental tree reconciliation, or to abandon the custom parser and adopt an existing, hardened, headless Markdown engine.

To evaluate the adoption path, any host engine must support or permit the building of a lossless, exact-offset parsing model. It must exhibit total error tolerance, meaning that mid-edit, malformed prefixes must parse gracefully without swallowing the remainder of the document. The engine must support CriticMarkup via a public extension API, preventing the need to fork the engine or run a secondary, destructive scanner over the output. Finally, the engine must execute full parses in linear time with no pathological slowdowns, provide or allow the construction of incremental reparsing, and operate efficiently within an Electron sandboxed renderer without introducing unacceptable inter-process or WebAssembly boundary latency.

## The Structural Complexity of Intrinsic CriticMarkup

Integrating CriticMarkup as an intrinsic, same-pass production of the Markdown grammar introduces severe architectural stress on traditional parsing engines. Markdown is fundamentally a block-first grammar. Parsers resolve document structure by first isolating block-level constructs (such as paragraphs, blockquotes, and lists) and subsequently processing the inline text contained within those blocks. CriticMarkup, however, was originally designed as a pre-processor syntax. Its annotations represent continuous editorial interventions that frequently violate Markdown's hierarchical boundaries.

The Profile 1 specification requires the support of five CriticMarkup forms: addition (`{++add++}`), deletion (`{--del--}`), substitution (`{~~old~>new~~}`), highlighting (`{==highlight==}`), and commenting (`{>>comment<<}`). Treating these forms as intrinsic syntax requires the host engine to successfully resolve three complex parsing scenarios: recursive nesting, arm-local delimiter containment, and literal precedence.

Recursive nesting dictates that an annotation may contain other annotations, including those of the same form. The parser must maintain an internal stack to properly pair opening and closing delimiters, preventing an inner closing tag from prematurely terminating an outer opening tag.

Arm-local delimiter containment presents a more acute challenge, particularly within the substitution syntax. If a user begins an emphasis run within the "old" arm of a substitution but fails to close it before the divider (`~>`), the parser must ensure that the emphasis does not leak into the "new" arm. In a compliant engine, the emphasis markers in the "old" arm must either successfully resolve within that specific arm, or degrade gracefully to literal text. Delimiters must never cross the internal boundaries of a CriticMarkup annotation.

Literal precedence requires that the engine respects the boundaries of verbatim environments. CriticMarkup markers placed inside inline code spans, fenced code blocks, mathematical environments, raw HTML, or YAML front matter must be ignored and treated purely as literal data. The engine's extension architecture must therefore allow CriticMarkup tokenization to be suspended or deprioritized when the parser enters these specific states.

### The Multi-Block Span Anomaly

The most rigid and non-negotiable product decision within the Profile 1 specification is the requirement for multi-block annotation spans. An annotation may open in the middle of one paragraph, span across several intervening blockquotes, lists, or tables, and close in the middle of a subsequent paragraph.

In a standard Concrete Syntax Tree (CST), a multi-block span creates an overlapping hierarchy, which is mathematically impossible to represent in a standard Directed Acyclic Graph. If Block A contains the opening delimiter and Block B contains the closing delimiter, the CriticMarkup span intersects the boundaries of the parent blocks. Traditional parsers enforce a strict dichotomy between block-level flow and inline-level text. Forcing an inline-level parsing rule to remain active across a block boundary typically breaks the engine's internal state machine. Assessing the viability of the candidate engines hinges entirely on whether their extension models can express a construct that opens in one block and closes in another without necessitating a fundamental rewrite of the engine's core parsing loop.

## Disqualification of the Broader Parser Ecosystem

To ensure a rigorous evaluation, the broader ecosystem of available parsing engines was analyzed against the hard requirements. Several highly popular libraries were immediately disqualified due to architectural paradigms that render them incompatible with a source-authoritative WYSIWYG editor.

The `marked` library was disqualified due to its destructive, regular expression-based architecture. `marked` operates by applying a cascade of regular expressions to the source text, yielding an intermediate representation that is immediately serialized into HTML. It does not produce a highly structured Concrete Syntax Tree (CST), nor does it track exact character offsets or preserve the exact byte structure of the original input. Consequently, it cannot support the lossless, byte-exact round-tripping required by the Profile 1 specification.

The `markdown-it` library, while extremely popular and highly extensible, was disqualified due to its token-based architecture. Rather than constructing a deeply nested AST or CST, `markdown-it` parses input into a flat array of tokens. While plugins can easily manipulate these tokens, the lack of a true hierarchical tree makes incremental reparsing algorithmically inefficient. Furthermore, the engine tracks position fidelity via line numbers and coarse string indices rather than exact UTF-16 code-unit offsets, requiring fragile downstream calculations to map the flat token array to precise DOM selection boundaries. Attempting to build multi-block CriticMarkup spans in `markdown-it` often involves mutating the token array after the initial parse, which violates the requirement for intrinsic, same-pass syntax resolution.

The `comrak` library, a highly compliant CommonMark parser written in Rust, was disqualified due to its optimization profile. While it produces a robust Abstract Syntax Tree (AST), it is engineered for batch processing and static site generation. It lacks the granular, tree-fragment-based incremental parsing mechanisms required for real-time, per-keystroke execution in a browser or Electron renderer.

The `remark` ecosystem was considered, but it is fundamentally an Abstract Syntax Tree (MDAST) manipulation layer that relies entirely on `micromark` for its underlying tokenization. Because the requirements mandate an evaluation of the core parsing engine itself, the focus was shifted from the higher-level `remark` API to its foundational engine, `micromark`.

Following these disqualifications, the evaluation focuses on the three strongest and most architecturally distinct headless engines: `@lezer/markdown` (TypeScript), `micromark` (TypeScript), and `pulldown-cmark` (Rust).

## Architectural Evaluation: `@lezer/markdown` (TypeScript)

`@lezer/markdown` is an incremental parser designed specifically for CodeMirror 6 and modern text editor integration. While it falls under the Lezer umbrella, it does not utilize the standard Lezer LR parser runtime, as Markdown's context-sensitive indentation and fallback rules cannot be modeled by traditional context-free grammars. Instead, it employs a custom algorithm that produces Lezer-compatible, compact syntax trees and natively consumes fragments of those trees to achieve high-performance incremental reparsing.

### CommonMark conformance and Structural Deviations

The engine explicitly targets CommonMark compliance, but it introduces highly specific, documented deviations to ensure $O(n)$ incrementality and single-pass performance. The most prominent deviation involves the validation of link reference definitions. In a strictly compliant CommonMark engine, a string like `[a][b]` is only parsed as a valid link if a corresponding definition (`[b]: https://example.com`) is located somewhere in the document. This requires the parser to perform a complete pass over the document to collect all reference definitions before it can accurately tokenize inline text.

`@lezer/markdown` deliberately foregoes this multi-pass validation for the sake of speed. It parses `[a][b]` as a link immediately, regardless of whether the definition exists. In the context of a WYSIWYG editor, this deviation is actually a significant advantage. If a user is actively typing a reference definition at the bottom of the document, a strictly compliant parser would constantly invalidate and re-validate all corresponding links throughout the document on every keystroke, causing severe syntax highlighting flicker and invalidating massive sections of the syntax tree. By decoupling the inline link syntax from the block-level definition validation, `@lezer/markdown` isolates the edit boundaries. GFM features, including tables, task lists, and autolinks, are provided as first-class extensions bundled within the core package.

### Extension API and Expressivity

The extension architecture is governed by the `MarkdownConfig` interface, which allows developers to inject custom `NodeSpec` definitions, `BlockParser` logic, and `InlineParser` logic. The API is exceptionally expressive for intra-block syntax and is designed to gracefully handle malformed or incomplete edits.

For inline syntax like CriticMarkup, developers can define new structures using the `DelimiterType` interface. This interface allows for either automatic or manual delimiter resolution. If the `resolve` property is defined, the engine automatically matches symmetric delimiters when an inline context finishes, parsing the interior content according to the specified node type. For complex, asymmetric syntax—such as the substitution form (`{~~old~>new~~}`)—developers can omit the `resolve` property and utilize the `findOpeningDelimiter` and `takeContent` methods exposed by the `InlineContext`. This permits the manual tracking of arm-local containment. When the parser encounters the `~>` divider, it can explicitly command the engine to resolve or discard any pending emphasis markers within the "old" arm, ensuring that inline styles do not leak across the substitution boundary.

The API's expressive ceiling is encountered when attempting to natively parse non-hierarchical, multi-block constructs. The `BlockContext` object, which manages block-level parsing, tracks the depth of active parent blocks and dictates when a block terminates. Because Lezer enforces a strict hierarchy, attempting to natively model a CriticMarkup tag that opens in one block and closes in another using standard inline delimiters is architecturally impossible within the primary syntax tree. The engine's `resolveMarkers` function will simply fail to match a closing delimiter if it exists in a different block context, treating the opening delimiter as literal text.

However, Lezer's architecture provides a workaround via its `parseMixed` functionality. Introduced in Lezer 0.15.0, `parseMixed` allows for the injection of nested parsers over specific regions of the syntax tree. While this is primarily used for embedding HTML or LaTeX inside Markdown, it demonstrates that Lezer supports the concept of overlaid parsing data. For multi-block CriticMarkup, the editor would need to define the opening and closing `{++` and `++}` markers not as paired delimiters, but as standalone, unlinked token nodes. A secondary projection layer within the editor would then iterate over the Lezer syntax tree, maintaining a stack of active annotations, and programmatically synthesizing continuous multi-block DOM ranges based on the presence of these isolated marker nodes.

### Position Fidelity and Losslessness

`@lezer/markdown` operates directly on JavaScript strings and maps its positions natively to UTF-16 code units. The engine generates a highly optimized `TreeBuffer`, which stores node metadata—including node types, exact start offsets, end offsets, and byte lengths—in a contiguous `Uint16Array`. This architecture ensures flawless position fidelity. Every UTF-16 code unit, including arbitrary whitespace and mid-edit partial syntax, is accounted for, allowing seamless, mathematically exact mapping to the browser's DOM selection ranges.

### Incrementality and Error Tolerance

Incrementality is the foundational principle of the `@lezer/markdown` architecture. The parser consumes `TreeFragment` objects generated during previous parse cycles. When an edit occurs, the engine recalculates the minimum invalidation range. Unmodified blocks are reused entirely, avoiding re-tokenization. The parse executes in $O(n)$ time relative to the size of the edit, rather than the size of the entire document.

Error tolerance is deeply ingrained in the engine's design. When a user types an opening CriticMarkup bracket `{++` without a closing counterpart, the engine does not enter a catastrophic failure state or attempt to swallow the rest of the document. The `resolveMarkers` function simply identifies the delimiter as unresolved, and the syntax tree degrades the token to a standard text node. This guarantees that mid-edit prefixes never break the document's overall rendering pipeline.

### Maintenance Health and Deployments

Licensed under the MIT license, `@lezer/markdown` is actively maintained by Marijn Haverbeke, the lead developer of CodeMirror. It is the default Markdown parsing engine for CodeMirror 6 and is actively utilized in massive production deployments, including Replit and the Obsidian application ecosystem. The engine is highly stable and aggressively hardened against edge cases prevalent in real-time text editing.

## Architectural Evaluation: `micromark` (TypeScript)

`micromark` is a low-level, highly strict streaming parser that operates as a finite-state machine. It forms the foundational parsing layer for the `unified` and `remark` ecosystems. It is designed with an absolute focus on standard compliance, deliberately avoiding the syntactic shortcuts employed by other parsers.

### CommonMark Conformance and Deviations

Of all the engines evaluated, `micromark` possesses the highest degree of strictness regarding CommonMark compliance. It is engineered to mimic the precise behavior of the C reference parser (`cmark`) and the GitHub reference parser (`cmark-gfm`), passing thousands of rigorous compliance tests. It does not take shortcuts on link reference definitions; it performs the necessary scanning to ensure that links are only validated if their corresponding definitions exist. Support for GFM features is provided via official syntax extensions, guaranteeing exact parity with GitHub's rendering engine.

### Extension API and Expressivity

The extension architecture in `micromark` requires developers to construct `SyntaxExtension` objects that hook directly into the engine's internal finite-state machine. The API exposes low-level event handlers—such as `effects.enter`, `effects.consume`, and `effects.exit`—allowing developers to define new state transitions tied to specific character codes.

Building CriticMarkup syntax via this API offers immense power but requires significant compiler-engineering expertise. To implement the addition syntax (`{++`), a developer must bind a state transition to the character code `123` (the left curly brace). The state machine must then consume the subsequent `+` characters, emit a custom entry token, and transition into a new state designed to parse the interior text. Because developers have direct access to the state stack, enforcing arm-local containment and literal precedence is highly achievable; the custom state machine can be programmed to explicitly ignore or resolve emphasis tokens when crossing a substitution divider.

However, `micromark` enforces a rigid structural taxonomy that makes multi-block spans architecturally impossible via the public API. The engine classifies all parsed content into strict categories: `document`, `container`, `flow` (block-level constructs), and `text` (inline constructs). An inline token is inextricably bound to its parent flow token. When the state machine encounters a block-terminating sequence (such as a double newline character indicating the end of a paragraph), it unconditionally finalizes all active text-level states. It is fundamentally impossible to instruct a `micromark` text-level extension to remain open across a `flow` boundary. To support a multi-block CriticMarkup span, a developer would have to fork the engine and rewrite the core `document` routing logic, destroying the parser's adherence to the CommonMark spec.

### Position Fidelity and Losslessness

The engine is completely lossless and highly accurate. It tracks line, column, and exact offset positions for every generated token. Because the engine is executed in a JavaScript environment, the positional offsets natively represent UTF-16 code units, aligning perfectly with the TypeScript and DOM requirements of the Profile 1 specification.

### Incrementality and Error Tolerance

`micromark` is designed as a single-pass stream parser. It does not possess any native mechanisms for incremental reparsing, fragment reuse, or partial tree updates. By default, a single keystroke in a 10,000-word document requires `micromark` to re-evaluate the entire stream from the first character.

While incrementality is not provided natively, it is theoretically buildable. Advanced implementations in the broader ecosystem, such as the `Incremark` project, have successfully built incremental wrappers around the engine. This is achieved by implementing an external block-caching layer. When an edit occurs, the wrapper calculates which specific blocks have been modified, extracts the localized text, feeds only that subset into the `micromark` state machine, and grafts the resulting tokens back into a cached Abstract Syntax Tree (AST). While possible, building this dual-engine caching architecture is a massive undertaking that carries high engineering risk.

Regarding error tolerance, `micromark` handles mid-edit, malformed input gracefully. Unclosed tags do not crash the state machine; the machine simply fails to match the closing sequence, backtracks, and interprets the opening characters as literal text tokens.

### Maintenance Health and Deployments

`micromark` is licensed under MIT and is maintained by Titus Wormer (wooorm). It serves as the bedrock for the `remark` ecosystem and the MDX compiler, meaning it processes millions of documents daily in production environments like Next.js, Gatsby, and enterprise documentation systems. The codebase is exceptionally mature and heavily fuzzed against malicious inputs.

## Architectural Evaluation: `pulldown-cmark` (Rust)

`pulldown-cmark` is a pull parser implemented in pure Rust. Unlike parsers that build massive in-memory trees, a pull parser operates as a highly optimized iterator. It consumes Markdown text and yields a sequence of typed events (`Event::Start`, `Event::Text`, `Event::End`) on demand. By utilizing zero-copy string references (`CowStr`) and avoiding heap allocations wherever possible, it achieves extraordinary raw parsing speed, routinely outperforming JavaScript-based engines by several orders of magnitude on large batch workloads.

### CommonMark Conformance and Deviations

The engine is highly compliant with CommonMark and supports crucial GFM extensions—such as tables, task lists, and footnotes—which can be toggled via bitflags (`ENABLE_GFM`, `ENABLE_TABLES`, `ENABLE_FOOTNOTES`).

Historically, the pull-parsing architecture has struggled with pathological edge cases involving deeply nested, unmatched delimiters. Because a pull parser cannot look ahead efficiently, it must scan forward through the text to confirm whether a potential closing delimiter exists before it can definitively yield an opening event. In extreme cases involving thousands of unclosed formatting marks, this forward-scanning requirement can result in $O(n^2)$ performance degradation. While recent optimizations have mitigated many of these vectors, the architectural vulnerability remains a consideration for hostile inputs.

### Extension API and Expressivity

`pulldown-cmark` deliberately omits a dynamic, public extension API for injecting arbitrary syntax. The parser's logic is hardcoded into internal, low-level byte-scanning loops, and the output types are strictly defined by the internal `Event` and `Tag` enums.

Attempting to implement CriticMarkup as an intrinsic syntax requires a hard fork of the repository. A developer would need to modify the core `scan_inline` loops, implement custom delimiter stacks to handle arm-local containment, and add `CriticAdd`, `CriticDel`, and `CriticSub` variants to the engine's public API.

Furthermore, even if the engine is forked, supporting multi-block annotation spans remains architecturally intractable. The iterator guarantees that inline events (like text or emphasis) are strictly bounded by their surrounding block events. Yielding a `CriticAdd` event that spans across an `End(Tag::Paragraph)` and a subsequent `Start(Tag::Paragraph)` violates the fundamental invariants of the engine's consumer API, breaking any downstream renderer expecting well-formed nesting.

### Position Fidelity and WASM Offset Translation

The engine provides excellent position fidelity, offering an `into_offset_iter()` method that yields `(Event, Range)` tuples. However, because `pulldown-cmark` is written in Rust, it operates on native UTF-8 strings. The offsets it generates are **UTF-8 byte indices**, not UTF-16 code unit indices.

This presents a catastrophic performance bottleneck for an Electron/TypeScript WYSIWYG editor. The DOM and JavaScript engines mandate UTF-16 offsets for calculating cursor selection and range boundaries. If `pulldown-cmark` is used, every single keystroke must trigger a highly expensive, $O(n)$ mapping pass to translate the parser's UTF-8 byte offsets into UTF-16 code unit offsets.

### Incrementality and WASM Boundary Costs

`pulldown-cmark` is fundamentally a batch parser; it possesses no built-in mechanisms for incremental reparsing or partial updates.

To deploy this engine within MarkText's architecture, it must be compiled to WebAssembly (WASM). Operating a batch parser across a WASM boundary on every keystroke introduces severe latency. The execution flow for a single typed character requires:

1. The TypeScript host serializing the entire document to a UTF-8 byte array.
2. The byte array being copied across the WASM memory boundary.
3. The Rust engine performing a full, non-incremental parse of the entire document.
4. The resulting event stream being serialized into an array of integers or JSON.
5. The data being copied back across the WASM boundary to the TypeScript host.
6. The host executing a linear scan to translate the UTF-8 offsets to UTF-16 offsets.

While `pulldown-cmark` parses text blazingly fast in native environments, the cumulative overhead of memory allocation, WASM serialization, and offset translation renders it completely unsuitable for real-time, low-latency keystroke updates in a browser environment.

### Maintenance Health and Deployments

The project is dual-licensed under MIT and Apache 2.0. It is the de facto standard Markdown parser in the Rust ecosystem, powering `rustdoc`, `mdBook`, and a myriad of high-performance static site generators. However, its design philosophy is strictly geared toward fast batch processing rather than interactive editor integration.

## Gap Analysis and Engineering Risk Assessment

To provide a concrete comparison, the following table maps the Profile 1 hard requirements against the capabilities of the three candidate engines, categorizing the necessary engineering effort as Provided, Buildable-on-API, Fork-Required, or Architecturally-Impossible.

| **Requirement**                              | **@lezer/markdown (TypeScript)**                                                  | **micromark (TypeScript)**                                                              | **pulldown-cmark (Rust)**                                                             |
| -------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Exact UTF-16 Code-Unit Offsets**           | **Provided**. Native JS string handling ensures flawless DOM mapping.             | **Provided**. Native JS execution yields perfect UTF-16 accuracy.                       | **Buildable**. Engine yields UTF-8; requires external $O(n)$ translation layer.       |
| **Error Tolerance on Mid-Edit States**       | **Provided**. Unclosed tags degrade to literal text; unaffected blocks preserved. | **Provided**. Gracefully backtracks to literal text on malformed input.                 | **Provided**. Though highly susceptible to $O(n^2)$ scans on pathological inputs.     |
| **Incremental Reparse (Per-Keystroke)**      | **Provided**. Natively consumes `TreeFragment` data for $O(n)$ updates.           | **Buildable**. Requires a massive external block-caching and state-injection wrapper.   | **Buildable**. Requires an external caching layer to mitigate WASM boundary overhead. |
| **CriticMarkup: Intrinsic Same-Pass Syntax** | **Buildable-on-API**. `DelimiterType` API permits manual containment logic.       | **Buildable-on-API**. FSM state transitions allow exact syntax emulation.               | **Fork-Required**. Must rewrite internal byte scanners and public `Tag` enums.        |
| **CriticMarkup: Multi-Block Spans**          | **Buildable-on-API**. Using standalone markers and a dynamic projection layer.    | **Architecturally-Impossible**. Strict Flow vs. Text isolation terminates inline rules. | **Architecturally-Impossible**. Pull iterator strictly enforces block containment.    |

### Assessing the Engineering Risk Profiles

Adopting `pulldown-cmark` carries an extreme risk profile. Forking the engine to add CriticMarkup places the burden of maintaining a diverging Rust codebase on the MarkText team. Furthermore, the WASM boundary costs and the necessity of building a highly optimized UTF-8 to UTF-16 translation layer for every keystroke introduce severe latency risks that directly impact the typing experience.

Adopting `micromark` presents a moderate-to-high risk profile. While it guarantees perfect CommonMark compliance, its lack of native incrementality forces the engineering team to build a complex, dual-engine caching architecture. Furthermore, its strict structural taxonomy makes the non-negotiable multi-block CriticMarkup requirement architecturally impossible to implement without violating the engine's core parsing assumptions.

Adopting `@lezer/markdown` presents a low-to-moderate risk profile. Incrementality, exact offset mapping, and error tolerance are provided out of the box. The primary engineering effort involves writing the custom `InlineParser` logic for CriticMarkup and utilizing a secondary view-projection layer to synthesize multi-block spans from standalone marker nodes. Because Lezer was purpose-built for editor integration, its architecture aligns perfectly with MarkText's goals.

## Build vs. Adopt Verdict and Final Recommendations

### The Build vs. Adopt Verdict

**The conclusive verdict is to abandon the 15,000-line custom engine and adopt an existing headless parser.**

The desire to finish the custom engine is a classic manifestation of the sunk cost fallacy. Writing a robust, highly optimized, and mathematically precise Markdown parser is not a product engineering task; it is a specialized compiler engineering problem. The CommonMark specification is littered with treacherous edge cases involving nested list tightness, HTML block termination conditions, and indented code blocks that overlap with blockquotes. Attempting to finalize an 8,500-line recognition layer to achieve perfect CommonMark compliance—while simultaneously inventing an $O(n)$ incremental tree-recycling algorithm from scratch—is an endeavor that requires thousands of hours of dedicated compiler development.

Furthermore, a custom parser would lack the rigorous fuzzing, security hardening, and community-driven edge-case testing that established engines receive automatically. By adopting a hardened headless engine, the MarkText engineering team can instantly shift its focus away from parsing algorithms and redirect its velocity toward building domain-specific product features: the CriticMarkup integration, the DOM projection layers, and the collaborative editing experience.

### Ranked Engine Recommendation

1. **`@lezer/markdown`**: This is the definitive choice. It natively solves the three hardest computer science problems associated with building a WYSIWYG editor: $O(n)$ incremental reparsing, exact UTF-16 offset mapping, and error-tolerant Concrete Syntax Tree generation. Its public extension API is highly flexible, and its block-context mechanics provide a viable workaround for the multi-block span requirement via a secondary projection layer.
2. **`micromark`**: A theoretically sound secondary option, but only if absolute, mathematically perfect CommonMark compliance is prioritized over out-of-the-box incrementality. The requirement to build a massive external caching wrapper to achieve acceptable keystroke latency, combined with the impossibility of natively modeling multi-block spans, makes this a grueling path.
3. **`pulldown-cmark`**: Disqualified for this specific architecture. The necessity of a hard fork, the structural impossibility of multi-block spans, and the cumulative latency of WASM serialization and UTF-8 offset translation render it entirely unsuitable for a real-time Electron/TypeScript editing environment.

### The Highest-Risk Technical Unknown and the De-Risking Spike

**The Unknown**: The interaction between Lezer's eager block parser and the necessity of resolving CriticMarkup delimiters across block boundaries. If CriticMarkup delimiters are parsed strictly using Lezer's automated `resolve` property, the engine will fail to match an opening bracket `{++` in one paragraph with a closing bracket `++}` in a subsequent list, degrading them to literal text rather than forming a cohesive annotation.

**The Spike Definition**: To de-risk this architectural unknown, the engineering team must execute a tightly scoped, two-week spike utilizing `@lezer/markdown`. The objective is to validate that a secondary view-projection layer can successfully synthesize continuous ranges from isolated boundary nodes.

1. **Bypass Automated Resolution**: The spike must avoid Lezer's default `DelimiterType.resolve` property. Instead, the team must implement custom `InlineParser` logic that emits standalone, unlinked syntax nodes for the boundaries (e.g., `CriticAddOpen` and `CriticAddClose`), ensuring they do not fail to parse when separated by a block boundary.
2. **Construct the Projection Layer**: The team must build a lightweight tree-traversal layer that iterates over the generated Lezer `TreeCursor`. This layer will maintain a state stack of active annotations. When it encounters a `CriticAddOpen` node, it flags the current range state as "addition" and applies that state to all subsequent text nodes, paragraph nodes, and list nodes until it encounters the corresponding `CriticAddClose` node.
3. **Benchmark the Synthesis**: The spike must measure the execution time of this projection layer on a 10,000-word document with heavily nested, multi-block CriticMarkup spans. If the layer can successfully synthesize continuous DOM ranges from the isolated Lezer boundary nodes in under 2 milliseconds per keystroke, the architecture is fully validated, clearing the path for robust WYSIWYG integration.
