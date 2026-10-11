import { legacyMarkdownReaches, onLegacyMarkdownReach, setLegacyMarkdownStrict } from '@muyajs/core'
import { LEGACY_MARKDOWN_REACH_PREFIX } from '@shared/legacyMarkdownReach'

let installed = false

/**
 * For the E2E harness, makes Muya throw when a bound view reaches its
 * legacy Markdown parser or serializer, and reports each reach on the console.
 */
export const installLegacyMarkdownTestGuard = (): void => {
  if (installed) return
  installed = true
  setLegacyMarkdownStrict(true)
  onLegacyMarkdownReach((reach) => {
    console.error(`${LEGACY_MARKDOWN_REACH_PREFIX} ${reach.module}\n${reach.stack}`)
  })
  window.__marktextLegacyMarkdownGuard = Object.freeze({
    strict: true,
    reaches: () => legacyMarkdownReaches().length
  })
}
