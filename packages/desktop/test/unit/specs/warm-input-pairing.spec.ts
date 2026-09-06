import { describe, expect, it } from 'vitest'
import { pairAppendedInputs } from '../../e2e/helpers/warmInputPairing'

describe('Warm append input attribution', () => {
  it('attributes each browser input to the transaction containing it when Muya batches keys', () => {
    expect(pairAppendedInputs([
      { data: 'a', inputType: 'insertText', tEvent: 1 },
      { data: 'b', inputType: 'insertText', tEvent: 2 },
      { data: '😀', inputType: 'insertText', tEvent: 4 }
    ], [
      { transaction: 7, at: 3, insertedUnits: 2, deletedUnits: 0 },
      { transaction: 8, at: 5, insertedUnits: 2, deletedUnits: 0 }
    ])).toEqual([7, 7, 8])
  })

  it('refuses missing units, replacement edits, and dispatches preceding their inputs', () => {
    const inputs = [{ data: 'ab', inputType: 'insertText', tEvent: 2 }]
    for (const transaction of [
      { transaction: 1, at: 3, insertedUnits: 1, deletedUnits: 0 },
      { transaction: 1, at: 3, insertedUnits: 2, deletedUnits: 1 },
      { transaction: 1, at: 1, insertedUnits: 2, deletedUnits: 0 }
    ]) expect(pairAppendedInputs(inputs, [transaction])).toBeUndefined()
  })
})
