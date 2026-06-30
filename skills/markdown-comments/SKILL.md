---
name: markdown-comments
description: Inspect, validate, and update MarkText portable inline comments stored directly in Markdown files with MC range markers and MC metadata references. Use when working on MarkText review comments, agent workflows around commented Markdown, or command-line edits to comment replies/status.
---

# Markdown Comments

Use this skill for MarkText-authored Markdown review comments. The Markdown file is canonical: comment ranges are `<!--MC:id-->...<!--MC:~id-->`, and thread metadata is stored in `[MC:id]: data:application/json;base64,...` reference definitions in the same file.

## CLI

Run the bundled TypeScript CLI with `pnpm exec tsx` from the repository root:

```bash
pnpm exec tsx skills/markdown-comments/src/cli.ts list path/to/file.md
pnpm exec tsx skills/markdown-comments/src/cli.ts validate path/to/file.md
pnpm exec tsx skills/markdown-comments/src/cli.ts reply path/to/file.md cmt_1 --author "Ada" --body "Looks good."
pnpm exec tsx skills/markdown-comments/src/cli.ts resolve path/to/file.md cmt_1
pnpm exec tsx skills/markdown-comments/src/cli.ts reopen path/to/file.md cmt_1
pnpm exec tsx skills/markdown-comments/src/cli.ts edit path/to/file.md cmt_1 --status resolved --authors "Ada,Grace"
```

`list` prints deterministic JSON with `threads`, `ranges`, and `diagnostics`. `validate` prints diagnostics and exits non-zero when malformed comments are present.

Mutation commands rewrite only the target metadata reference definition. They do not move range markers, normalize unrelated Markdown, create sidecar files, or start a server.

## Rules

- Preserve the Markdown file as the source of truth.
- Use the CLI for metadata-only changes when possible; it imports the same Muya parser and metadata codec used by the desktop editor.
- Do not invent alternate anchors, sidecars, CRDT documents, or external storage.
- Treat diagnostics as repair prompts, not as a reason to drop source bytes.
