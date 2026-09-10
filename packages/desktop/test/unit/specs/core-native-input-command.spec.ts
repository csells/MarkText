import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '@marktext/document-core'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createCoreDocumentSessionManager } from '@/documentAuthority/coreDocumentSessionManager'

const options = { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
const action = (at: number, data: string) => ({
  range: { start: at, end: at },
  selection: { ranges: [{ anchor: at, focus: at }], primary: 0 },
  inputType: 'insertText',
  data,
  options
})
const boot = async(source: string) => {
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({
    request: (request) => actor.handle(request),
    dispose: () => actor.dispose()
  })
  await binding.open({ documentId: 'input-command.md', source })
  return binding
}

describe('first-class Core native input command', () => {
  it('plans queued Markdown pairing against the latest admitted revision and shares one undo group', async() => {
    const binding = await boot('seed')
    try {
      expect(
        await binding.submit({
          kind: 'input',
          action: action(4, ' '),
          tracked: false,
          nativeHistoryGroup: 'input:1',
          projections: []
        }).acknowledged
      ).toMatchObject({ type: 'applied' })
      const paired = await binding.submit({
        kind: 'input',
        action: action(5, '*'),
        tracked: false,
        nativeHistoryGroup: 'input:1',
        projections: []
      }).acknowledged
      expect(paired).toMatchObject({
        type: 'applied',
        inputResult: {
          selection: { ranges: [{ anchor: 6, focus: 6 }], primary: 0 },
          policy: { reconciliation: [{ start: 6, end: 6, insert: '*' }] },
          compilerReconciliation: []
        }
      })
      expect(await binding.sourceAtBarrier()).toMatchObject({ source: 'seed **' })
      await binding.submit({ kind: 'undo', projections: [] }).acknowledged
      expect(await binding.sourceAtBarrier()).toMatchObject({ source: 'seed' })
      await binding.submit({ kind: 'redo', projections: [] }).acknowledged
      expect(await binding.sourceAtBarrier()).toMatchObject({ source: 'seed **' })
    } finally {
      binding.dispose()
    }
  })

  it('skips a closer without advancing source revision or replacing the existing undo entry', async() => {
    const binding = await boot('seed')
    try {
      const first = await binding.submit({
        kind: 'input',
        action: action(4, '('),
        tracked: false,
        projections: []
      }).acknowledged
      const skipped = await binding.submit({
        kind: 'input',
        action: action(5, ')'),
        tracked: false,
        projections: []
      }).acknowledged
      expect(skipped).toMatchObject({
        type: 'applied',
        revision: first.revision,
        change: { appliedEdits: [], projections: [] },
        inputResult: {
          selection: { ranges: [{ anchor: 6, focus: 6 }], primary: 0 },
          compilerReconciliation: []
        }
      })
      expect(await binding.sourceAtBarrier()).toMatchObject({ source: 'seed()' })
      await binding.submit({ kind: 'undo', projections: [] }).acknowledged
      expect(await binding.sourceAtBarrier()).toMatchObject({ source: 'seed' })
      expect(await binding.submit({ kind: 'undo', projections: [] }).acknowledged).toMatchObject({
        type: 'rejected',
        reason: 'history-empty'
      })
    } finally {
      binding.dispose()
    }
  })

  it('maps the paired caret through tracked wrapper spelling using Core provenance', async() => {
    const binding = await boot('seed')
    try {
      const reply = await binding.submit({
        kind: 'input',
        action: action(4, '('),
        tracked: true,
        projections: ['markup']
      }).acknowledged
      expect(reply).toMatchObject({
        type: 'applied',
        inputResult: {
          selection: { ranges: [{ anchor: 8, focus: 8 }], primary: 0 },
          policy: {
            edits: [{ start: 4, end: 4, insert: '()' }],
            reconciliation: [{ start: 5, end: 5, insert: ')' }]
          },
          compilerReconciliation: [
            { start: 4, end: 4, insert: '{++' },
            { start: 6, end: 6, insert: '++}' }
          ]
        }
      })
      expect(await binding.sourceAtBarrier()).toMatchObject({ source: 'seed{++()++}' })
      await binding.submit({ kind: 'undo', projections: [] }).acknowledged
      expect(await binding.sourceAtBarrier()).toMatchObject({ source: 'seed' })
    } finally {
      binding.dispose()
    }
  })

  it('rejects input outside the document without changing source or history', async() => {
    const binding = await boot('seed')
    try {
      expect(
        await binding.submit({
          kind: 'input',
          action: action(40, '('),
          tracked: false,
          projections: []
        }).acknowledged
      ).toMatchObject({ type: 'rejected', reason: 'author-invalid' })
      expect(await binding.sourceAtBarrier()).toMatchObject({
        source: 'seed',
        recoveryHistory: { undo: [], redo: [] }
      })
      expect(
        await binding.submit({
          kind: 'input',
          action: action(4, '('),
          tracked: false,
          projections: []
        }).acknowledged
      ).toMatchObject({ type: 'applied' })
      expect(await binding.sourceAtBarrier()).toMatchObject({ source: 'seed()' })
    } finally {
      binding.dispose()
    }
  })

  it('applies the existing history budget before admitting input policy expansion', async() => {
    const actor = createCoreActor(undefined, { maximumHistoryInsertUnits: 1 })
    const binding = createEditorCoreBinding({
      request: (request) => actor.handle(request),
      dispose: () => actor.dispose()
    })
    await binding.open({ documentId: 'input-resource.md', source: 'seed' })
    try {
      const rejected = await binding.submit({
        kind: 'input',
        action: action(4, '('),
        tracked: false,
        projections: []
      }).acknowledged
      expect(rejected).toMatchObject({ type: 'rejected', reason: 'history-resource' })
      expect(() => binding.sourceAtBarrier()).toThrow('reconciliation is required')
      expect(
        actor.handle({
          type: 'source-at-barrier',
          session: rejected.session,
          sequence: rejected.sequence + 1,
          baseRevision: rejected.revision
        })
      ).toMatchObject({ source: 'seed', recoveryHistory: { undo: [], redo: [] } })
    } finally {
      binding.dispose()
    }
  })

  it('admits the submitted action and options before later caller mutations', async() => {
    const actor = createCoreActor()
    const binding = createEditorCoreBinding({
      request: (request) => {
        return actor.handle(request)
      },
      dispose: () => actor.dispose()
    })
    await binding.open({ documentId: 'pending-input.md', source: 'seed' })
    const requested = { ...action(4, '('), options: { ...options } }
    try {
      const submission = binding.submit({
        kind: 'input',
        action: requested,
        tracked: false,
        projections: []
      })
      requested.range.start = 0
      requested.selection.ranges[0].anchor = 0
      requested.data = 'x'
      requested.options.autoPairBracket = false
      expect(await submission.acknowledged).toMatchObject({ type: 'applied' })
      expect(await binding.sourceAtBarrier()).toMatchObject({ source: 'seed()' })
    } finally {
      binding.dispose()
    }
  })
})

describe('input command document recovery', () => {
  it('replays accepted input actions without journaling closer skips', async() => {
    let generation = 0
    const replayed: string[] = []
    const manager = createCoreDocumentSessionManager({
      createBinding: () => {
        const actor = createCoreActor()
        const currentGeneration = ++generation
        return createEditorCoreBinding({
          request: (request) => {
            if (currentGeneration > 1 && request.type === 'input') {
              if (!('data' in request.action)) { throw new Error('Unexpected structural command in text replay fixture') }
              replayed.push(request.action.data ?? '')
            }
            return actor.handle(request)
          },
          dispose: () => actor.dispose()
        })
      }
    })
    const documentId = 'input-journal.md'
    await manager.open({ documentId, source: 'seed', lineEnding: '\n' })
    let lease = manager.lease(documentId)
    try {
      const first = await lease.binding.submit({
        kind: 'input',
        action: action(4, '('),
        tracked: false,
        nativeHistoryGroup: 'input:1',
        projections: []
      }).acknowledged
      const skipped = await lease.binding.submit({
        kind: 'input',
        action: action(5, ')'),
        tracked: false,
        projections: []
      }).acknowledged
      expect(skipped).toMatchObject({
        type: 'applied',
        revision: first.revision,
        change: { appliedEdits: [] }
      })
      expect(
        await lease.binding.submit({
          kind: 'input',
          action: action(6, 'x'),
          tracked: false,
          nativeHistoryGroup: 'input:1',
          projections: []
        }).acknowledged
      ).toMatchObject({ type: 'applied' })
      lease.faultView(new Error('Presentation disconnected'))
      lease = await manager.recover(lease)
      expect(replayed).toEqual(['(', 'x'])
      expect(await manager.saveBarrier(documentId)).toMatchObject({ source: 'seed()x' })
      expect(
        await lease.binding.submit({ kind: 'undo', projections: [] }).acknowledged
      ).toMatchObject({ type: 'applied' })
      expect(await manager.saveBarrier(documentId)).toMatchObject({ source: 'seed' })
    } finally {
      await manager.handoff(lease)
      await manager.close(documentId)
    }
  })

  it('requires recovery after rejected input expansion and reopens unchanged source', async() => {
    const manager = createCoreDocumentSessionManager({
      createBinding: () => {
        const actor = createCoreActor(undefined, { maximumHistoryInsertUnits: 1 })
        return createEditorCoreBinding({
          request: (request) => actor.handle(request),
          dispose: () => actor.dispose()
        })
      }
    })
    const documentId = 'input-budget.md'
    await manager.open({ documentId, source: 'seed', lineEnding: '\n' })
    let lease = manager.lease(documentId)
    try {
      expect(
        await lease.binding.submit({
          kind: 'input',
          action: action(4, '('),
          tracked: false,
          projections: []
        }).acknowledged
      ).toMatchObject({ type: 'rejected', reason: 'history-resource' })
      await expect(manager.saveBarrier(documentId)).rejects.toThrow(
        'Core document requires reconciliation: rejected'
      )
      lease.faultView(new Error('Input expansion was not accepted'))
      lease = await manager.recover(lease)
      expect(await manager.saveBarrier(documentId)).toMatchObject({ source: 'seed' })
      expect(
        await lease.binding.submit({ kind: 'undo', projections: [] }).acknowledged
      ).toMatchObject({ type: 'rejected', reason: 'history-empty' })
    } finally {
      await manager.handoff(lease)
      await manager.close(documentId)
    }
  })
})

it('journals explicit table commands through the same document input owner', async() => {
  const source = '| a{++a++} | bb |\n| --- | --- |\n| cc | dd |\n'
  const manager = createCoreDocumentSessionManager({
    createBinding: () => {
      const actor = createCoreActor()
      return createEditorCoreBinding({
        request: (request) => actor.handle(request),
        dispose: () => actor.dispose()
      })
    }
  })
  const documentId = 'table-command.md'
  await manager.open({ documentId, source, lineEnding: '\n' })
  let lease = manager.lease(documentId)
  try {
    const submitted = lease.binding.submit({
      kind: 'input',
      action: {
        kind: 'command',
        command: 'insertTableRow',
        placement: 'after',
        selection: { ranges: [{ anchor: 3, focus: 3 }], primary: 0 },
        options
      },
      tracked: false,
      projections: []
    }).acknowledged
    expect(submitted).toMatchObject({
      type: 'applied',
      inputResult: { selection: { ranges: [{ anchor: 38, focus: 38 }], primary: 0 } }
    })
    const expected = '| a{++a++} | bb |\n| --- | --- |\n|     |     |\n| cc | dd |\n'
    expect(await manager.saveBarrier(documentId)).toMatchObject({ source: expected })
    lease.faultView(new Error('Controlled presentation failure after table command'))
    lease = await manager.recover(lease)
    expect(await manager.saveBarrier(documentId)).toMatchObject({ source: expected })
    expect(lease.binding.submit({ kind: 'undo', projections: [] }).acknowledged).toMatchObject({
      type: 'applied'
    })
    expect(await manager.saveBarrier(documentId)).toMatchObject({ source })
  } finally {
    await manager.handoff(lease)
    await manager.close(documentId)
  }
})

it('tracks table row commands through the existing structural edit compiler', async() => {
  const source = '| aa | bb |\n| --- | --- |\n| cc | dd |\n'
  const binding = await boot(source)
  try {
    const reply = binding.submit({
      kind: 'input',
      action: {
        kind: 'command',
        command: 'insertTableRow',
        placement: 'after',
        selection: { ranges: [{ anchor: 3, focus: 3 }], primary: 0 },
        options
      },
      tracked: true,
      projections: ['markup']
    }).acknowledged
    expect(reply).toMatchObject({
      type: 'applied',
      inputResult: { selection: { ranges: [{ anchor: 35, focus: 35 }], primary: 0 } }
    })
    expect(binding.sourceAtBarrier()).toMatchObject({
      source: '| aa | bb |\n| --- | --- |{++\n|     |     |++}\n| cc | dd |\n'
    })
    binding.submit({ kind: 'undo', projections: [] })
    expect(binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    binding.dispose()
  }
})

it('preserves existing annotations when a popup inserts a header above the current header', async() => {
  const source = 'away\n\n| a{++a++} | aa |\n| :--- | ---: |\n| aa | aa |\n'
  const binding = await boot(source)
  try {
    const reply = binding.submit({
      kind: 'input',
      action: {
        kind: 'command',
        command: 'insertTableRow',
        placement: 'before',
        selection: { ranges: [{ anchor: 8, focus: 8 }], primary: 0 },
        options
      },
      tracked: false,
      projections: ['markup']
    }).acknowledged
    expect(reply).toMatchObject({
      type: 'applied',
      inputResult: { selection: { ranges: [{ anchor: 12, focus: 12 }], primary: 0 } }
    })
    expect(binding.sourceAtBarrier()).toMatchObject({
      source: 'away\n\n|     |     |\n| :--- | ---: |\n| a{++a++} | aa |\n| aa | aa |\n'
    })
    binding.submit({ kind: 'undo', projections: [] })
    expect(binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    binding.dispose()
  }
})

it('tracks sparse header insertion with a resulting selection and faithful Original/Revised table structure', async() => {
  const source = 'away\n\n| a{++a++} | aa |\n| :--- | ---: |\n| aa | aa |\n'
  const binding = await boot(source)
  try {
    const reply = binding.submit({
      kind: 'input',
      action: {
        kind: 'command',
        command: 'insertTableRow',
        placement: 'before',
        selection: { ranges: [{ anchor: 8, focus: 8 }], primary: 0 },
        options
      },
      tracked: true,
      projections: ['markup']
    }).acknowledged
    expect(reply).toMatchObject({ type: 'applied', inputResult: { selection: expect.anything() } })
    const saved = binding.sourceAtBarrier()
    if (saved.type !== 'source') throw new Error('Missing accepted table source')
    expect(saved.source).toBe(
      'away\n\n{++|     |     |\n| :--- | ---: |\n++}| a{++a++} | aa |{--\n| :--- | ---: |--}\n| aa | aa |\n'
    )
    const core = createDocumentCore()
    const reopened = core.open(saved.source)
    expect(core.project(reopened, 'original').markdown).toBe(
      'away\n\n| a | aa |\n| :--- | ---: |\n| aa | aa |\n'
    )
    expect(core.project(reopened, 'revised').markdown).toBe(
      'away\n\n|     |     |\n| :--- | ---: |\n| aa | aa |\n| aa | aa |\n'
    )
    binding.submit({ kind: 'undo', projections: [] })
    expect(binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    binding.dispose()
  }
})

it.each([false, true])(
  'removes a table body row through the common owner with Track %s',
  async(tracked) => {
    const source = 'away\n\n| a{++a++} | aa |\n| :--- | ---: |\n| aa | aa |\n'
    const binding = await boot(source)
    try {
      const reply = binding.submit({
        kind: 'input',
        action: {
          kind: 'command',
          command: 'removeTableRow',
          selection: { ranges: [{ anchor: 42, focus: 42 }], primary: 0 },
          options
        },
        tracked,
        projections: ['markup']
      }).acknowledged
      expect(reply).toMatchObject({
        type: 'applied',
        inputResult: { selection: { ranges: [{ anchor: 8, focus: 8 }], primary: 0 } }
      })
      const expected = tracked
        ? 'away\n\n| a{++a++} | aa |\n| :--- | ---: |{--\n| aa | aa |--}\n'
        : 'away\n\n| a{++a++} | aa |\n| :--- | ---: |\n'
      expect(binding.sourceAtBarrier()).toMatchObject({ source: expected })
      binding.submit({ kind: 'undo', projections: [] })
      expect(binding.sourceAtBarrier()).toMatchObject({ source })
      binding.submit({ kind: 'redo', projections: [] })
      expect(binding.sourceAtBarrier()).toMatchObject({ source: expected })
    } finally {
      binding.dispose()
    }
  }
)

it('tracks header removal while preserving the surviving annotated row and both reader projections', async() => {
  const source = 'away\n\n| aa | aa |\n| :--- | ---: |\n| a{++a++} | aa |\n'
  const binding = await boot(source)
  try {
    const reply = binding.submit({
      kind: 'input',
      action: {
        kind: 'command',
        command: 'removeTableRow',
        selection: { ranges: [{ anchor: 8, focus: 8 }], primary: 0 },
        options
      },
      tracked: true,
      projections: ['markup']
    }).acknowledged
    expect(reply).toMatchObject({
      type: 'applied',
      inputResult: { selection: { ranges: [{ anchor: 42, focus: 42 }], primary: 0 } }
    })
    const expected =
      'away\n\n{--| aa | aa |\n| :--- | ---: |\n--}| a{++a++} | aa |{++\n| :--- | ---: |++}\n'
    expect(binding.sourceAtBarrier()).toMatchObject({ source: expected })
    const core = createDocumentCore()
    const reopened = core.open(expected)
    expect(core.project(reopened, 'original').markdown).toBe(
      'away\n\n| aa | aa |\n| :--- | ---: |\n| a | aa |\n'
    )
    expect(core.project(reopened, 'revised').markdown).toBe(
      'away\n\n| aa | aa |\n| :--- | ---: |\n'
    )
    binding.submit({ kind: 'undo', projections: [] })
    expect(binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    binding.dispose()
  }
})

it.each([
  {
    command: 'insertTableColumn' as const,
    caret: 26,
    expected:
      'away\n\n| a{++a++} |{++     |++} aa |\n| :--- |{++ --- |++} ---: |\n| aa |{++     |++} aa |\n',
    revised: 'away\n\n| aa |     | aa |\n| :--- | --- | ---: |\n| aa |     | aa |\n'
  },
  {
    command: 'removeTableColumn' as const,
    caret: 8,
    expected: 'away\n\n| a{++a++} {--| aa --}|\n| :--- {--| ---: --}|\n| aa {--| aa --}|\n',
    revised: 'away\n\n| aa |\n| :--- |\n| aa |\n'
  }
])(
  'tracks $command through the same owner without rewriting unrelated source',
  async({ command, caret, expected, revised }) => {
    const source = 'away\n\n| a{++a++} | aa |\n| :--- | ---: |\n| aa | aa |\n'
    const binding = await boot(source)
    try {
      const action = {
        kind: 'command' as const,
        ...(command === 'insertTableColumn'
          ? { command, placement: 'before' as const }
          : { command }),
        selection: { ranges: [{ anchor: 20, focus: 20 }], primary: 0 },
        options
      }
      const reply = binding.submit({
        kind: 'input',
        action,
        tracked: true,
        projections: ['markup']
      }).acknowledged
      expect(reply).toMatchObject({
        type: 'applied',
        inputResult: { selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 } }
      })
      expect(binding.sourceAtBarrier()).toMatchObject({ source: expected })
      const core = createDocumentCore()
      const reopened = core.open(expected)
      expect(core.project(reopened, 'original').markdown).toBe(
        'away\n\n| a | aa |\n| :--- | ---: |\n| aa | aa |\n'
      )
      expect(core.project(reopened, 'revised').markdown).toBe(revised)
      binding.submit({ kind: 'undo', projections: [] })
      expect(binding.sourceAtBarrier()).toMatchObject({ source })
      binding.submit({ kind: 'redo', projections: [] })
      expect(binding.sourceAtBarrier()).toMatchObject({ source: expected })
    } finally {
      binding.dispose()
    }
  }
)
