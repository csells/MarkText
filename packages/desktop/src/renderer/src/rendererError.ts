export interface IRendererFailurePayload {
  message: string
  name: string
  stack?: string
  cause?: IRendererFailurePayload
}

export type IRendererErrorPayload = IRendererFailurePayload

interface IRendererErrorHandlerOptions {
  log: (error: Error) => void
  send: (payload: IRendererErrorPayload) => void
  fallback: (event: Event) => void
}

function describeUnknown(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

const MAX_CAUSE_DEPTH = 16

function serializeRendererFailure(
  value: unknown,
  seen: ReadonlySet<Error> = new Set(),
  depth = 0
): IRendererFailurePayload {
  if (depth >= MAX_CAUSE_DEPTH) {
    return {
      message: `Cause chain exceeds ${MAX_CAUSE_DEPTH} entries.`,
      name: 'CauseChainTruncated'
    }
  }
  if (!(value instanceof Error)) {
    return {
      message: describeUnknown(value),
      name: 'NonErrorCause'
    }
  }
  if (seen.has(value)) {
    return {
      message: 'Cause chain is circular.',
      name: 'CircularCause'
    }
  }

  const nextSeen = new Set(seen)
  nextSeen.add(value)
  const payload: IRendererFailurePayload = {
    message: value.message,
    name: value.name,
    stack: value.stack
  }
  const cause = (value as Error & { cause?: unknown }).cause
  if (cause !== undefined) {
    payload.cause = serializeRendererFailure(cause, nextSeen, depth + 1)
  }
  return payload
}

export function normalizeRendererFailure(value: unknown): Error {
  if (value instanceof Error) return value

  const error = new Error(`Non-Error renderer failure: ${describeUnknown(value)}`) as Error & {
    cause?: unknown
  }
  error.name = 'RendererFailure'
  error.cause = value
  return error
}

export function rendererFailureFromEvent(event: Event): Error | null {
  if ('reason' in event) {
    return normalizeRendererFailure(
      (event as PromiseRejectionEvent).reason
    )
  }
  if ('error' in event) {
    const value = (event as ErrorEvent).error
    if (value !== null && value !== undefined) {
      return normalizeRendererFailure(value)
    }
  }
  return null
}

export function createRendererErrorHandler({
  log,
  send,
  fallback
}: IRendererErrorHandlerOptions): (event: Event) => void {
  return (event: Event): void => {
    const error = rendererFailureFromEvent(event)
    if (!error) {
      fallback(event)
      return
    }
    log(error)
    send(serializeRendererFailure(error))
  }
}
