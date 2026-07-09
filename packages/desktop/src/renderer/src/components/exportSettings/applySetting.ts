import type { Ref } from 'vue'

// Write a value into the registered export-option ref, failing loudly on an
// unregistered key. The dialog's on-change handlers dispatch by a string key
// taken from the template; a typo'd or newly-added-but-unregistered key used
// to silently no-op (the control appeared to change but the value never
// applied or persisted, so the export ignored it). Throwing surfaces that
// wiring bug at the point of the mistake instead of hiding it.
export function applyExportSetting(
  registry: Record<string, Ref<unknown>>,
  key: string,
  value: unknown
): void {
  const settingRef = registry[key]
  if (!settingRef) {
    throw new Error(`exportSettings: no registered option named "${key}"`)
  }
  settingRef.value = value
}
