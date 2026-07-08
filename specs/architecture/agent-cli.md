# Agent CLI (`skills/markdown-comments`)

Agents participate in review without a server, daemon, or editor process:
they run a repo-shipped CLI directly against `.md` files. The desktop app's
external-merge pipeline (external-merge.md) reconciles those on-disk writes
with any live editing session; the CLI itself never merges.

## Scope

Deliberately narrow: inspect, validate, reply to, resolve, reopen, and edit
MarkText `MC` comment threads. Ordinary document edits are direct file writes
by the agent, outside this tool.

## Commands

```
list <file>                       # deterministic JSON: threads, ranges, diagnostics
validate <file>                   # diagnostics for malformed comment structure
reply <file> <id> --author --body
resolve <file> <id>
reopen <file> <id>
edit <file> <id> [--status] [--authors] [--reply-index N --body …]
```

- `edit --reply-index` addresses a reply by deterministic index without
  rewriting sibling replies.
- `--encoding` supports legacy single-byte and UTF-16 files.
- JSON output is deterministic; range paths/offsets are muya parser/state
  text coordinates, not byte offsets, and are never persisted anchors.

## Consistency with the engine

The CLI's analysis and mutation are the engine's: `list`/`validate` consume
`analyzeMarkdownComments` and every metadata mutation goes through
`updateCommentMetadataInMarkdown`, both from `@muyajs/core/comments` — the
same authoritative code the desktop uses — so an agent and the editor can
never disagree about how a comment's bytes change. Analysis is
parse-option-sensitive at the margins (block context depends on parser
options): the CLI defaults to the engine defaults and accepts
`--footnote true|false` so an agent can match an editor whose footnote
preference is enabled. The skill package depends on `@muyajs/core` only —
never on Electron-tainted desktop modules.

## Byte preservation on mutation

A command that mutates one metadata definition preserves every unrelated
byte: UTF-8 BOM, mixed line separators, the target line's trailing
whitespace, and no-final-newline policy — with one deliberate exception:
appending a reply to a file without a final newline terminates the file,
so the next append no longer churns the last line in diff terms. Stable-key metadata encoding keeps
the definition's own churn minimal. Errors surface loudly — a corrupt
metadata payload is reported, not skipped.

## Tests

`skills/markdown-comments/test/` (run via `pnpm run test:skills`) covers the
command surface, encoding handling, and byte-preservation rules.
