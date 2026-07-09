import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { applyExportSetting } from '@/components/exportSettings/applySetting'

// The export dialog's on-change handlers dispatch by a string key taken from
// the template. The old dispatch used `if (key in state) state[key].value = ...`
// with no else, so a typo'd or newly-added-but-unregistered key silently did
// nothing — the control appeared to change but the value never applied or
// persisted, and the export ignored it. applyExportSetting fails loudly on an
// unregistered key so that wiring bug surfaces immediately.

describe('applyExportSetting', () => {
  it('writes the value into the registered option ref', () => {
    const pageSize = ref('A4')
    const registry = { pageSize }
    applyExportSetting(registry, 'pageSize', 'A3')
    expect(pageSize.value).toBe('A3')
  })

  it('throws on an unregistered key instead of silently dropping the write', () => {
    const registry = { pageSize: ref('A4') }
    expect(() => applyExportSetting(registry, 'paeSize', 'A3')).toThrow(/paeSize/)
  })
})
