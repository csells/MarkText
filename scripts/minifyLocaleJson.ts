/**
 * Convert a locale source document to the exact compact JSON representation
 * written into packaged application resources.
 *
 * Kept pure so locale parity can be verified from tracked source files in a
 * clean checkout, where ignored `*.min.json` build artifacts do not exist.
 */
export const minifyLocaleJson = (source: string): string => {
  return JSON.stringify(JSON.parse(source))
}
