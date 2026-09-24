import { describe, expect, it } from 'vitest'
import { userArguments } from '../../../src/main/cli/userArguments'

describe('CLI user arguments', () => {
  it('skips only the executable of a packaged app', () => {
    expect(
      userArguments(['/Applications/MarkText', '--user-data-dir', '/p', 'a.md'], false)
    ).toEqual(['--user-data-dir', '/p', 'a.md'])
  })

  it('skips the application path of `electron <app>` launches', () => {
    expect(
      userArguments(['/electron', '/repo/packages/desktop', '--user-data-dir', '/p', 'a.md'], true)
    ).toEqual(['--user-data-dir', '/p', 'a.md'])
  })

  it('skips Electron switches that precede the application path', () => {
    expect(
      userArguments(
        [
          '/electron',
          '--inspect=0',
          '--remote-debugging-port=0',
          '/repo/packages/desktop',
          '--user-data-dir',
          '/p'
        ],
        true
      )
    ).toEqual(['--user-data-dir', '/p'])
  })
})
