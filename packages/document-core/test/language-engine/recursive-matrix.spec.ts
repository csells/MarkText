import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type CriticMarkupNode,
  type ParseConfiguration
} from '@marktext/document-core'

const TEST_CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  liveHtmlSafetyProfile: 'live-html-safety-profile-1',
  executionBudget: {
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

type MatrixRow = readonly [
  name: string,
  source: string,
  parent: 'root' | CriticMarkupNode['kind'],
  child: CriticMarkupNode['kind'],
  original: string,
  revised: string
]

const MATRIX: readonly MatrixRow[] = [
  ['root/addition', '{++x++}', 'root', 'addition', '', 'x'],
  ['root/deletion', '{--x--}', 'root', 'deletion', 'x', ''],
  ['root/substitution', '{~~o~>n~~}', 'root', 'substitution', 'o', 'n'],
  ['root/highlight', '{==x==}', 'root', 'highlight', 'x', 'x'],
  ['root/comment', '{>>x<<}', 'root', 'comment', '', ''],

  ['addition/addition', '{++p{++x++}q++}', 'addition', 'addition', '', 'pxq'],
  ['addition/deletion', '{++p{--x--}q++}', 'addition', 'deletion', '', 'pq'],
  ['addition/substitution', '{++p{~~o~>n~~}q++}', 'addition', 'substitution', '', 'pnq'],
  ['addition/highlight', '{++p{==x==}q++}', 'addition', 'highlight', '', 'pxq'],
  ['addition/comment', '{++p{>>x<<}q++}', 'addition', 'comment', '', 'pq'],

  ['deletion/addition', '{--p{++x++}q--}', 'deletion', 'addition', 'pq', ''],
  ['deletion/deletion', '{--p{--x--}q--}', 'deletion', 'deletion', 'pxq', ''],
  ['deletion/substitution', '{--p{~~o~>n~~}q--}', 'deletion', 'substitution', 'poq', ''],
  ['deletion/highlight', '{--p{==x==}q--}', 'deletion', 'highlight', 'pxq', ''],
  ['deletion/comment', '{--p{>>x<<}q--}', 'deletion', 'comment', 'pq', ''],

  ['sub-old/addition', '{~~p{++x++}q~>N~~}', 'substitution', 'addition', 'pq', 'N'],
  ['sub-old/deletion', '{~~p{--x--}q~>N~~}', 'substitution', 'deletion', 'pxq', 'N'],
  ['sub-old/substitution', '{~~p{~~o~>n~~}q~>N~~}', 'substitution', 'substitution', 'poq', 'N'],
  ['sub-old/highlight', '{~~p{==x==}q~>N~~}', 'substitution', 'highlight', 'pxq', 'N'],
  ['sub-old/comment', '{~~p{>>x<<}q~>N~~}', 'substitution', 'comment', 'pq', 'N'],

  ['sub-new/addition', '{~~O~>p{++x++}q~~}', 'substitution', 'addition', 'O', 'pxq'],
  ['sub-new/deletion', '{~~O~>p{--x--}q~~}', 'substitution', 'deletion', 'O', 'pq'],
  ['sub-new/substitution', '{~~O~>p{~~o~>n~~}q~~}', 'substitution', 'substitution', 'O', 'pnq'],
  ['sub-new/highlight', '{~~O~>p{==x==}q~~}', 'substitution', 'highlight', 'O', 'pxq'],
  ['sub-new/comment', '{~~O~>p{>>x<<}q~~}', 'substitution', 'comment', 'O', 'pq'],

  ['highlight/addition', '{==p{++x++}q==}', 'highlight', 'addition', 'pq', 'pxq'],
  ['highlight/deletion', '{==p{--x--}q==}', 'highlight', 'deletion', 'pxq', 'pq'],
  ['highlight/substitution', '{==p{~~o~>n~~}q==}', 'highlight', 'substitution', 'poq', 'pnq'],
  ['highlight/highlight', '{==p{==x==}q==}', 'highlight', 'highlight', 'pxq', 'pxq'],
  ['highlight/comment', '{==p{>>x<<}q==}', 'highlight', 'comment', 'pq', 'pq'],

  ['comment/addition', '{>>p{++x++}q<<}', 'comment', 'addition', '', ''],
  ['comment/deletion', '{>>p{--x--}q<<}', 'comment', 'deletion', '', ''],
  ['comment/substitution', '{>>p{~~o~>n~~}q<<}', 'comment', 'substitution', '', ''],
  ['comment/highlight', '{>>p{==x==}q<<}', 'comment', 'highlight', '', ''],
  ['comment/comment', '{>>p{>>x<<}q<<}', 'comment', 'comment', '', '']
]

describe('LanguageEngine.open recursive parent × child matrix', () => {
  it.each(MATRIX)('%s', (_name, sourceText, parentKind, childKind, original, revised) => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.projection('original').source).toBe(original)
    expect(revision.projection('revised').source).toBe(revised)
    expect(revision.criticMarkup.roots).toHaveLength(1)
    const root = revision.criticMarkup.roots[0]
    expect(root?.kind).toBe(parentKind === 'root' ? childKind : parentKind)
    if (parentKind !== 'root') {
      const children = root?.arms.flatMap((arm) => arm.children) ?? []
      expect(children).toHaveLength(1)
      expect(children[0]?.kind).toBe(childKind)
    }
  })
})
