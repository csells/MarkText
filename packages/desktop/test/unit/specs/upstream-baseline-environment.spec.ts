import { describe, expect, it } from 'vitest'

import { formatUpstreamBaselineHardware } from '../../e2e/helpers/upstreamBaselineEnvironment'

describe('upstream baseline environment provenance', () => {
  it('matches the frozen performance target hardware format exactly', () => {
    expect(formatUpstreamBaselineHardware({
      machine_name: 'MacBook Pro',
      machine_model: 'Mac17,6',
      chip_type: 'Apple M5 Max',
      physical_memory: '128 GB'
    })).toBe('MacBook Pro Mac17,6, Apple M5 Max, 128 GB')
  })

  it('fails closed rather than serializing absent hardware fields', () => {
    expect(() => formatUpstreamBaselineHardware({
      machine_name: 'MacBook Pro',
      machine_model: 'Mac17,6',
      chip_type: undefined,
      physical_memory: '128 GB'
    })).toThrow(/chip type/i)
  })
})
