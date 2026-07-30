import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ProjectSearchErrorEnvelope,
  ProjectSearchMatchEnvelope,
  ProjectSearchProgressEnvelope,
  ProjectSearchRequest,
  ProjectSearchStartReceipt,
  ProjectSearchTerminalEnvelope
} from '@shared/types/projectSearch'
import RipgrepDirectorySearcher, {
  FileSearcher
} from '@/node/ripgrepSearcher'

interface SearchBridgeFixture {
  readonly bridge: Window['ripgrep']
  readonly request: () => ProjectSearchRequest | null
  readonly resolveStart: (receipt: ProjectSearchStartReceipt) => void
  readonly emitMatch: (value: ProjectSearchMatchEnvelope) => void
  readonly emitDone: (value: ProjectSearchTerminalEnvelope) => void
  readonly cancel: ReturnType<typeof vi.fn>
}

function bridgeFixture(): SearchBridgeFixture {
  let request: ProjectSearchRequest | null = null
  let resolveStart = (_receipt: ProjectSearchStartReceipt): void => {}
  const handlers = {
    match: (_value: ProjectSearchMatchEnvelope): void => {},
    progress: (_value: ProjectSearchProgressEnvelope): void => {},
    done: (_value: ProjectSearchTerminalEnvelope): void => {},
    error: (_value: ProjectSearchErrorEnvelope): void => {},
    cancelled: (_value: ProjectSearchTerminalEnvelope): void => {}
  }
  const cancel = vi.fn()
  const bridge: Window['ripgrep'] = {
    start: value => {
      request = value
      return new Promise<ProjectSearchStartReceipt>(resolve => {
        resolveStart = resolve
      })
    },
    cancel,
    onMatch: handler => {
      handlers.match = handler
      return () => {}
    },
    onProgress: handler => {
      handlers.progress = handler
      return () => {}
    },
    onDone: handler => {
      handlers.done = handler
      return () => {}
    },
    onError: handler => {
      handlers.error = handler
      return () => {}
    },
    onCancelled: handler => {
      handlers.cancelled = handler
      return () => {}
    }
  }
  return {
    bridge,
    request: () => request,
    resolveStart: receipt => resolveStart(receipt),
    emitMatch: value => handlers.match(value),
    emitDone: value => handlers.done(value),
    cancel
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('closed renderer project-search client', () => {
  it('sends no path or search identity and correlates early events to the main identity', async() => {
    const fixture = bridgeFixture()
    vi.stubGlobal('window', { ripgrep: fixture.bridge })
    const matches: unknown[] = []

    const search = new RipgrepDirectorySearcher().search('needle', {
      isCaseSensitive: true,
      inclusions: ['*.md'],
      didMatch: value => matches.push(value)
    })
    expect(fixture.request()).toEqual({
      schema: 'project-search-request-1',
      mode: 'text',
      pattern: 'needle',
      options: {
        isCaseSensitive: true,
        inclusions: ['*.md']
      }
    })
    expect(fixture.request()).not.toHaveProperty('directories')
    expect(fixture.request()).not.toHaveProperty('searchId')

    fixture.emitMatch({
      searchId: 'other-search',
      payload: '/wrong.md'
    })
    fixture.emitMatch({
      searchId: 'main-search',
      payload: '/right.md'
    })
    fixture.resolveStart({ searchId: 'main-search' })
    fixture.emitDone({ searchId: 'main-search', matchCount: 1 })

    await search
    expect(matches).toEqual(['/right.md'])
  })

  it('holds completion until every promised match envelope arrives', async() => {
    const fixture = bridgeFixture()
    vi.stubGlobal('window', { ripgrep: fixture.bridge })

    const matches: unknown[] = []
    let resolved = false
    const search = new RipgrepDirectorySearcher().search('needle', {
      didMatch: (payload) => matches.push(payload),
      inclusions: ['*.md']
    })
    void search.then(() => {
      resolved = true
    })

    fixture.resolveStart({ searchId: 'main-search' })
    // The done envelope overtakes one queued match delivery: mt::rg::match
    // and mt::rg::done are separate channels with no cross-channel ordering
    // guarantee (G28). The promised count keeps the result complete.
    fixture.emitDone({ searchId: 'main-search', matchCount: 2 })
    fixture.emitMatch({ searchId: 'main-search', payload: '/one.md' })
    await Promise.resolve()
    expect(resolved).toBe(false)

    fixture.emitMatch({ searchId: 'main-search', payload: '/two.md' })
    await search
    expect(matches).toEqual(['/one.md', '/two.md'])
  })

  it('cancels a pre-start request only through the main-generated identity', async() => {
    const fixture = bridgeFixture()
    vi.stubGlobal('window', { ripgrep: fixture.bridge })

    const search = new FileSearcher().search({
      inclusions: ['*.md']
    })
    search.cancel()
    expect(fixture.cancel).not.toHaveBeenCalled()

    fixture.resolveStart({ searchId: 'main-file-search' })
    await vi.waitFor(() => {
      expect(fixture.cancel).toHaveBeenCalledWith('main-file-search')
    })
    fixture.emitDone({ searchId: 'main-file-search', matchCount: 0 })
    await search
  })
})
