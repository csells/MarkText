/**
 * Which Mermaid and Vega themes go with an app theme.
 *
 * Extracted from the editor coordinator: this is a decision rather than wiring,
 * and decisions like it accumulate in a component until nothing can be added to
 * it. Matching on the name containing "dark" preserves the editor's long-standing
 * behaviour, since theme names are product strings like `material-dark`.
 */
export interface DiagramThemes {
  readonly mermaidTheme: string
  readonly vegaTheme: string
}

export function diagramThemesFor(theme: string): DiagramThemes {
  return /dark/i.test(theme)
    ? { mermaidTheme: 'dark', vegaTheme: 'dark' }
    : { mermaidTheme: 'default', vegaTheme: 'latimes' }
}
