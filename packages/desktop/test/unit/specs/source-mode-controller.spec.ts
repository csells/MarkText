import { describe, expect, it, vi } from 'vitest'
import {
  createSourceModeController,
  type SourceModeDocumentPort,
  type SourceModePublication
} from '@/components/editorWithTabs/sourceModeController'

const cleanHistory = Object.freeze({
  canUndo: false,
  canRedo: false,
  dirty: false,
  headIdentity: 'document:1:history:0',
  savedIdentity: 'document:1:history:0'
})

const initialPublication = (): SourceModePublication => Object.freeze({
  documentId: 'document:1',
  revisionId: 'revision:1',
  source: 'before {++kept++} after\r\n',
  selection: Object.freeze({ anchor: 0, focus: 0 }),
  history: cleanHistory,
  outline: Object.freeze([])
})

describe('source-mode controller', () => {
  it('submits one source-range intent per gesture and mounts only the verified publication', async() => {
    let publication = initialPublication()
    const listeners = new Set<(next: SourceModePublication) => void>()
    const edit = vi.fn<SourceModeDocumentPort['edit']>(async request => {
      expect(request).toEqual({
        revisionId: 'revision:1',
        start: 0,
        end: 6,
        text: 'BEFORE',
        selection: { anchor: 6, focus: 6 }
      })
      publication = Object.freeze({
        ...publication,
        revisionId: 'revision:2',
        source: 'BEFORE {++kept++} after\r\n',
        selection: request.selection,
        history: Object.freeze({
          ...cleanHistory,
          canUndo: true,
          dirty: true,
          headIdentity: 'document:1:history:1'
        })
      })
      for (const listener of listeners) listener(publication)
      return publication
    })
    const port: SourceModeDocumentPort = {
      snapshot: () => publication,
      subscribe: listener => {
        listeners.add(listener)
        return Object.freeze({ dispose: () => listeners.delete(listener) })
      },
      edit,
      cut: edit,
      copy: async() => {},
      paste: async() => publication,
      insertImage: async() => publication,
      select: async() => publication,
      undo: async() => publication,
      redo: async() => publication,
      settled: async() => {}
    }
    const mount = vi.fn()
    const controller = createSourceModeController(port, {
      mount,
      preview: vi.fn()
    })

    controller.start()
    await controller.edit({
      start: 0,
      end: 6,
      text: 'BEFORE',
      selection: { anchor: 6, focus: 6 }
    })

    expect(edit).toHaveBeenCalledTimes(1)
    expect(mount).toHaveBeenLastCalledWith(publication)
    expect(publication.source).toBe('BEFORE {++kept++} after\r\n')
    controller.destroy()
  })

  it('serializes pending gestures against each verified revision without mounting an intermediate draft', async() => {
    let publication: SourceModePublication = Object.freeze({
      ...initialPublication(),
      source: 'abc'
    })
    const listeners = new Set<(next: SourceModePublication) => void>()
    const releases: Array<() => void> = []
    const edit = vi.fn<SourceModeDocumentPort['edit']>(request =>
      new Promise(resolve => {
        releases.push(() => {
          const source = publication.source.slice(0, request.start) +
            request.text +
            publication.source.slice(request.end)
          const sequence = Number(publication.revisionId.split(':')[1]) + 1
          publication = Object.freeze({
            ...publication,
            revisionId: `revision:${sequence}`,
            source,
            selection: request.selection
          })
          for (const listener of listeners) listener(publication)
          resolve(publication)
        })
      })
    )
    const port: SourceModeDocumentPort = {
      snapshot: () => publication,
      subscribe: listener => {
        listeners.add(listener)
        return Object.freeze({ dispose: () => listeners.delete(listener) })
      },
      edit,
      cut: edit,
      copy: async() => {},
      paste: async() => publication,
      insertImage: async() => publication,
      select: async() => publication,
      undo: async() => publication,
      redo: async() => publication,
      settled: async() => {}
    }
    const mount = vi.fn()
    const controller = createSourceModeController(port, {
      mount,
      preview: vi.fn()
    })
    controller.start()

    const first = controller.edit({
      start: 1,
      end: 1,
      text: 'X',
      selection: { anchor: 2, focus: 2 }
    })
    const second = controller.edit({
      start: 2,
      end: 2,
      text: 'Y',
      selection: { anchor: 3, focus: 3 }
    })
    await vi.waitFor(() => expect(edit).toHaveBeenCalledTimes(1))
    releases.shift()?.()
    await vi.waitFor(() => expect(edit).toHaveBeenCalledTimes(2))
    expect(edit.mock.calls[1]?.[0]).toMatchObject({
      revisionId: 'revision:2',
      start: 2,
      end: 2,
      text: 'Y'
    })
    expect(mount).toHaveBeenCalledTimes(1)
    releases.shift()?.()
    await Promise.all([first, second])

    expect(publication.source).toBe('aXYbc')
    expect(mount).toHaveBeenCalledTimes(2)
    expect(mount).toHaveBeenLastCalledWith(publication)
    controller.destroy()
  })

  it('rolls the surface back to the verified publication and rejects dependent gestures', async() => {
    const publication = Object.freeze({
      ...initialPublication(),
      source: 'abc'
    })
    const edit = vi.fn<SourceModeDocumentPort['edit']>(
      async() => { throw new Error('rejected by main') }
    )
    const port: SourceModeDocumentPort = {
      snapshot: () => publication,
      subscribe: () => Object.freeze({ dispose: () => {} }),
      edit,
      cut: edit,
      copy: async() => {},
      paste: async() => publication,
      insertImage: async() => publication,
      select: async() => publication,
      undo: async() => publication,
      redo: async() => publication,
      settled: async() => {}
    }
    const mount = vi.fn()
    const controller = createSourceModeController(port, {
      mount,
      preview: vi.fn()
    })
    controller.start()

    const rejected = controller.edit({
      start: 1,
      end: 1,
      text: 'X',
      selection: { anchor: 2, focus: 2 }
    })
    const dependent = controller.edit({
      start: 2,
      end: 2,
      text: 'Y',
      selection: { anchor: 3, focus: 3 }
    })

    await expect(rejected).rejects.toThrow('rejected by main')
    await expect(dependent).rejects.toThrow('depended on a rejected publication')
    expect(edit).toHaveBeenCalledTimes(1)
    expect(mount).toHaveBeenLastCalledWith(publication)
    controller.destroy()
  })

  it('queues a semantic image request through the source document port', async() => {
    let publication = initialPublication()
    const inserted = Object.freeze({
      ...publication,
      revisionId: 'revision:2',
      source: '![cat](images/cat.png)'
    })
    const insertImage = vi.fn<SourceModeDocumentPort['insertImage']>(
      async request => {
        expect(request).toEqual({
          src: 'images/cat.png',
          alt: 'cat'
        })
        publication = inserted
        return publication
      }
    )
    const controller = createSourceModeController({
      snapshot: () => publication,
      subscribe: () => Object.freeze({ dispose: () => {} }),
      edit: async() => publication,
      cut: async() => publication,
      copy: async() => {},
      paste: async() => publication,
      insertImage,
      select: async() => publication,
      undo: async() => publication,
      redo: async() => publication,
      settled: async() => {}
    }, {
      mount: vi.fn(),
      preview: vi.fn()
    })
    controller.start()

    await controller.insertImage({
      src: 'images/cat.png',
      alt: 'cat'
    })

    expect(insertImage).toHaveBeenCalledTimes(1)
    expect(publication).toBe(inserted)
    controller.destroy()
  })

  it('mounts a main-owned clipboard paste without previewing clipboard text', async() => {
    let publication = initialPublication()
    const pasted = Object.freeze({
      ...publication,
      revisionId: 'revision:2',
      source: 'before PASTED after\r\n',
      selection: Object.freeze({ anchor: 13, focus: 13 })
    })
    const paste = vi.fn<SourceModeDocumentPort['paste']>(
      async request => {
        expect(request).toEqual({
          revisionId: 'revision:1',
          selection: { anchor: 7, focus: 17 }
        })
        publication = pasted
        return publication
      }
    )
    const preview = vi.fn()
    const mount = vi.fn()
    const controller = createSourceModeController({
      snapshot: () => publication,
      subscribe: () => Object.freeze({ dispose: () => {} }),
      edit: async() => publication,
      cut: async() => publication,
      copy: async() => {},
      paste,
      insertImage: async() => publication,
      select: async() => publication,
      undo: async() => publication,
      redo: async() => publication,
      settled: async() => {}
    }, {
      mount,
      preview
    })
    controller.start()

    await controller.paste({ anchor: 7, focus: 17 })

    expect(paste).toHaveBeenCalledOnce()
    expect(preview).not.toHaveBeenCalled()
    expect(mount).toHaveBeenLastCalledWith(pasted)
    controller.destroy()
  })
})
