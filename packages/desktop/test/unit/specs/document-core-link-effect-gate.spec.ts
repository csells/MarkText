import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  coordinateDocumentCoreLinkOpen,
  type DocumentCoreLinkCoordinatorDependencies
} from 'main_renderer/ipc/documentLink'

const request = Object.freeze({
  documentId: 'document:owned',
  revisionId: 'revision:current',
  targetNodeId: 'p1:link:1'
})

function dependencies(
  destination = 'docs/Guide.md'
): DocumentCoreLinkCoordinatorDependencies {
  return Object.freeze({
    resolveTarget: vi.fn(async(_ownerId, admitted) => Object.freeze({
      kind: 'document-link-target' as const,
      revisionId: admitted.revisionId,
      targetNodeId: admitted.targetNodeId,
      destination
    })),
    describeDocument: vi.fn(() => Object.freeze({
      pathname: '/main-owned/notes/Current.md'
    })),
    isMarkdownPath: vi.fn((pathname: string) => pathname.endsWith('.md')),
    isDangerousPath: vi.fn((pathname: string) => pathname.endsWith('.command')),
    openExternal: vi.fn(async() => {}),
    openMarkdownPath: vi.fn(async() => {}),
    openPath: vi.fn(async() => {}),
    confirmDangerousPath: vi.fn(async() => true)
  })
}

function expectNoEffect(
  deps: DocumentCoreLinkCoordinatorDependencies
): void {
  expect(deps.openExternal).not.toHaveBeenCalled()
  expect(deps.openMarkdownPath).not.toHaveBeenCalled()
  expect(deps.openPath).not.toHaveBeenCalled()
  expect(deps.confirmDangerousPath).not.toHaveBeenCalled()
}

describe('document-core link effect gate', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    { ...request, href: 'https://renderer-forged.test' },
    { ...request, dirname: '/renderer/forged' },
    { ...request, pathname: '/renderer/forged.md' }
  ])('rejects renderer URL/path authority before resolution or effects', async(raw) => {
    const deps = dependencies()

    await expect(coordinateDocumentCoreLinkOpen(
      raw,
      'renderer:7',
      deps
    )).rejects.toThrow(/closed|fields|unknown/i)

    expect(deps.resolveTarget).not.toHaveBeenCalled()
    expect(deps.describeDocument).not.toHaveBeenCalled()
    expectNoEffect(deps)
  })

  it.each([
    {
      label: 'stale revision',
      admitted: { ...request, revisionId: 'revision:stale' },
      error: 'stale revision'
    },
    {
      label: 'foreign revision node',
      admitted: { ...request, targetNodeId: 'p9:link:foreign' },
      error: 'target is not a link in the owned revision'
    },
    {
      label: 'foreign document',
      admitted: { ...request, documentId: 'document:foreign' },
      error: 'document is owned by another renderer'
    }
  ])('stops a $label before path lookup or effects', async({
    admitted,
    error
  }) => {
    const deps = dependencies()
    vi.mocked(deps.resolveTarget).mockRejectedValueOnce(new Error(error))

    await expect(coordinateDocumentCoreLinkOpen(
      admitted,
      'renderer:7',
      deps
    )).rejects.toThrow(error)

    expect(deps.describeDocument).not.toHaveBeenCalled()
    expectNoEffect(deps)
  })

  it('opens a relative Markdown destination from the main-retained document path', async() => {
    const deps = dependencies('../guides/Guide.md')

    await expect(coordinateDocumentCoreLinkOpen(
      request,
      'renderer:7',
      deps
    )).resolves.toEqual({
      kind: 'opened',
      target: 'markdown'
    })

    expect(deps.describeDocument).toHaveBeenCalledWith(
      'renderer:7',
      'document:owned'
    )
    expect(deps.openMarkdownPath).toHaveBeenCalledWith(
      '/main-owned/guides/Guide.md'
    )
    expect(deps.openPath).not.toHaveBeenCalled()
  })

  it('returns only a parser-authenticated anchor for renderer-local navigation', async() => {
    const deps = dependencies('#installation')

    await expect(coordinateDocumentCoreLinkOpen(
      request,
      'renderer:7',
      deps
    )).resolves.toEqual({
      kind: 'anchor',
      fragment: 'installation'
    })

    expect(deps.describeDocument).not.toHaveBeenCalled()
    expectNoEffect(deps)
  })

  it('allows only explicit external protocols and never consults a document path', async() => {
    const deps = dependencies('mailto:person@example.test')

    await expect(coordinateDocumentCoreLinkOpen(
      request,
      'renderer:7',
      deps
    )).resolves.toEqual({
      kind: 'opened',
      target: 'external'
    })

    expect(deps.openExternal).toHaveBeenCalledWith(
      'mailto:person@example.test'
    )
    expect(deps.describeDocument).not.toHaveBeenCalled()
    expect(deps.openPath).not.toHaveBeenCalled()
  })

  it('preserves dangerous-file confirmation before the OS path effect', async() => {
    const deps = dependencies('./run.command')
    vi.mocked(deps.confirmDangerousPath).mockResolvedValueOnce(false)

    await expect(coordinateDocumentCoreLinkOpen(
      request,
      'renderer:7',
      deps
    )).resolves.toEqual({ kind: 'cancelled' })

    expect(deps.confirmDangerousPath).toHaveBeenCalledWith(
      '/main-owned/notes/run.command'
    )
    expect(deps.openPath).not.toHaveBeenCalled()
  })

  it('rejects an unsupported protocol without any native effect', async() => {
    const deps = dependencies('sambesi://localhost/node/11164')

    await expect(coordinateDocumentCoreLinkOpen(
      request,
      'renderer:7',
      deps
    )).resolves.toEqual({
      kind: 'unavailable',
      reason: 'unsupported-scheme'
    })

    expect(deps.describeDocument).not.toHaveBeenCalled()
    expectNoEffect(deps)
  })
})
