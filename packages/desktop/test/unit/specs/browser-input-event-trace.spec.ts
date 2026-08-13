import { describe, expect, it } from 'vitest'

import {
  expectedCodeMirrorInputCheckpoint,
  observeCodeMirrorDocumentCheckpoint,
  requireCompleteBrowserInputEventSample
} from '../../e2e/helpers/browserInputEventTrace'

describe('browser-external CodeMirror input trace', () => {
  it('derives the exact document checkpoint for a selected insertText edit', () => {
    expect(expectedCodeMirrorInputCheckpoint({
      value: 'alpha beta',
      selectionStart: 6,
      selectionEnd: 10,
      data: 'BETA'
    })).toEqual({
      value: 'alpha BETA',
      valueLength: 10,
      valueHash: '851287e3'
    })
  })

  it('publishes echo then frame only while the exact value is retained', () => {
    const sample = {
      expectedValue: 'alpha BETA',
      expectedDocumentCheckpoint: {
        valueLength: 10,
        valueHash: '851287e3'
      }
    }

    expect(observeCodeMirrorDocumentCheckpoint(
      sample,
      'alpha beta',
      11,
      'echo'
    )).toBe(false)
    expect(observeCodeMirrorDocumentCheckpoint(
      sample,
      'alpha BETA',
      12,
      'echo'
    )).toBe(true)
    expect(sample).toMatchObject({
      tEcho: 12,
      echoDocumentCheckpoint: sample.expectedDocumentCheckpoint,
      expectedValue: 'alpha BETA'
    })
    expect(observeCodeMirrorDocumentCheckpoint(
      sample,
      'alpha BETA!',
      13,
      'frame'
    )).toBe(false)
    expect(observeCodeMirrorDocumentCheckpoint(
      sample,
      'alpha BETA',
      14,
      'frame'
    )).toBe(true)
    expect(sample).toMatchObject({
      tFrame: 14,
      frameDocumentCheckpoint: sample.expectedDocumentCheckpoint,
      expectedValue: undefined
    })
  })

  it('maps reversed CodeMirror selections and astral inserts in UTF-16 units', () => {
    expect(expectedCodeMirrorInputCheckpoint({
      value: 'a😀bc',
      selectionStart: 1,
      selectionEnd: 3,
      data: '🚀'
    })).toMatchObject({
      value: 'a🚀bc',
      valueLength: 5
    })
  })

  it('rejects selection coordinates outside the captured document', () => {
    expect(() => expectedCodeMirrorInputCheckpoint({
      value: 'abc',
      selectionStart: 2,
      selectionEnd: 4,
      data: 'x'
    })).toThrow(/selection is invalid/i)
  })

  it('releases only a complete sample with identical exact checkpoints', () => {
    expect(requireCompleteBrowserInputEventSample({
      sequence: 1,
      data: 'x',
      inputType: 'insertText',
      tEvent: 10,
      tEcho: 11,
      tFrame: 12,
      expectedDocumentCheckpoint: { valueLength: 4, valueHash: 'abcd1234' },
      echoDocumentCheckpoint: { valueLength: 4, valueHash: 'abcd1234' },
      frameDocumentCheckpoint: { valueLength: 4, valueHash: 'abcd1234' }
    })).toMatchObject({ tEvent: 10, tEcho: 11, tFrame: 12 })
  })

  it('rejects incomplete, misordered, or unequal checkpoint evidence', () => {
    const complete = {
      sequence: 1,
      data: 'x',
      inputType: 'insertText',
      tEvent: 10,
      tEcho: 11,
      tFrame: 12,
      expectedDocumentCheckpoint: { valueLength: 4, valueHash: 'abcd1234' },
      echoDocumentCheckpoint: { valueLength: 4, valueHash: 'abcd1234' },
      frameDocumentCheckpoint: { valueLength: 4, valueHash: 'abcd1234' }
    }
    expect(() => requireCompleteBrowserInputEventSample({
      ...complete,
      tEcho: undefined
    })).toThrow(/incomplete/i)
    expect(() => requireCompleteBrowserInputEventSample({
      ...complete,
      tFrame: 9
    })).toThrow(/order/i)
    expect(() => requireCompleteBrowserInputEventSample({
      ...complete,
      frameDocumentCheckpoint: { valueLength: 5, valueHash: 'abcd1234' }
    })).toThrow(/checkpoint/i)
  })
})
