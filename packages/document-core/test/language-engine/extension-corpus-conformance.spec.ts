import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  renderMarkdownHtml,
  type MarkdownOptionsV1,
  type MarkdownNode,
  type ParseConfiguration
} from '@marktext/document-core'

interface GfmCase {
  readonly id: string
  readonly example: number
  readonly construct: string
  readonly source: string
  readonly rootKinds: readonly string[]
  readonly html: string
  readonly table?: {
    readonly range: readonly [number, number]
    readonly columns: number
    readonly rows: readonly {
      readonly range: readonly [number, number]
      readonly header: boolean
      readonly cells: readonly {
        readonly range: readonly [number, number]
        readonly alignment: 'none' | 'left' | 'center' | 'right'
      }[]
    }[]
  }
  readonly taskLists?: readonly {
    readonly range: readonly [number, number]
  }[]
  readonly tasks?: readonly {
    readonly range: readonly [number, number]
    readonly marker: readonly [number, number]
    readonly checked: boolean
  }[]
  readonly strikethroughs?: readonly {
    readonly range: readonly [number, number]
  }[]
  readonly autolinks?: readonly {
    readonly range: readonly [number, number]
    readonly destination: string
    readonly type: 'www' | 'url' | 'email'
  }[]
  readonly tagFiltered?: readonly {
    readonly kind: 'inline-html' | 'html-block'
    readonly range: readonly [number, number]
  }[]
}

interface BuiltinCase {
  readonly id: string
  readonly construct: string
  readonly source: string
  readonly options?: Partial<MarkdownOptionsV1>
  readonly rootKinds: readonly string[]
  readonly inlineKinds?: readonly string[]
  readonly featureNodes?: readonly {
    readonly kind: string
    readonly range: readonly [number, number]
    readonly attributes?: Readonly<Record<string, string | number | boolean>>
  }[]
  readonly html: string
}

interface ExtensionCorpus<Row> {
  readonly id: string
  readonly version: string
  readonly cases: readonly Row[]
}

const TEST_CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  markdownOptions: {
    schema: 'markdown-options-1',
    gfm: true,
    frontMatter: true,
    math: true,
    gitLabMath: false,
    footnotes: false,
    subscriptAndSuperscript: true
  },
  liveHtmlSafetyProfile: 'live-html-sanitized-v1',
  executionBudget: {
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

const GFM_CONFIGURATION: ParseConfiguration = {
  ...TEST_CONFIGURATION,
  markdownOptions: {
    ...TEST_CONFIGURATION.markdownOptions,
    subscriptAndSuperscript: false
  }
}

const MARKTEXT_BUILTINS_CONFIGURATION: ParseConfiguration = {
  ...TEST_CONFIGURATION,
  markdownOptions: {
    ...TEST_CONFIGURATION.markdownOptions,
    gitLabMath: true,
    footnotes: true
  }
}

function readFixture<Row>(name: string): ExtensionCorpus<Row> {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')
  ) as ExtensionCorpus<Row>
}

const GFM = readFixture<GfmCase>('gfm-profile1-0.29.json')
const MARKTEXT_BUILTINS = readFixture<BuiltinCase>('marktext-builtins-1.json')

function childKinds(node: MarkdownNode): readonly string[] {
  return Array.from({ length: node.childCount }, (_, ordinal) => node.childAt(ordinal).kind)
}

function rangeTuple(node: MarkdownNode): readonly [number, number] {
  return [node.range.start, node.range.end]
}

function descendants(node: MarkdownNode): readonly MarkdownNode[] {
  const result: MarkdownNode[] = []
  const visit = (candidate: MarkdownNode): void => {
    result.push(candidate)
    for (let ordinal = 0; ordinal < candidate.childCount; ordinal += 1) {
      visit(candidate.childAt(ordinal))
    }
  }
  visit(node)
  return result
}

