import { performance } from 'node:perf_hooks'
import { createDocumentCore } from '@marktext/document-core'
import { expect, it } from 'vitest'
import { createMuyaMarkupView } from '@/documentAuthority/muyaMarkupView'
import {
  assertMuyaDocumentSourceBinding,
  assertMuyaPlainTextSourceBinding
} from '@/documentAuthority/muyaPlainTextSourceEdit'

it('requires owned syntax for normalized presentation and keeps native diff decoding strict', () => {
  const source = '  ```\n\tbody\n  ```\n'
  const core = createDocumentCore()
  const revision = core.open(source)
  const binding = createMuyaMarkupView(
    core.project(revision, 'markup'),
    revision.annotations,
    source
  ).bindings[0]
  expect(() => assertMuyaDocumentSourceBinding(binding)).not.toThrow()
  expect(() => assertMuyaPlainTextSourceBinding(binding)).toThrow(
    'Muya source segments are invalid'
  )
  const { syntax: _syntax, ...unowned } = binding
  expect(() => assertMuyaDocumentSourceBinding(unowned)).toThrow('Muya source segments are invalid')
  expect(() => assertMuyaDocumentSourceBinding({ ...binding, text: 'xxbody' })).toThrow(
    'Muya source segments are invalid'
  )
})

it('validates a long normalized code payload within the retained reconciliation budget', () => {
  const source = '  ```\n' + '\tbody\n'.repeat(4000) + '  ```\n'
  const core = createDocumentCore()
  const revision = core.open(source)
  const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations, source)
  expect(view.bindings).toHaveLength(1)
  expect(view.bindings[0].text).toBe(Array(4000).fill('  body').join('\n'))
  const times = Array.from({ length: 5 }, () => {
    const start = performance.now()
    assertMuyaDocumentSourceBinding(view.bindings[0])
    return performance.now() - start
  })
  // Validation is one part of the existing 50 ms acknowledgement/reconcile budget.
  // Run timing checks without competing test files or build workloads.
  expect(Math.max(...times)).toBeLessThanOrEqual(50)
  expect(revision.source).toBe(source)
})
