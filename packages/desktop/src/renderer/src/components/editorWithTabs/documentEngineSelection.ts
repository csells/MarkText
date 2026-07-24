/**
 * Which document engine an editor tab runs on.
 *
 * `legacy` is Muya owning the document; `document-core` is
 * `@marktext/document-core` owning it with Muya reduced to a view. The two run
 * side by side during the migration so a flow can be moved — and rolled back —
 * on its own, which is why this is one explicit decision rather than a condition
 * buried in the editor component.
 */
export type DocumentEngine = 'legacy' | 'document-core'

/** Opt-in for the in-progress engine migration. Off unless set to exactly `1`. */
export const DOCUMENT_CORE_ENGINE_ENV = 'MARKTEXT_DOCUMENT_CORE_ENGINE'

/**
 * Choose the engine for this launch from a process-like environment.
 *
 * Takes the environment as data rather than reaching for a global, because the
 * renderer is sandboxed and reaches it through the preload bridge — and because
 * a pure function is the part worth testing. Only the exact string `1` opts in:
 * a stray or half-set variable must never silently switch a user's editor onto
 * an unfinished path.
 */
export function selectDocumentEngine(
  environment: Readonly<Record<string, string | undefined>>
): DocumentEngine {
  return environment[DOCUMENT_CORE_ENGINE_ENV] === '1'
    ? 'document-core'
    : 'legacy'
}

/**
 * Select the engine for an editor element and record it on the element.
 *
 * Marking the DOM lets automation assert which engine a session actually ran —
 * without it a flag that silently fails to plumb through looks exactly like a
 * flag that is off. Lives here rather than in the editor component so the
 * coordinator does not grow another responsibility as flows migrate.
 */
export function applyDocumentEngine(
  element: HTMLElement,
  environment: Readonly<Record<string, string | undefined>>
): DocumentEngine {
  const engine = selectDocumentEngine(environment)
  element.setAttribute('data-document-engine', engine)
  return engine
}
