import { describe, expect, it } from 'vitest'
import { createEditorCoreBinding } from '../../../src/renderer/src/documentAuthority/editorCoreBinding'
import { createCoreDocumentSessionManager } from '../../../src/renderer/src/documentAuthority/coreDocumentSessionManager'
import { createCoreActor } from '../../../src/renderer/src/documentAuthority/coreActor'
import type {
  CoreReviewItemReply,
  CoreReviewOverviewEntry
} from '../../../src/renderer/src/documentAuthority/coreProtocol'
import {
  renderMarkdownProjectionToSafeHtml,
  renderMarkupPassageExcerpt
} from '../../../src/renderer/src/documentConsumers/markdownProjectionHtml'

it('exposes visible review comments from their owning Core scope without promoting nested comment drafts', () => {
  const source = '{==Passage==}{>>First **note**.<<}\n\nTail.{>>Outer {>>nested<<}.<<}\n'
  const actor = createCoreActor()
  try {
    const opened = actor.handle({ type: 'open', session: 1, sequence: 1, source })
    expect(opened.type).toBe('opened')
    const reply = actor.handle({
      type: 'review-item-at-barrier',
      session: 1,
      sequence: 2,
      baseRevision: opened.revision,
      direction: 'next',
      from: 0,
      includeOverview: true
    }) as CoreReviewItemReply
    expect(reply.overview?.map((entry) => entry.item.kind)).toEqual(['commented-span', 'comment'])
    expect(reply.overview?.map((entry) => entry.commentText)).toEqual([
      'First **note**.',
      'Outer {>>nested<<}.'
    ])
    expect(reply.overview?.every((entry) => entry.commentProjection !== undefined)).toBe(true)
    expect(
      actor.handle({
        type: 'source-at-barrier',
        session: 1,
        sequence: 3,
        baseRevision: opened.revision
      })
    ).toMatchObject({ source, revision: opened.revision })
  } finally {
    actor.dispose()
  }
})

it('carries the overview through the document view lease without bypassing its ownership', async() => {
  const sessions = createCoreDocumentSessionManager({
    createBinding: () => {
      const actor = createCoreActor()
      return createEditorCoreBinding({
        request: (request) => structuredClone(actor.handle(request)),
        dispose: () => actor.dispose()
      })
    }
  })
  const source = '{==Passage==}{>>Margin comment.<<}\n'
  await sessions.open({ documentId: 'margin', source, lineEnding: '\n' })
  const lease = sessions.lease('margin')
  try {
    const reply = await lease.binding.reviewItemAtBarrier('next', 0, true)
    expect(reply.type).toBe('review-item')
    if (reply.type !== 'review-item') throw new Error('Review read was rejected')
    expect(reply.overview?.map((entry) => entry.commentText)).toEqual(['Margin comment.'])
    expect((await sessions.saveBarrier('margin')).source).toBe(source)
  } finally {
    await sessions.handoff(lease)
    await sessions.close('margin')
  }
})

const overviewOf = (source: string) => {
  const actor = createCoreActor()
  try {
    const opened = actor.handle({ type: 'open', session: 1, sequence: 1, source })
    const reply = actor.handle({
      type: 'review-item-at-barrier',
      session: 1,
      sequence: 2,
      baseRevision: opened.revision,
      direction: 'next',
      from: 0,
      includeOverview: true
    }) as CoreReviewItemReply
    // Reading the overview never changes the document.
    expect(
      actor.handle({ type: 'source-at-barrier', session: 1, sequence: 3, baseRevision: opened.revision })
    ).toMatchObject({ source, revision: opened.revision })
    return reply.overview ?? []
  } finally {
    actor.dispose()
  }
}

const excerptsOf = (entry: CoreReviewOverviewEntry) => ({
  kind: entry.item.kind,
  excerpt: entry.excerpt && renderMarkupPassageExcerpt(entry.excerpt),
  replacement: entry.replacementExcerpt && renderMarkupPassageExcerpt(entry.replacementExcerpt)
})

const CRITIC_TOKENS = /\{\+\+|\+\+\}|\{--|--\}|\{~~|~>|~~\}|\{==|==\}|\{>>|<<\}/u
const ins = (text: string) => `<span class="core-critic-mark core-critic-addition" role="insertion">${text}</span>`
const del = (text: string) => `<span class="core-critic-mark core-critic-deletion" role="deletion">${text}</span>`
const mark = (text: string) => `<span class="core-critic-mark core-critic-highlight" role="mark">${text}</span>`
const oldArm = (text: string) =>
  `<span class="core-critic-mark core-critic-substitution core-critic-substitution-old" role="deletion">${text}</span>`
const newArm = (text: string) =>
  `<span class="core-critic-mark core-critic-substitution core-critic-substitution-new" role="insertion">${text}</span>`

