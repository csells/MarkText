import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const pasteboardScript = `
ObjC.import('AppKit');
ObjC.import('Foundation');
function run(argv) {
  const board = $.NSPasteboard.generalPasteboard;
  if (argv[0] === 'count') {
    const count = Number(board.changeCount);
    const value = ObjC.unwrap(board.stringForType($.NSPasteboardTypeString));
    const text = typeof value === 'string' ? value : '';
    return text === argv[1] && count === Number(board.changeCount) ? String(count) : 'changed';
  }
  if (argv[0] === 'snapshot') {
    const items = [];
    const nativeItems = board.pasteboardItems;
    for (let i = 0; i < nativeItems.count; i++) {
      const item = nativeItems.objectAtIndex(i);
      const formats = {};
      for (let j = 0; j < item.types.count; j++) {
        const type = item.types.objectAtIndex(j);
        const data = item.dataForType(type);
        if (data) formats[ObjC.unwrap(type)] = ObjC.unwrap(data.base64EncodedStringWithOptions(0));
      }
      items.push(formats);
    }
    return JSON.stringify({ count: Number(board.changeCount), items });
  }
  if (Number(board.changeCount) !== Number(argv[2])) return 'changed';
  const snapshot = JSON.parse(ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(argv[1], $.NSUTF8StringEncoding, null)));
  const restored = $.NSMutableArray.alloc.init;
  for (const formats of snapshot.items) {
    const item = $.NSPasteboardItem.alloc.init;
    for (const type of Object.keys(formats)) {
      const data = $.NSData.alloc.initWithBase64EncodedStringOptions(formats[type], 0);
      item.setDataForType(data, type);
    }
    restored.addObject(item);
  }
  if (Number(board.changeCount) !== Number(argv[2])) return 'changed';
  board.clearContents;
  if (restored.count > 0 && !board.writeObjects(restored)) throw new Error('Clipboard restoration failed');
  return 'restored';
}
`

/** Preserve all macOS pasteboard items/formats without overwriting a newer user copy. */
export function preserveSystemClipboard(): { rememberOwnedWrite(text: string): void, restore(): void } {
  if (process.platform === 'win32' && process.env.GITHUB_ACTIONS === 'true' &&
      process.env.RUNNER_ENVIRONMENT === 'github-hosted' && process.env.MARKTEXT_E2E_PRIVATE_CLIPBOARD === '1') {
    // This disposable CI machine owns its clipboard. Local and self-hosted
    // Windows sessions still require a preservation implementation.
    return { rememberOwnedWrite: () => {}, restore: () => {} }
  }
  if (process.platform === 'linux' && process.env.MARKTEXT_E2E_PRIVATE_DISPLAY === '1' && process.env.DISPLAY) {
    // The runner owns this fresh Xvfb server; it cannot access a user's clipboard.
    return { rememberOwnedWrite: () => {}, restore: () => {} }
  }
  if (process.platform !== 'darwin') throw new Error('Native clipboard tests require macOS preservation or an isolated runner')
  const invoke = (...args: string[]): string => execFileSync('/usr/bin/osascript',
    ['-l', 'JavaScript', '-e', pasteboardScript, ...args], { encoding: 'utf8' }).trim()
  const backup = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-clipboard-backup-')), 'clipboard.json')
  const snapshot = invoke('snapshot')
  fs.writeFileSync(backup, snapshot, { mode: 0o600, flag: 'wx' })
  let ownedCount = Number(JSON.parse(snapshot).count)
  return {
    rememberOwnedWrite(text: string): void {
      const count = Number(invoke('count', text))
      if (Number.isFinite(count)) ownedCount = count
    },
    restore(): void {
      const result = invoke('restore', backup, String(ownedCount))
      // The backup contains user data and is deliberately retained, even after
      // restoration. A newer user copy always wins over restoration.
      console.log(`Clipboard ${result}; preserved backup: ${backup}`)
    }
  }
}
