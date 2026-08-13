import { describe, expect, it, vi } from 'vitest'

import {
  handoffCorePlainTextView,
  leaseCorePlainTextView
} from '@/documentAuthority/corePlainTextViewHandoff'
import type {
  CoreDocumentSessionManager,
  CoreDocumentViewLease
} from '@/documentAuthority'

describe('Core plain-text WYSIWYG handoff', () => {
  it('projects before acquiring the first WYSIWYG view lease', async() => {
    const lease = { documentId: 'direct.md' } as CoreDocumentViewLease
    const order: string[] = []
    const manager = {
      async plainTextViewBarrier(documentId: string) {
        expect(documentId).toBe('direct.md')
        order.push('project')
        return {
          type: 'plain-text-view',
          session: 1,
          sequence: 2,
          revision: 1,
          accepted: true,
          sourceLength: 7,
          source: 'direct\n',
          view: {
            kind: 'view',
            markdown: 'direct\n',
            bindings: []
          }
        }
      },
      async activate(documentId: string) {
        expect(documentId).toBe('direct.md')
        order.push('activate')
      },
      lease(documentId: string) {
        expect(documentId).toBe('direct.md')
        order.push('lease')
        return lease
      }
    } as Pick<
      CoreDocumentSessionManager,
      'plainTextViewBarrier' | 'activate' | 'lease'
    >

    await expect(leaseCorePlainTextView(manager, 'direct.md')).resolves.toEqual({
      lease,
      view: { kind: 'view', markdown: 'direct\n', bindings: [] }
    })
    expect(order).toEqual(['project', 'activate', 'lease'])
  })

  it('projects before releasing Source and returns the next view lease', async() => {
    const sourceLease = { documentId: 'plain.md' } as CoreDocumentViewLease
    const wysiwygLease = { documentId: 'plain.md' } as CoreDocumentViewLease
    const order: string[] = []
    const manager = {
      async plainTextViewBarrier() {
        order.push('project')
        return {
          type: 'plain-text-view',
          session: 1,
          sequence: 2,
          revision: 1,
          accepted: true,
          sourceLength: 6,
          source: 'plain\n',
          view: {
            kind: 'view',
            markdown: 'plain\n',
            bindings: []
          }
        }
      },
      async handoff(lease: CoreDocumentViewLease) {
        expect(lease).toBe(sourceLease)
        order.push('handoff')
      },
      async activate(documentId: string) {
        expect(documentId).toBe('plain.md')
        order.push('activate')
      },
      lease(documentId: string) {
        expect(documentId).toBe('plain.md')
        order.push('lease')
        return wysiwygLease
      }
    } as Pick<
      CoreDocumentSessionManager,
      'plainTextViewBarrier' | 'handoff' | 'activate' | 'lease'
    >

    await expect(handoffCorePlainTextView(manager, sourceLease)).resolves.toEqual({
      lease: wysiwygLease,
      view: { kind: 'view', markdown: 'plain\n', bindings: [] }
    })
    expect(order).toEqual(['project', 'handoff', 'activate', 'lease'])
  })

  it('leaves Source authoritative when the projection is unsupported', async() => {
    const sourceLease = { documentId: 'structural.md' } as CoreDocumentViewLease
    const handoff = vi.fn()
    const manager = {
      async plainTextViewBarrier() {
        return {
          type: 'plain-text-view',
          session: 1,
          sequence: 2,
          revision: 1,
          accepted: true,
          sourceLength: 12,
          source: '# heading\n',
          view: { kind: 'unsupported', reason: 'projection-shape' }
        }
      },
      handoff,
      activate: vi.fn(),
      lease: vi.fn()
    } as unknown as Pick<
      CoreDocumentSessionManager,
      'plainTextViewBarrier' | 'handoff' | 'activate' | 'lease'
    >

    await expect(handoffCorePlainTextView(manager, sourceLease)).rejects.toThrow(
      'plain-text WYSIWYG projection is unsupported'
    )
    expect(handoff).not.toHaveBeenCalled()
  })
})
