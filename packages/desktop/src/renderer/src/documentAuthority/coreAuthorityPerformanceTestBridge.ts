import type { CoreDocumentViewLease } from './coreDocumentSessionManager'

export interface CoreAuthorityPerformanceTestBridge {
  authoritySource(): Promise<string>
}

export const createCoreAuthorityPerformanceTestBridge = (
  enabled: boolean,
  lease: Pick<CoreDocumentViewLease, 'sourceAtBarrier'>
): Readonly<CoreAuthorityPerformanceTestBridge> | undefined => enabled
  ? Object.freeze({
    async authoritySource(): Promise<string> {
      return lease.sourceAtBarrier()
    }
  })
  : undefined
