import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  decodePersistedUploaderSettings
} from 'main_renderer/uploader/uploaderSettings'

describe('main-owned uploader settings', () => {
  const executablePath = path.resolve('custom-uploader')

  it.each([
    [
      { currentUploader: 'picgo', cliScript: '/ignored/by/picgo' },
      { kind: 'picgo' }
    ],
    [
      {
        currentUploader: 'cliScript',
        cliScript: executablePath
      },
      {
        kind: 'custom-cli',
        executablePath
      }
    ]
  ])('maps only the persisted uploader selection and executable', (
    persisted,
    expected
  ) => {
    const decoded = decodePersistedUploaderSettings(persisted)
    expect(decoded).toEqual(expected)
    expect(Object.isFrozen(decoded)).toBe(true)
  })

  it.each([
    null,
    { currentUploader: 'shell', cliScript: '/tmp/attack' },
    { currentUploader: 'cliScript', cliScript: '' },
    { currentUploader: 'cliScript', cliScript: 'relative-uploader' },
    {
      currentUploader: 'picgo',
      cliScript: '',
      rendererOverride: '/tmp/attack'
    }
  ])('rejects malformed or open persisted uploader settings', value => {
    expect(() => decodePersistedUploaderSettings(value)).toThrow()
  })
})