describe('Profile 1 pinned extension corpora', () => {
  const engine = createLanguageEngine()

  it.each(GFM.cases)('GFM/$id matches the pinned public structure and HTML', (row) => {
    const revision = engine.open(createSourceSnapshot(row.source), GFM_CONFIGURATION)

    expect(revision.kind, row.id).toBe('complete')
    if (revision.kind !== 'complete') {
      return
    }
    expect(revision.source.text, row.id).toBe(row.source)

    for (const view of ['original', 'revised', 'editing'] as const) {
      const projected = revision.projection(view)
      expect(projected.source, `${row.id}/${view}/source`).toBe(row.source)
      expect(childKinds(projected.markdown.root), `${row.id}/${view}/roots`)
        .toEqual(row.rootKinds)
      expect(renderMarkdownHtml(projected.markdown), `${row.id}/${view}/html`)
        .toBe(row.html)

      if (row.table !== undefined) {
        const table = Array.from(
          { length: projected.markdown.root.childCount },
          (_, ordinal) => projected.markdown.root.childAt(ordinal)
        ).find((node) => node.kind === 'table')
        expect(table, `${row.id}/${view}/table`).toBeDefined()
        if (table === undefined) {
          continue
        }
        expect(rangeTuple(table), `${row.id}/${view}/table range`)
          .toEqual(row.table.range)
        expect(table.attributes['columns'], `${row.id}/${view}/columns`)
          .toBe(row.table.columns)
        expect(table.childCount, `${row.id}/${view}/row count`)
          .toBe(row.table.rows.length)
        row.table.rows.forEach((expectedRow, rowOrdinal) => {
          const tableRow = table.childAt(rowOrdinal)
          expect(tableRow.kind, `${row.id}/${view}/row ${rowOrdinal}`)
            .toBe('table-row')
          expect(rangeTuple(tableRow), `${row.id}/${view}/row ${rowOrdinal} range`)
            .toEqual(expectedRow.range)
          expect(tableRow.attributes['header'], `${row.id}/${view}/row ${rowOrdinal} header`)
            .toBe(expectedRow.header)
          expect(tableRow.childCount, `${row.id}/${view}/row ${rowOrdinal} cell count`)
            .toBe(expectedRow.cells.length)
          expectedRow.cells.forEach((expectedCell, cellOrdinal) => {
            const cell = tableRow.childAt(cellOrdinal)
            expect(cell.kind, `${row.id}/${view}/cell ${rowOrdinal}:${cellOrdinal}`)
              .toBe('table-cell')
            expect(
              rangeTuple(cell),
              `${row.id}/${view}/cell ${rowOrdinal}:${cellOrdinal} range`
            ).toEqual(expectedCell.range)
            expect(
              cell.attributes['alignment'],
              `${row.id}/${view}/cell ${rowOrdinal}:${cellOrdinal} alignment`
            ).toBe(expectedCell.alignment)
          })
        })
      }

      if (row.taskLists !== undefined) {
        const taskLists = descendants(projected.markdown.root).filter(
          node => node.kind === 'list' && node.attributes['taskList'] === true
        )
        expect(
          taskLists.map(rangeTuple),
          `${row.id}/${view}/task-list ranges`
        ).toEqual(row.taskLists.map(({ range }) => range))
      }

      if (row.tasks !== undefined) {
        const tasks = descendants(projected.markdown.root).filter(
          node => node.kind === 'list-item' && node.attributes['task'] === true
        )
        expect(tasks, `${row.id}/${view}/task count`)
          .toHaveLength(row.tasks.length)
        row.tasks.forEach((expectedTask, ordinal) => {
          const task = tasks[ordinal]
          expect(task, `${row.id}/${view}/task ${ordinal}`).toBeDefined()
          if (task === undefined) {
            return
          }
          expect(rangeTuple(task), `${row.id}/${view}/task ${ordinal} range`)
            .toEqual(expectedTask.range)
          expect(
            [
              task.attributes['taskMarkerStart'],
              task.attributes['taskMarkerEnd']
            ],
            `${row.id}/${view}/task ${ordinal} marker`
          ).toEqual(expectedTask.marker)
          expect(task.attributes['checked'], `${row.id}/${view}/task ${ordinal} checked`)
            .toBe(expectedTask.checked)
        })
      }

      if (row.strikethroughs !== undefined) {
        const strikethroughs = descendants(projected.markdown.root).filter(
          node => node.kind === 'strikethrough'
        )
        expect(
          strikethroughs.map(rangeTuple),
          `${row.id}/${view}/strikethrough ranges`
        ).toEqual(row.strikethroughs.map(({ range }) => range))
      }

      if (row.autolinks !== undefined) {
        const autolinks = descendants(projected.markdown.root).filter(
          node =>
            node.kind === 'link' &&
            node.attributes['extendedAutolink'] === true
        )
        expect(autolinks, `${row.id}/${view}/autolink count`)
          .toHaveLength(row.autolinks.length)
        row.autolinks.forEach((expectedLink, ordinal) => {
          const link = autolinks[ordinal]
          expect(link, `${row.id}/${view}/autolink ${ordinal}`).toBeDefined()
          if (link === undefined) {
            return
          }
          expect(rangeTuple(link), `${row.id}/${view}/autolink ${ordinal} range`)
            .toEqual(expectedLink.range)
          expect(
            link.attributes,
            `${row.id}/${view}/autolink ${ordinal} attributes`
          ).toMatchObject({
            destination: expectedLink.destination,
            extendedAutolink: true,
            extendedAutolinkType: expectedLink.type
          })
          expect(childKinds(link), `${row.id}/${view}/autolink ${ordinal} children`)
            .toEqual(['text'])
        })
      }

      if (row.tagFiltered !== undefined) {
        const tagFiltered = descendants(projected.markdown.root).filter(
          node => node.attributes['gfmTagFilter'] === true
        )
        expect(
          tagFiltered.map(node => ({
            kind: node.kind,
            range: rangeTuple(node)
          })),
          `${row.id}/${view}/tag-filter nodes`
        ).toEqual(row.tagFiltered)
      }
    }
  })

  it.each(MARKTEXT_BUILTINS.cases)(
    'MARKTEXT_BUILTINS/$id matches the pinned public structure',
    (row) => {
      const configuration: ParseConfiguration = {
        ...MARKTEXT_BUILTINS_CONFIGURATION,
        markdownOptions: {
          ...MARKTEXT_BUILTINS_CONFIGURATION.markdownOptions,
          ...row.options
        }
      }
      const revision = engine.open(
        createSourceSnapshot(row.source),
        configuration
      )

      expect(revision.kind, row.id).toBe('complete')
      if (revision.kind !== 'complete') {
        return
      }
      expect(revision.source.text, row.id).toBe(row.source)

      for (const view of ['original', 'revised', 'editing'] as const) {
        const projected = revision.projection(view)
        expect(projected.source, `${row.id}/${view}/source`).toBe(row.source)
        expect(childKinds(projected.markdown.root), `${row.id}/${view}/roots`)
          .toEqual(row.rootKinds)
        if (row.inlineKinds !== undefined) {
          expect(
            childKinds(projected.markdown.root.childAt(0)),
            `${row.id}/${view}/inline`
          ).toEqual(row.inlineKinds)
        }
        if (row.featureNodes !== undefined) {
          const featureKinds = new Set(row.featureNodes.map(({ kind }) => kind))
          const featureNodes = descendants(projected.markdown.root)
            .filter(node => featureKinds.has(node.kind))
          expect(featureNodes, `${row.id}/${view}/feature count`)
            .toHaveLength(row.featureNodes.length)
          row.featureNodes.forEach((expectedNode, ordinal) => {
            const node = featureNodes[ordinal]
            expect(node, `${row.id}/${view}/feature ${ordinal}`).toBeDefined()
            if (node === undefined) {
              return
            }
            expect(node.kind, `${row.id}/${view}/feature ${ordinal} kind`)
              .toBe(expectedNode.kind)
            expect(rangeTuple(node), `${row.id}/${view}/feature ${ordinal} range`)
              .toEqual(expectedNode.range)
            if (expectedNode.attributes !== undefined) {
              expect(
                node.attributes,
                `${row.id}/${view}/feature ${ordinal} attributes`
              ).toMatchObject(expectedNode.attributes)
            }
          })
        }
        const firstHtml = renderMarkdownHtml(projected.markdown)
        expect(firstHtml, `${row.id}/${view}/html`).toBe(row.html)
        expect(renderMarkdownHtml(projected.markdown), `${row.id}/${view}/repeat html`)
          .toBe(firstHtml)
      }
      expect(revision.source.text, row.id).toBe(row.source)
    }
  )

  it('honors markdownOptions.frontMatter in the intrinsic block grammar', () => {
    const source = '---\ntitle: x\n---\nbody\n'
    const revision = engine.open(
      createSourceSnapshot(source),
      {
        ...TEST_CONFIGURATION,
        markdownOptions: {
          ...TEST_CONFIGURATION.markdownOptions,
          frontMatter: false
        }
      }
    )
    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      return
    }
    expect(childKinds(revision.projection('revised').markdown.root)).toEqual([
      'thematic-break',
      'heading',
      'paragraph'
    ])
  })

  it('gates all five pinned GFM constructs as one exact dialect switch', () => {
    const withoutGfm: ParseConfiguration = {
      ...TEST_CONFIGURATION,
      markdownOptions: {
        ...TEST_CONFIGURATION.markdownOptions,
        gfm: false
      }
    }
    const cases = [
      {
        source: '| a | b |\n| --- | --- |\n| c | d |\n',
        roots: ['paragraph'],
        inline: ['text', 'soft-break', 'text', 'soft-break', 'text'],
        html: '<p>| a | b |\n| --- | --- |\n| c | d |</p>\n'
      },
      {
        source: '- [x] done\n',
        roots: ['list'],
        itemAttributes: {},
        html: '<ul>\n<li>[x] done</li>\n</ul>\n'
      },
      {
        source: '~~gone~~\n',
        roots: ['paragraph'],
        inline: ['text'],
        html: '<p>~~gone~~</p>\n'
      },
      {
        source: 'www.example.com\n',
        roots: ['paragraph'],
        inline: ['text'],
        html: '<p>www.example.com</p>\n'
      },
      {
        source: 'a <title>x</title>\n',
        roots: ['paragraph'],
        inline: ['text', 'inline-html', 'text', 'inline-html'],
        html: '<p>a <title>x</title></p>\n'
      }
    ] as const

    for (const row of cases) {
      const revision = engine.open(createSourceSnapshot(row.source), withoutGfm)
      expect(revision.kind).toBe('complete')
      if (revision.kind !== 'complete') {
        continue
      }
      const root = revision.projection('revised').markdown.root
      expect(childKinds(root), row.source).toEqual(row.roots)
      if ('inline' in row) {
        expect(childKinds(root.childAt(0)), row.source).toEqual(row.inline)
      }
      if ('itemAttributes' in row) {
        expect(root.childAt(0).childAt(0).attributes, row.source)
          .not.toHaveProperty('task')
      }
      expect(
        renderMarkdownHtml(revision.projection('revised').markdown),
        row.source
      ).toBe(row.html)
    }
  })
})
