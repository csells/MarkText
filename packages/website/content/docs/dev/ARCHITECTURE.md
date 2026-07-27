# Project architecture

MarkText is a pnpm workspace with four product packages:

- `packages/document-core`: exact-source Markdown and CriticMarkup engine
- `packages/document-view`: browser view and input adapter
- `packages/desktop`: Electron main, preload, renderer, and tests
- `packages/website`: documentation website

## Document ownership

`@marktext/document-core` is the sole document authority. It owns parsing,
projections, source coordinates, immutable revisions, selection, history,
editing intents, Review indexes, and static materialization. It does not depend
on browser DOM, Vue, Pinia, or Electron.

`@marktext/document-view` mounts engine render plans and maps browser input and
selection back to parser-issued model positions. It does not parse or serialize
Markdown and does not maintain another document state.

The Electron main process owns durable document sessions, file IO, native
presentation, and static sinks. The renderer hosts the direct view and presents
application UI. Source mode is a projection/input surface over that same
session; it has no parser, document buffer, or history of its own.

## Electron processes

- **Main** starts once per application instance. It owns windows, filesystem
  access, durable sessions, native menus and dialogs, and save/export sinks.
- **Preload** exposes the narrow typed bridge available to the sandboxed
  renderer.
- **Renderer** starts once per editor window. It hosts Vue, Pinia,
  `@marktext/document-view`, and the Source projection surface.

Main and renderer communicate asynchronously through the typed IPC contract in
`packages/desktop/src/shared/types/ipc.ts`. Renderer code must not access Node
or Electron APIs directly.

## Opening and editing a document

1. Main admits one exact UTF-8/UTF-16 file snapshot, including BOM, EOL, and
   final-EOL distinctions.
2. Main opens a document-core session and issues a capability token for the
   owning renderer frame.
3. The renderer mounts the session's render plan through document-view.
4. Browser input becomes a typed engine intent.
5. The session commits one immutable revision and publishes the next render and
   Review snapshot.
6. Save flushes admitted work, leases canonical source from the session, and
   writes it through the main-owned exact snapshot.

Source mode reads and replaces canonical source through this same owner. DOM
text is never used as persistence input.

## Repository outputs

Electron build output is written under `packages/desktop/out/`. Packaged
installers are written under the repository `dist/` directory. Product tests
live with their package; desktop end-to-end tests use real Electron events.
