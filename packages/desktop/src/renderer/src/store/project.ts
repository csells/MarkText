import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { addFile, unlinkFile, addDirectory, unlinkDirectory, resortTree, updateFileMtime } from './treeCtrl'
import { usePreferencesStore } from './preferences'
import bus from '../bus'
import notice from '../services/notification'
import { useLayoutStore } from './layout'
import { useEditorStore } from './editor'
import { debouncedSendBufferedState } from './bufferedState'
import type { TreeNode } from '../components/sideBar/types'
import type { FileChangeDetail } from '@shared/types/files'
import { revealProjectEntry } from '../services/presentationEffects'

type ProjectTree = TreeNode
type TreeChange = FileChangeDetail

const normalizeProjectRoot = (pathname: string | null | undefined): string => {
  return pathname ? window.path.normalize(pathname) : ''
}

const createProjectRoot = (pathname: string): ProjectTree | null => {
  const normalizedPathname = normalizeProjectRoot(pathname)
  if (!normalizedPathname) return null

  let name = window.path.basename(normalizedPathname)
  if (!name) {
    // Root directory such as "/" or "C:\"
    name = normalizedPathname
  }

  return {
    pathname: normalizedPathname,
    name,
    isDirectory: true,
    isFile: false,
    isMarkdown: false,
    folders: [],
    files: []
  }
}

interface BufferedProjectState {
  rootDirectory: string
}

const createBufferedProjectState = (state: unknown): BufferedProjectState => {
  const s = (state || {}) as { rootDirectory?: string; projectTree?: { pathname?: string } }
  return {
    rootDirectory: normalizeProjectRoot(s.rootDirectory || s.projectTree?.pathname)
  }
}

interface OpenProjectOptions {
  scheduleBufferUpdate?: boolean
}

interface CreateCacheEntry {
  dirname: string
  type: 'file' | 'directory' | string
}

interface ClipboardEntry {
  type: 'copy' | 'cut' | string
  src: string
  kind: 'file' | 'directory'
}

interface PendingEvent {
  type: string
  change: TreeChange
}

