import { EventEmitter } from 'node:events'

export type InternalChannel =
  | 'app-create-editor-window'
  | 'app-create-settings-window'
  | 'app-new-untitled-tab-by-id'
  | 'app-open-directory-by-id'
  | 'app-open-file-by-id'
  | 'app-open-files-by-id'
  | 'app-open-markdown-by-id'
  | 'broadcast-preferences-changed'
  | 'broadcast-user-data-changed'
  | 'menu-add-recently-used'
  | 'menu-clear-recently-used'
  | 'screen-capture'
  | 'set-user-preference'
  | 'watcher-unwatch-all-by-id'
  | 'watcher-unwatch-directory'
  | 'watcher-unwatch-file'
  | 'watcher-watch-directory'
  | 'watcher-watch-file'
  | 'window-add-file-path'
  | 'window-change-file-path'
  | 'window-close-by-id'
  | 'window-file-saved'
  | 'window-remove-file-path'
  | 'window-reload-by-id'
  | 'window-toggle-always-on-top'

const internalBus = new EventEmitter()

export function onInternalChannel<TArgs extends unknown[]>(
  channel: InternalChannel,
  listener: (...args: TArgs) => void
): void {
  internalBus.on(channel, listener)
}

export function emitInternalChannel<TArgs extends unknown[]>(
  channel: InternalChannel,
  ...args: TArgs
): void {
  internalBus.emit(channel, ...args)
}
