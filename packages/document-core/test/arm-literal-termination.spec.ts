import { describe, expect, it } from 'vitest'
import { createDocumentCore, type MarkdownAstNode } from '../src/index.js'

// A block literal (fence, math or HTML block) opened inside a suggestion's
// arm finishes inside that arm (ADR-0010 for Substitution arms; ADR-0016
// L2c for a boundary token that begins a line). The full document's parse
// shows that in every view, wherever the regions of its parse fall: no such
// literal runs past the line of the suggestion's closer, at the top level or
// inside a list or quote, before a paragraph, a suggestion or the
// document's end. A closer the literal holds as its text (one mid-line in a
// block literal) forms no suggestion; those sources have nothing to check.
//
// A Substitution beginning mid-line whose first arm
// ends a line put its second arm at a line start in the editing view, where
// a fence or HTML opener the arm reads as text opened a block that ran on
// past the closer.

const prefixes: Readonly<Record<string, string>> = { start: '', mid: 'x', listMid: '- x', quoteMid: '> x' }
const oldArms: Readonly<Record<string, string>> = { plainLine: 'old\n', fence: '```\nold\n```\n', twoLines: 'a\nb\n', plain: 'old' }
const newArms: Readonly<Record<string, string>> = {
  fence: '```\nnew\n```',
  openFence: '```\nnew',
  tilde: '~~~\nnew\n~~~',
  math: '$$\nm\n$$',
  openMath: '$$\nm',
  html: '<div>\nh\n</div>',
  openHtml: '<div>\nh',
  plain: 'new',
  fenceLine: '```\nnew\n```\n',
  openFenceLine: '```\nnew\n',
  tildeLine: '~~~\nnew\n~~~\n',
  mathLine: '$$\nm\n$$\n',
  openMathLine: '$$\nm\n',
  htmlLine: '<div>\nh\n</div>\n',
  openHtmlLine: '<div>\nh\n',
  plainLine: 'new\n'
}
const followers: Readonly<Record<string, string>> = {
  blankParagraph: '\n\nPara after.\n',
  paragraph: '\nPara after.\n',
  blankSuggestion: '\n\n{++s++}\n\nPara after.\n',
  end: '\n',
  blankBlockSuggestion: '\n\n{~~<div>\nh\n</div>\n~><div>\nk\n</div>\n~~}\n- item\n',
  blockSuggestion: '\n{~~<div>\nh\n</div>\n~><div>\nk\n</div>\n~~}\n- item\n'
}

/** The source with every line after the first under `prefix`'s container. */
function contained(prefix: string, text: string): string {
  const lines = text.split('\n')
  if (prefix.startsWith('- ')) return lines.map((line, index) => index === 0 || line === '' ? line : `  ${line}`).join('\n')
  if (prefix.startsWith('> ')) return lines.map((line, index) => index === 0 ? line : `> ${line}`).join('\n')
  return text
}

const literalKinds = new Set(['code-block', 'math-block', 'html-block', 'diagram'])

/** Literal blocks of a view starting inside [start, closer) and ending past the closer. */
function leaks(source: string, start: number, closer: number): string[] {
  const core = createDocumentCore()
  const revision = core.open(source)
  const found: string[] = []
  if (!revision.annotations.some(annotation => annotation.range.start === start && annotation.range.end === closer)) return found
  const closerLineEnd = source.indexOf('\n', closer) < 0 ? source.length : source.indexOf('\n', closer)
  for (const view of ['markup', 'original', 'revised'] as const) {
    const projection = core.project(revision, view)
    const { ast, coordinates } = projection.kind === 'markup' ? projection.syntax : projection
    const visit = (node: MarkdownAstNode): void => {
      for (const child of node.children) {
        if (literalKinds.has(child.kind)) {
          const from = coordinates.toSource(child.range.start, 'next')
          const to = coordinates.toSource(child.range.end, 'previous')
          if (from >= start && from < closer && to > closerLineEnd + 1) found.push(`${view} ${child.kind} ${String(from)}-${String(to)}`)
        }
        visit(child)
      }
    }
    visit(ast.root)
  }
  return found
}

describe('a block literal opened in a Substitution arm ends with the arm', () => {
  for (const [prefixName, prefix] of Object.entries(prefixes)) {
    for (const [oldName, oldArm] of Object.entries(oldArms)) {
      it(`${prefixName}, old arm ${oldName}`, () => {
        for (const [newName, newArm] of Object.entries(newArms)) {
          for (const [followerName, follower] of Object.entries(followers)) {
            const source = contained(prefix, `${prefix}{~~${oldArm}~>${newArm}~~}${follower}`)
            const start = source.indexOf('{~~')
            const closer = source.indexOf('~~}') + 3
            expect(leaks(source, start, closer), `${newName} before ${followerName}: ${JSON.stringify(source)}`).toEqual([])
          }
        }
      })
    }
  }
})

describe('a block literal ended by a closer that begins a line ends with the arm', () => {
  const arms: Readonly<Record<string, string>> = {
    openFence: '```\ncode\n', openTilde: '~~~\ncode\n', openMath: '$$\nm\n', openHtml: '<div>\nh\n', lastFence: 'text\n```\n'
  }
  for (const [kind, open, close] of [['addition', '{++', '++}'], ['deletion', '{--', '--}'], ['highlight', '{==', '==}{>>c<<}']] as const) {
    it(kind, () => {
      for (const [prefixName, prefix] of Object.entries(prefixes)) {
        for (const [armName, arm] of Object.entries(arms)) {
          for (const [followerName, follower] of Object.entries(followers)) {
            const source = contained(prefix, `${prefix}${open}${arm}${close}${follower}`)
            const start = source.indexOf(open)
            const closer = source.indexOf(close) + 3
            expect(leaks(source, start, closer), `${prefixName} ${armName} before ${followerName}: ${JSON.stringify(source)}`).toEqual([])
          }
        }
      }
    })
  }
})
