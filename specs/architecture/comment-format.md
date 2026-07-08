# Comment Wire Format (v2)

The Markdown file is the sole source of truth. No sidecars, databases, or
hidden project metadata. Everything below travels inside the `.md` bytes.

Git is the collaboration model, so the format is designed for **line-oriented
merging and legible diffs**: every reply is its own line, thread status is its
own line, and appending a reply touches exactly one line. v1's single opaque
base64 line per thread made any two parallel touches to the same thread an
unmergeable, unreviewable conflict; v2 makes the common cases (edits to
different replies, a resolve concurrent with a reply, replies to different
threads) merge cleanly in plain `git merge`, and makes the remaining
same-point add/add conflicts human-legible and trivially unionable.

## Grammar owner

`packages/muya/src/comments/syntax.ts` owns the wire format. Every consumer —
parser extensions, the extraction/materialization layer
([comment-anchors.md](comment-anchors.md)), the file-level analyzer, desktop
source mode, and the agent CLI — derives recognition and serialization from
this module. Hand-built marker or definition strings anywhere else are
defects.

## Inline range markers (unchanged from v1)

```md
This paragraph has <!--MC:cmt_123-->reviewed text<!--MC:~cmt_123--> inside it.
```

- `<!--MC:id-->` opens a range; `<!--MC:~id-->` closes it. `id` matches
  `\w[\w-]*`.
- Close ids are explicit so ranges can overlap arbitrarily; overlap is never
  modeled as nesting. Ranges may span blocks.

## Thread metadata (v2)

One **head line** per thread and one line per reply, in the metadata appendix
(conventionally the end of the file):

```md
[MC:cmt_123]: {"version":2,"status":"open","authors":["Ada"],"createdAt":"2026-07-07T09:00:00.000Z"}
[MC:cmt_123.0]: {"author":"Ada","createdAt":"2026-07-07T09:00:00.000Z","body":"First line\nsecond line"}
[MC:cmt_123.1]: {"author":"Agent","createdAt":"2026-07-07T09:05:00.000Z","body":"Reply text"}
```

- **Head line** `[MC:id]: {json}` — compact single-line JSON (no literal
  newlines by construction), stable key order
  (`version,status,authors,createdAt,updatedAt,display`). `replies` never
  appears on the head line.
- **Reply line** `[MC:id.N]: {json}` — `N` is the zero-based reply index;
  stable key order (`author,createdAt,body,display`). Newlines and quotes in
  bodies are JSON-escaped, keeping every line self-contained.
- Up to three leading spaces are allowed (CommonMark definition indentation),
  matched by the same line grammar as v1.

### Merge-friendliness rules

- **Appending a reply writes exactly one new line.** It must not rewrite the
  head line: thread `updatedAt` is **derived at read time** as
  `max(head.updatedAt ?? head.createdAt, replies[].createdAt)`. Writers set
  head `updatedAt` only for head-level changes (status, authors, display).
- **Reply indexes are positional, not identity.** After a Git merge, indexes
  may duplicate or gap (`.1` twice, or `.0` then `.2`); readers order replies
  by document position and treat the numeric suffix as a hint only.
  Duplicate/gapped indexes are normalized whenever a thread's lines are
  fully re-serialized (materialization on save, a v1 upgrade, a new-thread
  insertion), never diagnosed as errors. Surgical mutations
  (`updateCommentMetadataInMarkdown`, the CLI) deliberately keep untouched
  lines byte-for-byte — stale index labels included — so parallel Git edits
  stay mergeable; indexes are positional hints, so both behaviors read
  identically
- **Reply lines attach by id, ordered by position.** They conventionally
  follow their head line contiguously, but interleaving (a merge artifact)
  parses fine. A reply line whose id has no head line is an
  `orphan-reply` diagnostic (the thread data is preserved verbatim).
- A thread's lines serialize head-first then replies in order, as one
  contiguous block at the thread's definition-run position (the placement
  recorded at load — [comment-anchors.md](comment-anchors.md)); threads
  created at runtime append to the trailing appendix in creation order.

### v1 compatibility

v1 lines — `[MC:id]: data:application/json;base64,...` with an embedded
`replies` array — are **read forever, written never**. Any serialization
(save, CLI mutation, materialization) emits v2. Mixed files (v1 + v2 lines
for different threads) read correctly; a v1 and v2 definition for the *same*
id is `duplicate-metadata`, exactly like two v1 lines.

## Payload schema

```ts
// Head
{
  version: 2,
  status: 'open' | 'resolved',
  authors?: string[],
  createdAt?: string,          // ISO-8601
  updatedAt?: string,          // head-level changes only; thread updatedAt derived
  display?: Record<string, unknown>
}
// Reply
{
  author: string,
  createdAt: string,           // ISO-8601
  body: string,
  display?: Record<string, unknown>
}
```

- Payloads never store anchor offsets, repair coordinates, or alternate
  anchors. The markers are the anchors.
- Malformed JSON on any line is preserved byte-for-byte through load/save and
  surfaces as `invalid-metadata` (head) or `invalid-reply` (reply line).

## Diagnostics

The closed set from v1 remains, plus reply-line codes:
`duplicate-open-marker`, `duplicate-close-marker`, `duplicate-metadata`,
`invalid-metadata`, `malformed-marker`, `missing-metadata`,
`orphan-close-marker`, `orphan-metadata`, `parse-error`,
`unclosed-open-marker`, **`orphan-reply`**, **`invalid-reply`**.
Diagnostics are visible, never blocking.

## Literal contexts (unchanged)

Marker- and definition-shaped text inside fenced/indented code, math blocks,
diagrams, front matter, and true raw HTML blocks is literal text: no ranges,
no threads, no diagnostics, no mutation by any tool.

## Properties pinned by tests

1. v2 round-trips byte-identically for canonical-byte lines (including
   duplicate and malformed lines, which survive verbatim). Decodable
   payloads re-serialize in canonical form — compact single-line JSON,
   stable key order, unescaped non-ASCII, unindented label — so
   non-canonical-but-decodable bytes normalize on the first save.
2. v1 documents load with full fidelity and serialize as v2 with identical
   decoded content.
3. `git`-style line merge (our own diff3 engine as the oracle): (a) parallel
   edits to *different* replies of one thread merge cleanly; (b) a
   status change concurrent with a reply merges cleanly; (c) parallel *new*
   replies at the same point conflict **legibly** — two readable lines — and
   the union of both lines parses as a valid two-reply thread.
4. Appending a reply changes exactly one line of the file; appending to a
   file without a final newline also terminates it, so the next append no
   longer churns the last line.
