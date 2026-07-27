# Inter-Process Communication (IPC)

The renderer runs sandboxed (`contextIsolation: true`, `sandbox: true`,
`nodeIntegration: false` — see `src/main/config.ts`), so it can't import
`electron` directly. All renderer↔main traffic goes through the typed
preload bridge exposed in `src/preload/index.ts` as `window.electron.*`
and a few sibling globals (`window.fileUtils`, `window.path`,
`window.uploader`, etc.).

Channel names are typed by the contract in `src/shared/types/ipc.ts` —
wrong channel, wrong arg arity, or wrong return shape all fail at
`pnpm typecheck`. See [TYPESCRIPT.md](TYPESCRIPT.md#ipc-contract) for the
TypeScript-side details.

## Channel naming

Renderer↔main channels are prefixed with `mt::` (for example,
`mt::uploader::upload` and `mt::document-core::open-link`). The
`language-changed` internal event is the one named exception. New channels
must use `mt::`.

## The four channel categories

`src/shared/types/ipc.ts` defines four interfaces:

| Interface              | Direction          | Semantics                                  |
| ---------------------- | ------------------ | ------------------------------------------ |
| `IpcInvokeChannels`    | renderer → main    | `Promise<T>` round-trip (`ipcMain.handle`) |
| `IpcSendChannels`      | renderer → main    | fire-and-forget (`ipcMain.on`)             |
| `IpcSyncChannels`      | renderer → main    | synchronous reply (`event.returnValue`)    |
| `IpcMainEventChannels` | main → renderer    | push event (`webContents.send` / on)       |

Each entry tells you the args tuple and (for invoke/sync) the return
type:

```ts
'mt::uploader::upload': {
  args: [request: UploaderUploadRequest]
  ret: UploaderUploadReceipt
}
'mt::document-core::open-link': {
  args: [request: DocumentCoreOpenLinkRequest]
  ret: DocumentCoreOpenLinkReceipt
}
```

## Renderer side

Use the global `window.electron.ipcRenderer` (the typed wrapper exposed
by the preload bridge). Don't `import { ipcRenderer } from 'electron'` —
it isn't available under sandboxing.

```ts
// Round-trip
const receipt = await window.uploader.uploadImage({
  schema: 'uploader-upload-1',
  documentId,
  source: { kind: 'local-file', pathname: 'images/cat.png' }
})

const linkReceipt = await window.electron.ipcRenderer.invoke(
  'mt::document-core::open-link',
  { documentId, revisionId, targetNodeId }
)

// Fire-and-forget
window.electron.ipcRenderer.send('mt::cmd-open-file')

// Subscribe to a main → renderer push event (returns an unsubscribe fn)
const off = window.electron.ipcRenderer.on('mt::screenshot-captured', () => {
  // …
})
off()
```

`once()` and `removeAllListeners()` follow the same shape. Prefer the
smallest feature-specific typed bridge, such as `window.uploader.*`.
`window.fileUtils.*` and `window.path.*` contain only pure string helpers;
arbitrary renderer filesystem reads are not exposed.

## Main side

Channels are wired with `ipcMain.handle` (invoke), `ipcMain.on` (send /
sync), or `webContents.send` (push):

```ts
import { ipcMain } from 'electron'

ipcMain.handle('mt::uploader::upload', async (event, rawRequest: unknown) => {
  const request = decodeUploaderUploadRequest(rawRequest)
  const service = createUploaderService({
    describeDocument: documentId =>
      describeDocumentCoreFile(event.sender, documentId),
    readSettings: readUploaderSettings,
    resolvePicgoExecutable: resolveMainPicgoExecutable
  })
  return await service.upload(request)
})

ipcMain.handle('mt::document-core::open-link', async(event, rawRequest) => {
  const request = decodeDocumentCoreOpenLinkRequest(rawRequest)
  return await openParserOwnedDocumentLink(event.sender, request)
})

// Push to a specific renderer window:
window.webContents.send('mt::screenshot-captured', filePath)
```

Decode the complete closed request before looking up document ownership,
reading settings, or performing any effect. TypeScript types do not validate
data after it crosses IPC.

## Adding a new channel

1. Add an entry to the appropriate interface in
   `src/shared/types/ipc.ts` (pick invoke / send / sync / main-event
   based on the direction and shape).
2. Wire the main-process handler in `src/main/ipc/*.ts` (or the relevant
   feature module).
3. Call it from the renderer through `window.electron.ipcRenderer.*` or,
   if it deserves a dedicated facade, expose a method on one of the
   typed bridges in `src/preload/index.ts`.

After step 1, `pnpm typecheck` flags every existing call site that
doesn't match the new shape — use that as your update checklist.
