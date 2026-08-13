import { describe, expect, it } from 'vitest'

import { processIdFromLsappinfo } from '../../e2e/frontmostApplication'

describe('background Electron frontmost-process oracle', () => {
  it('extracts the permission-free lsappinfo process identity', () => {
    expect(processIdFromLsappinfo('"pid"=456\n')).toBe(456)
    expect(processIdFromLsappinfo('  "pid" = 987  ')).toBe(987)
  })

  it('fails closed for malformed or unsafe process identities', () => {
    expect(() => processIdFromLsappinfo('')).toThrow('frontmost process id')
    expect(() => processIdFromLsappinfo('"pid"=-1')).toThrow('frontmost process id')
    expect(() => processIdFromLsappinfo('"pid"=9007199254740992')).toThrow(
      'frontmost process id'
    )
  })
})
