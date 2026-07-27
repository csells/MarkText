import path from 'node:path'
import type { StaticOutputRevealRequest } from '../../shared/types/presentationEffects'

interface StaticOutputSender {
  readonly id: number
  readonly once?: (
    event: 'destroyed',
    listener: () => void
  ) => unknown
}

const MAX_RETAINED_OUTPUTS_PER_SENDER = 64
const retainedOutputs = new Map<number, Map<string, string>>()
const observedSenders = new Set<number>()

function identityKey(request: StaticOutputRevealRequest): string {
  return JSON.stringify([
    request.documentId,
    request.revisionId,
    request.consumer,
    request.view
  ])
}

function absoluteOutput(value: string): string {
  if (
    value.length === 0 ||
    value.includes('\0') ||
    !path.isAbsolute(value)
  ) {
    throw new TypeError('Static output must be one main-owned absolute path')
  }
  return path.resolve(value)
}

function observe(sender: StaticOutputSender): void {
  if (observedSenders.has(sender.id)) return
  observedSenders.add(sender.id)
  sender.once?.('destroyed', () => {
    observedSenders.delete(sender.id)
    retainedOutputs.delete(sender.id)
  })
}

export function retainStaticOutput(
  sender: StaticOutputSender,
  request: StaticOutputRevealRequest,
  target: string
): void {
  observe(sender)
  let outputs = retainedOutputs.get(sender.id)
  if (outputs === undefined) {
    outputs = new Map()
    retainedOutputs.set(sender.id, outputs)
  }
  const key = identityKey(request)
  outputs.delete(key)
  outputs.set(key, absoluteOutput(target))
  while (outputs.size > MAX_RETAINED_OUTPUTS_PER_SENDER) {
    const oldest = outputs.keys().next().value as string | undefined
    if (oldest === undefined) break
    outputs.delete(oldest)
  }
}

export function resolveStaticOutput(
  sender: Pick<StaticOutputSender, 'id'>,
  request: StaticOutputRevealRequest
): string {
  const retained = retainedOutputs.get(sender.id)?.get(identityKey(request))
  if (retained === undefined) {
    throw new Error('Static output is not retained for this renderer')
  }
  return retained
}
