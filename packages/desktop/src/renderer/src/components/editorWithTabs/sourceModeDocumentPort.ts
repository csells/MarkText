import type { SourceModeDocumentPort } from './sourceModeController'

let activePort: SourceModeDocumentPort | null = null
let activeInputSettlement: (() => Promise<void>) | null = null
const waiters = new Set<(port: SourceModeDocumentPort) => void>()

export function registerSourceModeDocumentPort(
  port: SourceModeDocumentPort
): Readonly<{ dispose: () => void }> {
  activePort = port
  for (const resolve of waiters) resolve(port)
  waiters.clear()
  return Object.freeze({
    dispose: () => {
      if (activePort === port) activePort = null
    }
  })
}

export function sourceModeDocumentPort(): Promise<SourceModeDocumentPort> {
  if (activePort !== null) return Promise.resolve(activePort)
  return new Promise(resolve => waiters.add(resolve))
}

export function registerSourceModeInputSettlement(
  settle: () => Promise<void>
): Readonly<{ dispose: () => void }> {
  activeInputSettlement = settle
  return Object.freeze({
    dispose: () => {
      if (activeInputSettlement === settle) activeInputSettlement = null
    }
  })
}

export async function settleSourceModeInput(): Promise<void> {
  await activeInputSettlement?.()
}
