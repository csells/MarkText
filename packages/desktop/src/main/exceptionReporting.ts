import { presentationPolicy } from './presentationPolicy'

export type ApplicationErrorSource = 'main' | 'renderer' | 'startup' | 'crash'
export type ErrorDisposition = 'captured' | 'presented'

export interface CapturedApplicationError {
  source: ApplicationErrorSource
  name: string
  message: string
  stack?: string
}

class ExceptionReporter {
  capture(source: ApplicationErrorSource, error: Error): void {
    globalThis.__mt_captured_errors__ ??= []
    globalThis.__mt_captured_errors__.push({
      source,
      name: error.name,
      message: error.message,
      stack: error.stack
    })
  }

  async handle(
    source: ApplicationErrorSource,
    error: Error,
    presentError: () => void | Promise<void>
  ): Promise<ErrorDisposition> {
    this.capture(source, error)
    if (presentationPolicy.background) return 'captured'
    await presentError()
    return 'presented'
  }

  requiresTermination(source: ApplicationErrorSource, appIsReady: boolean): boolean {
    return presentationPolicy.background &&
      (source === 'main' || source === 'startup' || !appIsReady)
  }
}

export const exceptionReporter = new ExceptionReporter()
