# Comment Wire Format

The Markdown file is the sole source of truth. No sidecars, databases, or
hidden project metadata. Everything below travels inside the `.md` bytes.

## Grammar owner

`packages/muya/src/comments/syntax.ts` is the single owner of the MC wire
format. Every consumer — the base parser, the inline tokenizer, the comment
analyzer, desktop source mode, and (by byte-compatible contract) the agent
CLI — derives marker and definition recognition from this module's exported
patterns and parse/serialize helpers. Hand-built marker strings anywhere else
are defects.

## Inline range markers

```md
This paragraph has <!--MC:cmt_123-->reviewed text<!--MC:~cmt_123--> inside it.
```

- `<!--MC:id-->` opens a range; `<!--MC:~id-->` closes that same range.
- `id` matches `\w[\w-]*` (`COMMENT_ID_PATTERN`). Ids are attribute-selector
  and regex safe by construction.
- Close ids are explicit so ranges can overlap arbitrarily; overlap is not
  tree-shaped and must never be modeled as nesting:

```md
<!--MC:a-->alpha <!--MC:b-->beta<!--MC:~a--> gamma<!--MC:~b-->
```

- Ranges may span multiple blocks (open and close markers in different leaf
  blocks).

## Metadata definitions

```md
[MC:cmt_123]: data:application/json;base64,eyJ2ZXJzaW9uIjoxLCAuLi59
```

- One reference-style definition line per thread, conventionally at the end
  of the file, matched by `COMMENT_METADATA_DEFINITION_REGEXP`
  (`^ {0,3}\[MC:([^\]\s]+)\]:(.*)$`). Up to three leading spaces are allowed,
  mirroring CommonMark definition indentation.
- The payload is `data:application/json;base64,` followed by base64 JSON.
  Base64 decoding is forgiving of embedded ASCII whitespace (`atob`
  semantics); everything else invalid is a diagnostic, never a silent repair.
- Malformed payloads and duplicate ids are preserved byte-for-byte through
  load/save so diagnostics can report them (see parser-integration.md).

## Payload schema (version 1)

Decoded JSON must match `ICommentMetadata`
(`packages/muya/src/comments/types.ts`):

```ts
{
  version: 1,
  status: 'open' | 'resolved',
  authors?: string[],
  createdAt?: string,          // ISO-8601
  updatedAt?: string,          // ISO-8601
  display?: Record<string, unknown>,
  replies: Array<{
    author: string,
    createdAt: string,         // ISO-8601
    body: string,
    display?: Record<string, unknown>
  }>
}
```

- Encoding uses stable key ordering so an edit to one thread does not churn
  unrelated metadata bytes.
- The payload must never store anchor offsets, repair coordinates, or
  alternate anchors. The markers are the anchors.

## Derived analysis

`analyzeMarkdownComments` produces `IParsedMarkdownComments`:

- `threads` — decoded metadata joined to its id.
- `ranges` — derived transiently by scanning open/close marker events over
  parser/state text coordinates (`TBlockPath` + character offsets). Range
  coordinates are never persisted.
- `diagnostics` — the complete closed set of codes
  (`TCommentDiagnosticCode`): `duplicate-open-marker`,
  `duplicate-close-marker`, `duplicate-metadata`, `invalid-metadata`,
  `malformed-marker`, `missing-metadata`, `orphan-close-marker`,
  `orphan-metadata`, `parse-error`, `unclosed-open-marker`. Diagnostics are
  visible, never blocking: a malformed document still opens and saves with
  its bytes intact.

## Literal contexts

Marker- and definition-shaped text inside fenced/indented code, math blocks,
diagrams, front matter, and true raw HTML blocks is literal text: no ranges,
no threads, no diagnostics, no mutation by any tool.
