import { describe, expect, it } from 'vitest'
import {
  ClosedRecordError,
  closedRecord
} from '@shared/types/closedRecord'

const SHAPE = Object.freeze({
  required: Object.freeze(['documentId', 'revisionId']),
  optional: Object.freeze(['matchCase'])
})

// G20: twenty-two codec modules carried their own `closedRecord`, at two
// strengths that differed by accident rather than design — one rejected unknown
// keys but let a missing key through, the other demanded exact key-set equality
// and so could not express an optional field at all. The wire surface carries
// twelve optional fields, so neither strength was right. One decoder, over
// which each record declares its permitted keys and which of them are required.
describe('closed record decoder', () => {
  it('accepts a record carrying every declared key', () => {
    expect(closedRecord({
      documentId: 'document:1',
      revisionId: 'revision:1',
      matchCase: true
    }, 'search', SHAPE)).toMatchObject({ documentId: 'document:1' })
  })

  it('accepts a record omitting a declared-optional key', () => {
    expect(closedRecord({
      documentId: 'document:1',
      revisionId: 'revision:1'
    }, 'search', SHAPE)).toMatchObject({ revisionId: 'revision:1' })
  })

  // A structured-clone hop yields a plain object literal and nothing else, so a
  // null-prototype value carrying the right keys did not come from our encoder.
  it('rejects a null-prototype record', () => {
    const value = Object.create(null) as Record<string, unknown>
    value.documentId = 'document:1'
    value.revisionId = 'revision:1'
    try {
      closedRecord(value, 'search', SHAPE)
      throw new Error('expected a rejection')
    } catch (error) {
      expect((error as ClosedRecordError).rejection).toBe('non-plain-prototype')
    }
  })

  it.each([
    {
      name: 'a non-object',
      value: 'search',
      rejection: 'not-a-record',
      key: null
    },
    {
      name: 'an array',
      value: ['document:1'],
      rejection: 'not-a-record',
      key: null
    },
    {
      name: 'an undeclared key',
      value: {
        documentId: 'document:1',
        revisionId: 'revision:1',
        rogue: 1
      },
      rejection: 'unknown-key',
      key: 'rogue'
    },
    {
      name: 'a missing required key',
      value: { documentId: 'document:1', matchCase: true },
      rejection: 'missing-required-key',
      key: 'revisionId'
    }
  ])('rejects $name', ({ value, rejection, key }) => {
    expect(() => closedRecord(value, 'search', SHAPE)).toThrow(ClosedRecordError)
    try {
      closedRecord(value, 'search', SHAPE)
      throw new Error('expected a rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(ClosedRecordError)
      const rejected = error as ClosedRecordError
      expect(rejected.rejection).toBe(rejection)
      expect(rejected.key).toBe(key)
      expect(rejected.label).toBe('search')
    }
  })

  it('rejects a class instance as a non-plain prototype', () => {
    class Request {
      documentId = 'document:1'
      revisionId = 'revision:1'
    }
    try {
      closedRecord(new Request(), 'search', SHAPE)
      throw new Error('expected a rejection')
    } catch (error) {
      expect((error as ClosedRecordError).rejection).toBe('non-plain-prototype')
    }
  })

  it('rejects an accessor where a data field was declared', () => {
    const value = {
      documentId: 'document:1',
      get revisionId(): string {
        return 'revision:1'
      }
    }
    try {
      closedRecord(value, 'search', SHAPE)
      throw new Error('expected a rejection')
    } catch (error) {
      expect((error as ClosedRecordError).rejection).toBe('non-data-field')
      expect((error as ClosedRecordError).key).toBe('revisionId')
    }
  })

  // A decoder that silently aliased a prototype-chain property would let a
  // polluted prototype answer for a field the sender never wrote.
  it('does not accept an inherited key as a declared field', () => {
    const value = Object.create({ revisionId: 'revision:inherited' }) as
      Record<string, unknown>
    value.documentId = 'document:1'
    try {
      closedRecord(value, 'search', SHAPE)
      throw new Error('expected a rejection')
    } catch (error) {
      expect((error as ClosedRecordError).rejection)
        .toBe('non-plain-prototype')
    }
  })
})