describe('sidebar excerpts', () => {
  it('present every suggestion and highlight form as the editor marks it', () => {
    const overview = overviewOf(
      '{++New++} {--Old--} {~~Before~>After~~} {==Important==} {==Pair==}{>>Note.<<}\n'
    )
    expect(overview.map(excerptsOf)).toEqual([
      { kind: 'addition', excerpt: { html: ins('New'), text: 'New' }, replacement: undefined },
      { kind: 'deletion', excerpt: { html: del('Old'), text: 'Old' }, replacement: undefined },
      {
        kind: 'substitution',
        excerpt: { html: oldArm('Before'), text: 'Before' },
        replacement: { html: newArm('After'), text: 'After' }
      },
      { kind: 'highlight', excerpt: { html: mark('Important'), text: 'Important' }, replacement: undefined },
      { kind: 'commented-span', excerpt: { html: mark('Pair'), text: 'Pair' }, replacement: undefined }
    ])
  })

  it('present suggestions nested in a passage as suggestions, never as delimiters', () => {
    const overview = overviewOf(
      'Nested {==outer {++inner addition++} mark==}{>>Nested pair note.<<} and ' +
        '{--gone {~~a~>b~~} {==lit==}--} {~~x {++y++}~>z {--w--}~~}\n'
    )
    const entries = overview.map(excerptsOf)
    const span = entries.find((entry) => entry.kind === 'commented-span')
    const inner = entries.find((entry) => entry.kind === 'addition')
    const deletion = entries.find((entry) => entry.kind === 'deletion' && entry.excerpt?.text.startsWith('gone'))
    expect(span).toEqual({
      kind: 'commented-span',
      excerpt: {
        html: mark(`outer ${ins('inner addition')} mark`),
        text: 'outer inner addition mark'
      },
      replacement: undefined
    })
    expect(inner?.excerpt?.html).toBe(ins('inner addition'))
    expect(deletion?.excerpt).toEqual({
      html: del(`gone ${oldArm('a')}${newArm('b')} ${mark('lit')}`),
      text: 'gone ab lit'
    })
    const substitution = entries.find((entry) => entry.kind === 'substitution' && entry.excerpt?.text === 'x y')
    expect(substitution).toMatchObject({
      excerpt: { html: oldArm(`x ${ins('y')}`) },
      replacement: { html: newArm(`z ${del('w')}`), text: 'z w' }
    })
    for (const entry of overview.map(excerptsOf)) {
      expect(`${entry.excerpt?.html ?? ''}${entry.replacement?.html ?? ''}`).not.toMatch(CRITIC_TOKENS)
    }
  })

  it('keep Markdown formatting and leave markers inside code spans literal', () => {
    const overview = overviewOf('{==**bold** and `{++code++}` with *em {--x--} y*==}\n').map(excerptsOf)
    expect(overview.map((entry) => entry.kind)).toEqual(['deletion', 'highlight'])
    expect(overview[1]?.excerpt).toEqual({
      html:
        `<strong>${mark('bold')}</strong>${mark(' and ')}${mark('<code>{++code++}</code>')}${mark(' with ')}` +
        `<em>${mark(`em ${del('x')} y`)}</em>`,
      text: 'bold and {++code++} with em x y'
    })
  })

  it('show a passage that spans blocks one block per line', () => {
    const overview = overviewOf('Cross {--start of **removal**\n\nend of removal--} after.\n')
    expect(overview.map(excerptsOf)).toEqual([
      {
        kind: 'deletion',
        excerpt: {
          html: `${del('start of ')}<strong>${del('removal')}</strong>\n${del('end of removal')}`,
          text: 'start of removal end of removal'
        },
        replacement: undefined
      }
    ])
  })
})

describe('sidebar Comment bodies', () => {
  const bodyOf = (entry: CoreReviewOverviewEntry | undefined): string => {
    if (entry?.commentProjection === undefined) throw new Error('Comment body is absent')
    return renderMarkdownProjectionToSafeHtml(entry.commentProjection)
  }

  it('present suggestions nested in a Comment in their Markup reading', () => {
    const payload = 'Comment with {--nested deletion--} and **bold {++add++}**, {~~o~>n~~} {==h==}.'
    const [comment] = overviewOf(`Text{>>${payload}<<}\n`)
    expect(comment?.commentText).toBe(payload)
    expect(bodyOf(comment)).toBe(
      `<p>Comment with ${del('nested deletion')} and <strong>bold ${ins('add')}</strong>, ` +
        `${oldArm('o')}${newArm('n')} ${mark('h')}.</p>\n`
    )
  })

  it('keep code-span markers literal and nested Comments hidden', () => {
    const [comment] = overviewOf('Text{>>Use `{--x--}` {>>hidden<<}here.<<}\n')
    expect(bodyOf(comment)).toBe('<p>Use <code>{--x--}</code> here.</p>\n')
  })

  it('carry block structure and nested suggestions across the blocks of a Comment', () => {
    const [comment] = overviewOf('{==Pair==}{>>## Head {++new++}\n\n- one {--two--}<<}\n')
    expect(bodyOf(comment)).toBe(
      `<h2 id="head-new">Head ${ins('new')}</h2>\n<ul>\n<li>one ${del('two')}</li>\n</ul>\n`
    )
  })
})
