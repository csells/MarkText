interface ApplicationPresentationSurface {
  setActivationPolicy?(policy: 'accessory'): void
  dock?: { hide(): void }
  commandLine: { appendSwitch(name: string): void }
}

export interface PresentationRuntimeState {
  mode: 'background' | 'interactive'
  configured: boolean
  derivedWindowCount: number
  activationPolicy: 'accessory' | null
}

export class BackgroundPresentationGuard {
  readonly state: PresentationRuntimeState

  constructor(readonly background: boolean) {
    this.state = {
      mode: background ? 'background' : 'interactive',
      configured: false,
      derivedWindowCount: 0,
      activationPolicy: null
    }
  }

  configureApplication(app: ApplicationPresentationSurface): void {
    this.state.configured = true
    this.state.derivedWindowCount = 0
    this.state.activationPolicy = null
    if (!this.background) return

    if (app.setActivationPolicy) {
      app.setActivationPolicy('accessory')
      this.state.activationPolicy = 'accessory'
    }
    app.dock?.hide()
    app.commandLine.appendSwitch('disable-renderer-backgrounding')
    app.commandLine.appendSwitch('disable-background-timer-throttling')
    app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
  }

  deriveWindowOptions<T extends object>(options: T): T {
    this.state.derivedWindowCount += 1
    const source = options as T & { show?: boolean; webPreferences?: Record<string, unknown> }
    if (!this.background) {
      return {
        ...source,
        webPreferences: source.webPreferences ? { ...source.webPreferences } : undefined
      } as T
    }
    return {
      ...source,
      show: false,
      webPreferences: { ...source.webPreferences, backgroundThrottling: false }
    } as T
  }

  allowsPresentation(): boolean {
    return !this.background
  }
}
