import type { EditorCoreBinding } from './editorCoreBinding'

export interface CoreAuthorityPerformanceTestBridge {
  authoritySource(): Promise<string>
}

export const createCoreAuthorityPerformanceTestBridge = (
  enabled: boolean,
  binding: Pick<EditorCoreBinding, 'sourceAtBarrier'>
): Readonly<CoreAuthorityPerformanceTestBridge> | undefined => enabled
  ? Object.freeze({
    async authoritySource(): Promise<string> {
      const reply = await binding.sourceAtBarrier()
      if (reply.type !== 'source') {
        throw new Error('Core performance authority source is unavailable')
      }
      return reply.source
    }
  })
  : undefined
