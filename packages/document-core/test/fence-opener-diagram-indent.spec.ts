import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction } from '../src/index.js'

// Upstream MarkText #5600 converts a fence opener line on Enter, or when its
// language is picked, into the block it names and writes it as its
// serializer does (paragraphContent `_enterConvert`, the code-block language
// selector, `stateToMarkdown`):
// - a diagram language, matched exactly (`diagramTypeOfLang`), becomes a
//   diagram block, written with backticks and its type whatever fence
//   character was typed (enterConvert.spec.ts, enterConvertNested.spec.ts);
// - `parseFenceLine` reads an opener indented one to three spaces, and the new
//   block is written at its container's indentation, without them.

const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }

const apply = (source: string, at: number, action: Record<string, unknown>) => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const input = { selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, options, ...action } as unknown as DocumentInputAction
  const plan = core.planInput(previous, input)
  const edits = core.inputEdits(previous, input, plan, false)
  if (edits === undefined) throw new Error('Input was refused')
  const commit = core.apply(previous, edits)
  const selection = core.reconcileInput(previous, plan, commit, input).selection
  if (selection === undefined || !('ranges' in selection)) throw new Error('Expected a text selection')
  return { source: commit.revision.source, caret: selection.ranges[selection.primary]?.anchor }
}
const enter = (source: string, at: number) =>
  apply(source, at, { range: { start: at, end: at }, inputType: 'insertParagraph', data: null })
const pick = (source: string, at: number, language: string) =>
  apply(source, at, { kind: 'command', command: 'setCodeLanguage', language })

describe('Enter on a diagram fence opener (upstream #5600)', () => {
  it.each([
    ['```mermaid\n', '```mermaid\n\n```\n', 11],
    ['~~~mermaid\n', '```mermaid\n\n```\n', 11],
    ['```plantuml\n', '```plantuml\n\n```\n', 12],
    ['```vega-lite\n', '```vega-lite\n\n```\n', 13],
    ['```flowchart\n', '```flowchart\n\n```\n', 13],
    ['~~~sequence\n', '```sequence\n\n```\n', 12],
    ['```mermaid extra\n', '```mermaid\n\n```\n', 11],
    ['> ```mermaid\n', '> ```mermaid\n> \n> ```\n', 15],
    ['- ~~~mermaid\n', '- ```mermaid\n  \n  ```\n', 15],
    ['```mermaid\r\n', '```mermaid\r\n\r\n```\r\n', 12]
  ])('%j becomes an empty diagram block', (source, expected, caret) => {
    expect(enter(source, source.search(/\r?\n/u))).toEqual({ source: expected, caret })
  })

  it('keeps a language that only differs in case a code fence, as upstream matches the type exactly', () => {
    expect(enter('```Mermaid\n', 10)).toEqual({ source: '```Mermaid\n\n```\n', caret: 11 })
  })
})

describe('Enter on a fence opener indented one to three spaces (upstream #5600)', () => {
  it.each([
    [' ```\n', '```\n\n```\n', 4],
    ['  ```js\n', '```js\n\n```\n', 6],
    ['   ~~~js\n', '~~~js\n\n~~~\n', 6],
    ['  ~~~mermaid\n', '```mermaid\n\n```\n', 11],
    ['para\n\n ```\n', 'para\n\n```\n\n```\n', 10],
    ['>  ```js\n', '> ```js\n> \n> ```\n', 10],
    ['- a\n\n   ```js\n', '- a\n\n  ```js\n  \n  ```\n', 15],
    ['> - a\n>\n>    ```js\n', '> - a\n>\n>   ```js\n>   \n>   ```\n', 22]
  ])('%j drops the opener\'s own indentation', (source, expected, caret) => {
    expect(enter(source, source.length - 1)).toEqual({ source: expected, caret })
  })

  it('keeps an item\'s content column, which is no indentation of the opener', () => {
    expect(enter('-   ```js\n', 9)).toEqual({ source: '-   ```js\n    \n    ```\n', caret: 14 })
  })
})

describe('Picking a fence opener\'s language (upstream #5600)', () => {
  it.each([
    ['```mer\n', 'mermaid', '```mermaid\n\n```\n', 11],
    ['~~~mer\n', 'mermaid', '```mermaid\n\n```\n', 11],
    ['  ```j\n', 'javascript', '```javascript\n\n```\n', 14],
    ['> ~~~j\n', 'javascript', '> ~~~javascript\n> \n> ~~~\n', 18]
  ])('%j picked as %s', (source, language, expected, caret) => {
    expect(pick(source, source.length - 1, language)).toEqual({ source: expected, caret })
  })
})

describe('A diagram fence read from a file (upstream #5600)', () => {
  // Upstream's markdownToState makes a diagram of a fence only when its info
  // string's first word is exactly a diagram type; any other spelling is code.
  const blockKinds = (source: string) => {
    const core = createDocumentCore()
    const syntax = core.project(core.open(source), 'markup').syntax
    return syntax.ast.root.children.map(node => [node.kind, node.attributes.language ?? node.attributes.info])
  }

  it.each([
    ['```mermaid\ngraph TD\n```\n', 'diagram', 'mermaid'],
    ['~~~vega-lite\n{}\n~~~\n', 'diagram', 'vega-lite'],
    ['```sequence extra\nA->B: x\n```\n', 'diagram', 'sequence'],
    ['```Mermaid\ngraph TD\n```\n', 'code-block', 'Mermaid'],
    ['~~~MERMAID\ngraph TD\n~~~\n', 'code-block', 'MERMAID'],
    ['```PlantUML\n@startuml\n```\n', 'code-block', 'PlantUML']
  ])('%j is read as a %s', (source, kind, language) => {
    expect(blockKinds(source)).toEqual([[kind, language]])
  })

  it('reads a misspelled diagram opener typed and entered as code', () => {
    expect(enter('~~~Mermaid\n', 10)).toEqual({ source: '~~~Mermaid\n\n~~~\n', caret: 11 })
  })
})

describe('Picking a language for a long or spaced fence opener (upstream #5600)', () => {
  // Upstream's picker makes a new code block without a fence length, which its
  // serializer writes as three fence characters directly before the language.
  it.each([
    ['````j\n', 'javascript', '```javascript\n\n```\n', 14],
    ['~~~~~j\n', 'javascript', '~~~javascript\n\n~~~\n', 14],
    ['``` j\n', 'javascript', '```javascript\n\n```\n', 14],
    ['- ````j\n', 'javascript', '- ```javascript\n  \n  ```\n', 18]
  ])('%j picked as %s', (source, language, expected, caret) => {
    expect(pick(source, source.length - 1, language)).toEqual({ source: expected, caret })
  })
})
