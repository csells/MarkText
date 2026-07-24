// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { createDocumentCoreMirror } from '@/components/editorWithTabs/documentCoreMirror'

/**
 * The first flow actually served by the new engine.
 *
 * Migrating a flow means document-core answers it while Muya still owns
 * everything else, so the two must hold the same document. The mirror seeds a
 * document-core session from the editor's content and re-seeds it whenever Muya
 * commits a change, so a read served by the engine describes what the user is
 * looking at.
 *
 * It falls back to Muya until the session exists, because building one is async
 * and the editor asks for content synchronously from the first render. Returning
 * a stale or empty document for those first reads would show an empty file or
 * mark a clean tab dirty.
 */

function fakeMuya(markdown: string) {
  const listeners: Array<() => void> = []
  let current = markdown
  return {
    getMarkdown: () => current,
    on: (event: string, listener: () => void) => {
      if (event === 'json-change') listeners.push(listener)
    },
    edit(next: string) {
      current = next
      listeners.forEach(listener => listener())
    }
  }
}

const PARSE_CONFIGURATION = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  liveHtmlSafetyProfile: 'live-html-safety-profile-1',
  executionBudget: {
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
} as const

describe('document-core mirror', () => {
  it('serves the document from the engine once it is ready', async() => {
    const muya = fakeMuya('# Mirrored\n')
    const mirror = createDocumentCoreMirror(muya, PARSE_CONFIGURATION)
    await mirror.ready
    expect(mirror.binding.getMarkdownSync()).toBe('# Mirrored\n')
  })

  it('falls back to the editor before the session exists', () => {
    const muya = fakeMuya('# Early\n')
    const mirror = createDocumentCoreMirror(muya, PARSE_CONFIGURATION)
    // Asked before the async session resolves: an empty answer here would show
    // an empty document or mark a clean tab dirty.
    expect(mirror.binding.getMarkdownSync()).toBe('# Early\n')
  })

  it('follows edits the editor commits', async() => {
    const muya = fakeMuya('# One\n')
    const mirror = createDocumentCoreMirror(muya, PARSE_CONFIGURATION)
    await mirror.ready
    muya.edit('# One\n\nTwo.\n')
    await mirror.settled()
    expect(mirror.binding.getMarkdownSync()).toBe('# One\n\nTwo.\n')
  })

  it('keeps CriticMarkup markers exactly', async() => {
    const muya = fakeMuya('a{++x++}b\n')
    const mirror = createDocumentCoreMirror(muya, PARSE_CONFIGURATION)
    await mirror.ready
    // The engine is the one that must not normalise the user's markers away.
    expect(mirror.binding.getMarkdownSync()).toBe('a{++x++}b\n')
  })

  it('agrees with the editor it mirrors', async() => {
    const muya = fakeMuya('# Same\n\nBody.\n')
    const mirror = createDocumentCoreMirror(muya, PARSE_CONFIGURATION)
    await mirror.ready
    // Divergence here is the failure that matters: it would mean the saved file
    // and the edited document had drifted apart.
    expect(mirror.binding.getMarkdownSync()).toBe(muya.getMarkdown())
  })
})

describe('mirror staleness', () => {
  it('never serves the previous document while re-seeding', async() => {
    const muya = fakeMuya('# Before\n')
    const mirror = createDocumentCoreMirror(muya, PARSE_CONFIGURATION)
    await mirror.ready
    muya.edit('# After\n')
    // Read immediately, before the async re-seed resolves. Serving '# Before'
    // here would save the wrong document.
    expect(mirror.binding.getMarkdownSync()).toBe('# After\n')
    await mirror.settled()
    expect(mirror.binding.getMarkdownSync()).toBe('# After\n')
  })
})

describe('divergence detection', () => {
  it('reports no divergence when the engine round-trips the document', async() => {
    const muya = fakeMuya('# Same\n\nBody with {++tracked++} text.\n')
    const mirror = createDocumentCoreMirror(muya, PARSE_CONFIGURATION)
    await mirror.ready
    mirror.binding.getMarkdownSync()
    expect(mirror.divergences()).toEqual([])
  })

  it('records a divergence when the engine would not reproduce the document', async() => {
    // Before handing a user's text to a new engine, we need evidence the engine
    // gives back exactly what it was given. A silent difference here is the
    // failure that loses data on save, so it is recorded rather than assumed
    // away.
    const muya = fakeMuya('# Doc\n')
    const mirror = createDocumentCoreMirror(muya, PARSE_CONFIGURATION, {
      // Force a mismatch to prove the check actually fires.
      readEngineSource: () => '# Something else\n'
    })
    await mirror.ready
    mirror.binding.getMarkdownSync()
    expect(mirror.divergences()).toHaveLength(1)
    expect(mirror.divergences()[0]).toMatchObject({
      editor: '# Doc\n',
      engine: '# Something else\n'
    })
  })

  it('serves the editor’s text when the engine diverges', async() => {
    // Confidence-building must never become a way to serve wrong bytes: if the
    // engine disagrees, the answer is still the document the user is editing.
    const muya = fakeMuya('# Trusted\n')
    const mirror = createDocumentCoreMirror(muya, PARSE_CONFIGURATION, {
      readEngineSource: () => '# Wrong\n'
    })
    await mirror.ready
    expect(mirror.binding.getMarkdownSync()).toBe('# Trusted\n')
  })
})

describe('change subscription', () => {
  it('still notifies the editor’s own listeners under the flag', async() => {
    // Regression: the host routes onChange to the document-core binding, so a
    // binding without one silently switches off the editor's change handling.
    const muya = fakeMuya('# One\n')
    const mirror = createDocumentCoreMirror(muya, PARSE_CONFIGURATION)
    await mirror.ready
    let notified = 0
    mirror.binding.onChange?.(() => { notified += 1 })
    muya.edit('# Two\n')
    expect(notified).toBe(1)
  })
})