export const useProjectStore = defineStore('project', () => {
  // Heterogeneous UI state: assigned file nodes, folder nodes, and the empty
  // "no selection" object/null across sidebar components; a single non-`any`
  // union breaks both the assignments and the field reads, so it stays a hatch.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeItem = ref<any>({})
  const createCache = ref<CreateCacheEntry | Record<string, never>>({})
  const renameCache = ref<string | null>(null)
  const clipboard = ref<ClipboardEntry | null>(null)
  const projectTree = ref<ProjectTree | null>(null)
  const pendingTreeEvents = ref<PendingEvent[]>([])

  const preferencesStore = usePreferencesStore()

  watch(
    [() => preferencesStore.fileSortBy, () => preferencesStore.fileSortOrder],
    ([sortBy, sortOrder]) => {
      if (projectTree.value) {
        resortTree(projectTree.value, String(sortBy), String(sortOrder))
      }
    }
  )

  function OPEN_PROJECT(
    pathname: string,
    { scheduleBufferUpdate = true }: OpenProjectOptions = {}
  ): void {
    const layoutStore = useLayoutStore()
    const tree = createProjectRoot(pathname)
    if (!tree) return

    projectTree.value = tree

    const layout = {
      rightColumn: 'files',
      showSideBar: true,
      showTabBar: true
    }
    layoutStore.SET_LAYOUT(layout, { scheduleBufferUpdate })
    layoutStore.DISPATCH_LAYOUT_MENU_ITEMS()

    // Process pending events that arrived before projectTree was initialized.
    for (const event of pendingTreeEvents.value) {
      _processTreeEvent(event.type, event.change)
    }
    pendingTreeEvents.value = []

    if (scheduleBufferUpdate) {
      debouncedSendBufferedState()
    }
  }

  function RESTORE_BUFFERED_STATE(state: unknown): void {
    const { rootDirectory } = createBufferedProjectState(state)
    if (rootDirectory) {
      if (projectTree.value?.pathname === rootDirectory) return
      OPEN_PROJECT(rootDirectory, { scheduleBufferUpdate: false })
    } else {
      projectTree.value = null
      pendingTreeEvents.value = []
    }
  }

  function LISTEN_FOR_LOAD_PROJECT(): void {
    window.electron.ipcRenderer.on('mt::open-directory', (_e, pathname) => {
      OPEN_PROJECT(String(pathname))
    })
  }

  function LISTEN_FOR_UPDATE_PROJECT(): void {
    window.electron.ipcRenderer.on('mt::update-object-tree', (_e, payload) => {
      const { type, change } = (payload as { type: string; change: TreeChange }) ?? {}
      if (!projectTree.value) {
        pendingTreeEvents.value.push({ type, change })
        return
      }
      _processTreeEvent(type, change)
    })
  }

  function _processTreeEvent(type: string, change: TreeChange): void {
    switch (type) {
      case 'add': {
        addFile(projectTree.value!, change as Parameters<typeof addFile>[1], String(preferencesStore.fileSortBy), String(preferencesStore.fileSortOrder))
        break
      }
      case 'unlink':
        unlinkFile(projectTree.value!, change)
        break
      case 'addDir':
        addDirectory(projectTree.value!, change)
        break
      case 'unlinkDir':
        unlinkDirectory(projectTree.value!, change)
        break
      case 'change':
        if (change?.mtimeMs !== undefined) {
          updateFileMtime(projectTree.value!, change as Parameters<typeof updateFileMtime>[1], String(preferencesStore.fileSortBy), String(preferencesStore.fileSortOrder))
        }
        break
      default:
        if (window.electron?.process?.env?.NODE_ENV === 'development') {
          console.log(`Unknown directory watch type: "${type}"`)
        }
        break
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function CHANGE_ACTIVE_ITEM(item: any): void {
    activeItem.value = item
  }

  function CHANGE_CLIPBOARD(data: ClipboardEntry | null): void {
    clipboard.value = data
  }

  function ASK_FOR_OPEN_PROJECT(): void {
    window.electron.ipcRenderer.send('mt::ask-for-open-project-in-sidebar')
  }

  function LISTEN_FOR_SIDEBAR_CONTEXT_MENU(): void {
    bus.on('SIDEBAR::show-in-folder', () => {
      const { pathname } = activeItem.value
      const root = projectTree.value?.pathname
      if (!root) return
      const entrySegments = window.path
        .relative(root, pathname)
        .split(/[\\/]/u)
        .filter(Boolean)
      revealProjectEntry(entrySegments)
    })
    bus.on('SIDEBAR::new', (type: unknown) => {
      const { pathname, isDirectory } = activeItem.value
      const dirname = isDirectory ? pathname : window.path.dirname(pathname)
      createCache.value = { dirname, type: String(type) }
      bus.emit('SIDEBAR::show-new-input')
    })
    bus.on('SIDEBAR::remove', () => {
      const { pathname, isDirectory } = activeItem.value
      const root = projectTree.value?.pathname
      if (!root) return
      const entrySegments = window.path
        .relative(root, pathname)
        .split(/[\\/]/u)
        .filter(Boolean)
      window.electron.ipcRenderer.invoke('mt::project::delete', {
        schema: 'project-delete-intent-1',
        kind: isDirectory === true ? 'directory' : 'file',
        entrySegments
      }).catch((err) => {
        notice.notify({
          title: 'Error while deleting',
          type: 'error',
          message: err instanceof Error ? err.message : String(err)
        })
      })
    })
    bus.on('SIDEBAR::copy-cut', (type: unknown) => {
      const { pathname: src, isDirectory } = activeItem.value
      clipboard.value = {
        type: String(type),
        src,
        kind: isDirectory === true ? 'directory' : 'file'
      }
    })
    bus.on('SIDEBAR::paste', async() => {
      const cb = clipboard.value
      const { pathname, isDirectory } = activeItem.value
      const dirname = isDirectory ? pathname : window.path.dirname(pathname)
      if (cb && cb.src) {
        const dest = window.path.join(
          dirname,
          window.path.basename(cb.src)
        )

        if (window.path.normalize(cb.src) === window.path.normalize(dest)) {
          notice.notify({
            title: 'Paste Forbidden',
            type: 'warning',
            message: 'Source and destination must not be the same.'
          })
          return
        }

        try {
          const root = projectTree.value?.pathname
          if (!root) {
            throw new Error(
              'Project copy or move requires a retained project root'
            )
          }
          const entrySegments = window.path
            .relative(root, cb.src)
            .split(/[\\/]/u)
            .filter(Boolean)
          const targetParentSegments = window.path
            .relative(root, dirname)
            .split(/[\\/]/u)
            .filter(Boolean)
          if (cb.type === 'cut') {
            const receipt = await window.electron.ipcRenderer.invoke(
              'mt::project::relocate',
              {
                schema: 'project-relocate-intent-1',
                kind: cb.kind,
                entrySegments,
                targetParentSegments,
                newName: window.path.basename(cb.src)
              }
            )
            if (receipt.document !== null) {
              useEditorStore().APPLY_PATH_RECEIPT(receipt.document)
            }
          } else {
            await window.electron.ipcRenderer.invoke(
              'mt::project::copy',
              {
                schema: 'project-copy-intent-1',
                kind: cb.kind,
                entrySegments,
                targetParentSegments
              }
            )
          }
          clipboard.value = null
        } catch (err) {
          notice.notify({
            title: 'Error while pasting',
            type: 'error',
            message: err instanceof Error ? err.message : String(err)
          })
        }
      }
    })
    bus.on('SIDEBAR::rename', () => {
      const { pathname } = activeItem.value
      renameCache.value = pathname
      bus.emit('SIDEBAR::show-rename-input')
    })
  }

  async function CREATE_FILE_DIRECTORY(name: string): Promise<void> {
    const cache = createCache.value as CreateCacheEntry
    const { dirname, type } = cache
    const root = projectTree.value?.pathname
    if (
      !root ||
      (type !== 'file' && type !== 'directory')
    ) {
      notice.notify({
        title: 'Error in Side Bar',
        type: 'error',
        message: 'Project creation requires an open project and a valid entry type.'
      })
      return
    }
    const relativeParent = window.path.relative(root, dirname)
    const parentSegments = relativeParent === ''
      ? []
      : relativeParent.split(/[\\/]/)
    try {
      await window.electron.ipcRenderer.invoke('mt::project::create', {
        schema: 'project-create-intent-1',
        kind: type,
        parentSegments,
        name
      })
    } catch (err) {
      notice.notify({
        title: 'Error in Side Bar',
        type: 'error',
        message: err instanceof Error ? err.message : String(err)
      })
    } finally {
      createCache.value = {}
    }
  }

  async function RENAME_IN_SIDEBAR(name: string): Promise<void> {
    const editorStore = useEditorStore()
    const src = renameCache.value
    const root = projectTree.value?.pathname
    if (!src || !root) return
    const relative = window.path.relative(root, src)
    const entrySegments = relative.split(/[\\/]/u).filter(Boolean)
    const kind = activeItem.value?.isDirectory === true
      ? 'directory'
      : 'file'
    try {
      const receipt = await window.electron.ipcRenderer.invoke(
        'mt::project::relocate',
        {
          schema: 'project-relocate-intent-1',
          kind,
          entrySegments,
          targetParentSegments: entrySegments.slice(0, -1),
          newName: name
        }
      )
      if (receipt.document !== null) {
        editorStore.APPLY_PATH_RECEIPT(receipt.document)
      }
    } catch (err) {
      notice.notify({
        title: 'Error in Side Bar',
        type: 'error',
        message: err instanceof Error ? err.message : String(err)
      })
    } finally {
      renameCache.value = null
    }
  }

  function OPEN_SETTING_WINDOW(): void {
    window.electron.ipcRenderer.send('mt::open-setting-window')
  }

  return {
    activeItem,
    createCache,
    renameCache,
    clipboard,
    projectTree,
    pendingTreeEvents,
    OPEN_PROJECT,
    RESTORE_BUFFERED_STATE,
    LISTEN_FOR_LOAD_PROJECT,
    LISTEN_FOR_UPDATE_PROJECT,
    CHANGE_ACTIVE_ITEM,
    CHANGE_CLIPBOARD,
    ASK_FOR_OPEN_PROJECT,
    LISTEN_FOR_SIDEBAR_CONTEXT_MENU,
    CREATE_FILE_DIRECTORY,
    RENAME_IN_SIDEBAR,
    OPEN_SETTING_WINDOW
  }
})
