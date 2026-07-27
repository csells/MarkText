import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  resolveStaticOutput,
  retainStaticOutput
} from 'main_renderer/presentation/staticOutputAuthority'

const request = Object.freeze({
  schema: 'static-output-reveal-1' as const,
  documentId: 'document:one',
  revisionId: 'revision:one',
  consumer: 'pdf' as const,
  view: 'markup' as const
})

describe('static output authority', () => {
  it('resolves only an output retained for the same renderer and identity', () => {
    const retained = path.resolve('/retained/review.pdf')
    retainStaticOutput({ id: 401 }, request, retained)

    expect(resolveStaticOutput({ id: 401 }, request)).toBe(retained)
    expect(() => resolveStaticOutput({ id: 402 }, request))
      .toThrow(/not retained/i)
    expect(() => resolveStaticOutput(
      { id: 401 },
      { ...request, view: 'revised' }
    )).toThrow(/not retained/i)
  })

  it('rejects a non-absolute retained output', () => {
    expect(() => retainStaticOutput(
      { id: 403 },
      request,
      'renderer-relative.pdf'
    )).toThrow(/absolute/i)
  })
})
