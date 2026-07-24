import { describe, expect, it } from 'vitest'
import { diagramThemesFor } from '@/components/editorWithTabs/diagramThemes'

/**
 * Diagram themes follow the app theme.
 *
 * Extracted from the editor coordinator: choosing Mermaid and Vega themes from
 * the app theme name is a decision, not wiring, and it is the kind of thing that
 * accumulates in a component until nothing can be added to it. The coordinator
 * is at its size guard, so responsibilities have to come out before the engine
 * migration can route flows in.
 */

describe('diagram themes', () => {
  it('uses dark diagram themes for a dark app theme', () => {
    expect(diagramThemesFor('dark')).toEqual({
      mermaidTheme: 'dark',
      vegaTheme: 'dark'
    })
  })

  it('matches any theme whose name contains dark', () => {
    // Theme names are product strings like 'material-dark' or 'One Dark', so
    // this matches the way the editor always has rather than an exact list.
    for (const theme of ['material-dark', 'One Dark', 'ONE-DARK']) {
      expect(diagramThemesFor(theme).mermaidTheme).toBe('dark')
    }
  })

  it('uses light diagram themes otherwise', () => {
    for (const theme of ['light', 'graphite', 'ulysses']) {
      expect(diagramThemesFor(theme)).toEqual({
        mermaidTheme: 'default',
        vegaTheme: 'latimes'
      })
    }
  })
})
