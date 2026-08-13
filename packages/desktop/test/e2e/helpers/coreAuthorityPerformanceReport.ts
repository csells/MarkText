import type {
  CoreAuthorityPerformanceEvent
} from '../../../src/renderer/src/documentAuthority/coreAuthorityPerformanceTrace'
import type {
  CoreAuthorityPerformanceSurface
} from './coreAuthorityPerformanceRawRun'

export interface CoreAuthorityInputEvent {
  readonly sequence: number
  readonly tEvent: number
  readonly tEcho: number
  readonly tFrame: number
}

export interface CoreAuthorityPerformanceReport {
  readonly t_echo: readonly number[]
  readonly t_dispatch: readonly number[]
  readonly t_ack: readonly number[]
  readonly t_reconcile: readonly number[]
  readonly t_frame: readonly number[]
  readonly open: number
  readonly first_viewport: number
  readonly pendingDepthMaximum: number
  readonly correctionCount: number
}

export function reportCoreAuthorityPerformance(input: Readonly<{
  readonly surface: CoreAuthorityPerformanceSurface
  readonly externalOpen: Readonly<{
    readonly open: number
    readonly firstViewport: number
  }>
  readonly inputEvents: readonly CoreAuthorityInputEvent[]
  readonly authorityEvents: readonly CoreAuthorityPerformanceEvent[]
}>): CoreAuthorityPerformanceReport {
  const documentIds = new Set(input.authorityEvents.map(event => event.documentId))
  if (documentIds.size !== 1) {
    throw new Error('Core authority performance report must name one document')
  }
  const singleton = (
    phase: 'open-request' | 'open-ack' | 'first-editable-viewport'
  ): number => {
    const events = input.authorityEvents.filter(event => event.phase === phase)
    if (events.length !== 1) {
      throw new Error(`Core authority performance ${phase} is missing or duplicate`)
    }
    return events[0]!.at
  }
  const openRequest = singleton('open-request')
  const openAcknowledgement = singleton('open-ack')
  const viewportEvents = input.authorityEvents.filter(event =>
    event.phase === 'first-editable-viewport' && event.surface === input.surface
  )
  if (viewportEvents.length !== 1) {
    throw new Error(
      'Core authority performance first-editable-viewport is missing or duplicate'
    )
  }
  const firstViewport = viewportEvents[0]!.at
  if (openRequest > openAcknowledgement || openAcknowledgement > firstViewport) {
    throw new Error('Core authority open timestamp order is invalid')
  }

  const transactions = new Map<number, Partial<Record<
    'dispatch' | 'ack' | 'reconcile',
    Extract<CoreAuthorityPerformanceEvent, { readonly transaction: number }>
  >>>()
  for (const event of input.authorityEvents) {
    if (!('transaction' in event)) continue
    const phases = transactions.get(event.transaction) ?? {}
    if (phases[event.phase] !== undefined) {
      throw new Error(`Core authority performance ${event.phase} is duplicate`)
    }
    phases[event.phase] = event
    transactions.set(event.transaction, phases)
  }
  const ordered = [...transactions.entries()].sort(([left], [right]) => left - right)
  if (ordered.length !== input.inputEvents.length) {
    throw new Error('Core authority performance requires one complete transaction per input')
  }
  const tDispatch: number[] = []
  const tAck: number[] = []
  const tReconcile: number[] = []
  const tEcho: number[] = []
  const tFrame: number[] = []
  let maximumDepth = 0
  let correctionCount = 0
  for (let index = 0; index < ordered.length; index += 1) {
    const phases = ordered[index]![1]
    const browserInput = input.inputEvents[index]
    const dispatch = phases.dispatch
    const acknowledgement = phases.ack
    const reconciliation = phases.reconcile
    if (
      browserInput === undefined || dispatch?.phase !== 'dispatch' ||
      acknowledgement?.phase !== 'ack' || reconciliation?.phase !== 'reconcile'
    ) {
      throw new Error('Core authority performance requires a complete transaction')
    }
    if (
      browserInput.tEvent > browserInput.tEcho ||
      browserInput.tEcho > browserInput.tFrame
    ) throw new Error('Core authority browser input timestamp order is invalid')
    if (
      browserInput.tEvent > dispatch.at || dispatch.at > acknowledgement.at ||
      acknowledgement.at > reconciliation.at
    ) throw new Error('Core authority transaction timestamp order is invalid')
    tEcho.push(browserInput.tEcho - browserInput.tEvent)
    tDispatch.push(dispatch.at - browserInput.tEvent)
    tAck.push(acknowledgement.at - browserInput.tEvent)
    tReconcile.push(reconciliation.at - browserInput.tEvent)
    tFrame.push(browserInput.tFrame - browserInput.tEvent)
    maximumDepth = Math.max(maximumDepth, dispatch.pendingDepth)
    if (reconciliation.corrected) correctionCount += 1
  }
  if (
    !Number.isFinite(input.externalOpen.open) || input.externalOpen.open < 0 ||
    !Number.isFinite(input.externalOpen.firstViewport) ||
    input.externalOpen.firstViewport < input.externalOpen.open
  ) throw new Error('Core authority external open timestamp order is invalid')
  return Object.freeze({
    t_echo: Object.freeze(tEcho),
    t_dispatch: Object.freeze(tDispatch),
    t_ack: Object.freeze(tAck),
    t_reconcile: Object.freeze(tReconcile),
    t_frame: Object.freeze(tFrame),
    open: input.externalOpen.open,
    first_viewport: input.externalOpen.firstViewport,
    pendingDepthMaximum: maximumDepth,
    correctionCount
  })
}
