import type { SourceSnapshot } from './sourceSnapshot.js'
import { createSourceSnapshot } from './sourceSnapshot.js'
import type { CompleteDocumentRevision, DocumentRevision, ParseConfiguration } from './revision.js'
import { parseProfile1Document } from './internal/profile1Document.js'
import { activeProfileParseTraceRecorderV1 } from './internal/profileParseTraceV1.js'
import { validateAndFreezeParseConfiguration } from './configuration.js'

export interface LanguageEngine {
  open(source: SourceSnapshot, configuration: ParseConfiguration): DocumentRevision
}

export function createLanguageEngine(): LanguageEngine {
  const engine: LanguageEngine = Object.freeze({
    open(source: SourceSnapshot, configuration: ParseConfiguration): DocumentRevision {
      const stableSource = createSourceSnapshot(source.text)
      const stableConfiguration = validateAndFreezeParseConfiguration(configuration)
      const parsed = parseProfile1Document(
        stableSource.text,
        stableConfiguration.executionBudget,
        activeProfileParseTraceRecorderV1(engine)
      )
      if (parsed.kind === 'source-only') {
        return Object.freeze({
          kind: 'source-only',
          source: stableSource,
          configuration: stableConfiguration,
          fatalDiagnostic: parsed.fatalDiagnostic
        })
      }
      const projection = Object.freeze((view: 'original' | 'revised' | 'editing') => {
        if (view === 'original') {
          return parsed.original
        }
        if (view === 'revised') {
          return parsed.revised
        }
        if (view === 'editing') {
          return parsed.editing()
        }
        throw new RangeError(`Unknown CriticMarkup projection: ${String(view)}`)
      })

      return Object.freeze({
        kind: 'complete',
        source: stableSource,
        configuration: stableConfiguration,
        criticMarkup: parsed.criticMarkup,
        diagnostics: parsed.diagnostics,
        ownership: parsed.ownership,
        markup: parsed.markup,
        projection
      }) satisfies CompleteDocumentRevision
    }
  })
  return engine
}
