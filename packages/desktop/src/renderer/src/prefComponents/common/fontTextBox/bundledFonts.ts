// Preferred editor/code defaults may be absent from the OS font-list IPC, so
// keep them selectable even when the system query does not return them (#3021).
export const BUNDLED_PROPORTIONAL_FONTS = ['Open Sans']
export const BUNDLED_MONOSPACE_FONTS = ['DejaVu Sans Mono']

export const withBundledFonts = (systemFonts: string[], onlyMonospace = false): string[] => {
  const bundled = onlyMonospace ? BUNDLED_MONOSPACE_FONTS : BUNDLED_PROPORTIONAL_FONTS
  const missing = bundled.filter(font => !systemFonts.includes(font))
  return [...missing, ...systemFonts]
}
