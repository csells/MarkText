import { describe, expect, it } from 'vitest'
import {
  decodeUploaderSelectionRequest
} from 'main_renderer/ipc/uploaderRuntimeCodec'

describe('uploader configuration IPC codec', () => {
  it.each([
    ['picgo', 'picgo'],
    ['custom-cli', 'custom-cli']
  ] as const)('decodes the closed %s selection', (kind, expected) => {
    expect(decodeUploaderSelectionRequest({
      schema: 'uploader-selection-1',
      kind
    })).toEqual({
      schema: 'uploader-selection-1',
      kind: expected
    })
  })

  it.each([
    null,
    {},
    {
      schema: 'uploader-selection-1',
      kind: 'custom-cli',
      executablePath: '/tmp/attacker'
    },
    {
      schema: 'uploader-selection-1',
      kind: 'cliScript'
    },
    {
      schema: 'uploader-selection-1',
      kind: 'shell'
    }
  ])('rejects open or executable-bearing selection input %#', value => {
    expect(() => decodeUploaderSelectionRequest(value)).toThrow()
  })
})
