---
name: markdown-comments
description: Inspect, validate, and update MarkText portable inline comments stored directly in Markdown files with MC range markers and MC metadata references. Use when working on MarkText review comments, agent workflows around commented Markdown, or command-line edits to comment replies/status.
---

# Markdown Comments

Use this skill for MarkText-authored Markdown review comments. The Markdown file is canonical: comment ranges are `<!--MC:id-->...<!--MC:~id-->`, and thread metadata is stored as line-oriented reference definitions in the same file (wire format v2):

```md
[MC:cmt_1]: {"version":2,"status":"open","authors":["Ada"],"createdAt":"2026-07-07T09:00:00.000Z"}
[MC:cmt_1.0]: {"author":"Ada","createdAt":"2026-07-07T09:00:00.000Z","body":"Looks good."}
```

One head line per thread plus one `[MC:id.N]:` line per reply, so parallel Git edits to the same thread merge line-by-line. Reply indexes are positional hints: readers order replies by document position. Thread `updatedAt` and participant `authors` are derived at read time from the head and reply lines. Legacy v1 lines (`[MC:id]: data:application/json;base64,...`) are read forever but never written — the first mutation of a v1 thread rewrites it as v2 lines with identical decoded content.

This skill is intentionally narrow. Use it to inspect, validate, reply to, resolve, reopen, or edit MarkText `MC` comment threads. Do not use it as a general Markdown writer, filesystem sync tool, or merge tool. For ordinary document edits, write the Markdown file directly; MarkText handles loaded-file reloads and on-disk conflict merging in the desktop app.

## CLI

Run the bundled TypeScript CLI with `pnpm exec tsx` from the repository root:

```bash
pnpm exec tsx skills/markdown-comments/src/cli.ts list path/to/file.md
pnpm exec tsx skills/markdown-comments/src/cli.ts validate path/to/file.md
pnpm exec tsx skills/markdown-comments/src/cli.ts reply path/to/file.md cmt_1 --author "Ada" --body "Looks good."
pnpm exec tsx skills/markdown-comments/src/cli.ts resolve path/to/file.md cmt_1
pnpm exec tsx skills/markdown-comments/src/cli.ts reopen path/to/file.md cmt_1
pnpm exec tsx skills/markdown-comments/src/cli.ts edit path/to/file.md cmt_1 --status resolved --authors "Ada,Grace"
pnpm exec tsx skills/markdown-comments/src/cli.ts edit path/to/file.md cmt_1 --reply-index 0 --body "Updated reply."
pnpm exec tsx skills/markdown-comments/src/cli.ts list legacy.md --encoding cp1252
pnpm exec tsx skills/markdown-comments/src/cli.ts list path/to/file.md --footnote true
```

`--footnote true` analyzes with footnote parsing on — use it when the target
project edits with MarkText's footnote preference enabled, so `list` and
`validate` see the same block structure the editor does.

`list` prints deterministic JSON with this shape:

```json
{
  "threads": [
    {
      "id": "cmt_1",
      "status": "open",
      "authors": ["Ada"],
      "updatedAt": "2026-06-30T15:00:00.000Z",
      "replies": [
        {
          "author": "Ada",
          "body": "Looks good.",
          "createdAt": "2026-06-30T14:00:00.000Z"
        }
      ]
    }
  ],
  "ranges": [
    {
      "id": "cmt_1",
      "startPath": [0, "text"],
      "startOffset": 10,
      "endPath": [0, "text"],
      "endOffset": 18,
      "preview": "reviewed text"
    }
  ],
  "diagnostics": []
}
```

`validate` prints only the diagnostics array and exits non-zero when malformed comments are present. Range paths and offsets are Muya parser/state text coordinates for locating comment anchors inside parsed Markdown state. They are not byte offsets and should not be written back as alternate anchors.

Mutation commands touch only the target thread's lines — appending a reply writes exactly one new `[MC:id.N]:` line, a status change rewrites exactly the head line — and never move range markers, normalize unrelated Markdown, create sidecar files, or start a server.

The CLI auto-detects UTF-8 Markdown files, UTF-8 files with a BOM, and BOM-marked UTF-16 Markdown files. For legacy files without a Unicode BOM, pass `--encoding <name>` with an `iconv-lite` encoding such as `cp1252`, `shiftjis`, `gbk`, or `big5`. When a mutation command edits one metadata definition, it preserves unrelated Markdown bytes as much as practical, including existing line separators, the original BOM, the original or explicitly requested encoding, trailing whitespace on the target metadata line, and whether the file has a final newline.

## Rules

- Preserve the Markdown file as the source of truth.
- Use the CLI for metadata-only changes when possible; it imports the same Muya parser and metadata codec used by the desktop editor.
- Let normal Markdown edits happen outside this skill. The skill does not arbitrate source edits, reload loaded tabs, or merge editor memory with disk files.
- Do not invent alternate anchors, sidecars, CRDT documents, or external storage.
- Treat diagnostics as repair prompts, not as a reason to drop source bytes.
- Prefer repairing comments by fixing the `<!--MC:id-->...<!--MC:~id-->` markers or the matching `[MC:id]:` head / `[MC:id.N]:` reply lines directly, then rerun `validate`.
