export {
  createLocalCoreOwner,
  type CoreModelTestControl,
  type LocalCoreOwnerOptions
} from './localCoreOwner'
export { createInMemoryShadowPort } from './inMemoryShadowPort'
export { createCodeMirrorCoreAdapter, type CodeMirrorCoreAdapter } from './codeMirrorCoreAdapter'
export { createMuyaPlainTextCoreAdapter } from './muyaPlainTextCoreAdapter'
export {
  createCoreAuthorityPerformanceTrace,
  measureCoreDocumentOpen,
  type CoreAuthorityPerformanceEvent,
  type CoreAuthorityPerformanceTrace
} from './coreAuthorityPerformanceTrace'
export {
  createCoreAuthorityPerformanceTestBridge,
  type CoreAuthorityPerformanceTestBridge
} from './coreAuthorityPerformanceTestBridge'
export {
  canToggleCoreTrackChanges,
  createCoreTrackChangesMode,
  type CoreTrackChangesMode
} from './coreTrackChangesMode'
export { handoffCorePlainTextView, leaseCorePlainTextView } from './corePlainTextViewHandoff'
export { createCoreActor, type CoreActor } from './coreActor'
export {
  createCoreConsumerProjectionRegistry,
  type CoreConsumerProjectionRegistry
} from './coreConsumerProjectionRegistry'
export {
  createCoreDocumentSessionManager,
  type CoreDocumentSessionManager,
  type CoreDocumentViewLease
} from './coreDocumentSessionManager'
export {
  coreDocumentSaveAuthority,
  type CoreDocumentSaveSnapshot
} from './coreDocumentSaveAuthority'
export {
  canonicalCoreLineEnding,
  coreDocumentReloadAuthority,
  type CoreDocumentReloadInput
} from './coreDocumentReloadAuthority'
export {
  coordinateCoreDocumentRecovery,
  coreDocumentRecoveryAuthority,
  type CoreDocumentRecoveryRequest
} from './coreDocumentRecoveryAuthority'
export {
  createEditorCoreBinding,
  type EditorCoreBinding,
  type EditorCoreOpenInput
} from './editorCoreBinding'
export {
  createWorkerCorePort,
  type CoreWorkerLike,
  type CoreWorkerPortOptions,
  type CoreWorkerTestControl
} from './coreWorkerPort'
export {
  resolveCoreDocumentLaunchPolicy,
  type CoreDocumentLaunchPolicy
} from './coreDocumentLaunchPolicy'
export {
  createEditorShadowBinding,
  type EditorShadowBinding,
  type EditorShadowSnapshot
} from './editorShadowBinding'
export { createWorkerShadowPort, type ShadowWorkerLike } from './workerShadowPort'
export {
  createShadowDocumentAuthority,
  type ShadowDocumentAuthority,
  type ShadowDocumentAuthorityOptions,
  type ShadowOpenInput,
  type ShadowReport,
  type ShadowTicket
} from './shadowDocumentAuthority'
export type {
  CoreActorPort,
  CoreModelOwner,
  CoreAppliedReply,
  CoreConsumerProjection,
  CoreConsumerProjectionReply,
  CoreConsumerSearchMatch,
  CoreConsumerSearchReplacement,
  CoreOpenedReply,
  CorePlainTextViewReply,
  CoreReviewDecision,
  CoreReviewItemLocator,
  CoreReviewItemReply,
  CoreRejectedReply,
  CoreResourceReply,
  CoreSourceReply,
  CoreSourceSyntaxReply,
  CoreReply,
  CoreRequest,
  CoreWorkerRequestEnvelope,
  CoreWorkerResponseEnvelope
} from './coreProtocol'
export type {
  ShadowActorPort,
  ShadowMetrics,
  ShadowQueueContext,
  ShadowReply,
  ShadowRequest,
  ShadowRejectionReason,
  ShadowRecognitionSummary,
  ShadowResourceFailure,
  ShadowStatus,
  ShadowWorkerRequestEnvelope,
  ShadowWorkerResponseEnvelope
} from './protocol'
