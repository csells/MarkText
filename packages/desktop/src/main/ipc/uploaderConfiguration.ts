import { ipcMain } from 'electron'
import {
  decodeUploaderSelectionRequest
} from './uploaderRuntimeCodec'

export interface UploaderConfigurationSender {
  readonly id: number
}

export interface UploaderConfigurationWindow {
  readonly id: number
}

export interface UploaderConfigurationHandlerDependencies {
  readonly resolveWindow: (
    sender: UploaderConfigurationSender
  ) => UploaderConfigurationWindow | null
  readonly chooseExecutable: (
    window: UploaderConfigurationWindow
  ) => Promise<string | null>
  readonly verifyExecutable: (pathname: string) => Promise<string>
  readonly persistSelection: (
    kind: 'picgo' | 'custom-cli'
  ) => Promise<void>
  readonly persistExecutable: (pathname: string) => Promise<void>
}

export function registerUploaderConfigurationHandlers(
  dependencies: UploaderConfigurationHandlerDependencies
): void {
  ipcMain.handle(
    'mt::uploader::select',
    async(event, rawRequest: unknown) => {
      const request = decodeUploaderSelectionRequest(rawRequest)
      const window = dependencies.resolveWindow(event.sender)
      if (window === null) {
        throw new Error('Uploader selection requires an application window')
      }
      await dependencies.persistSelection(request.kind)
      return Object.freeze({
        schema: 'uploader-selection-receipt-1' as const,
        kind: request.kind
      })
    }
  )

  ipcMain.handle(
    'mt::uploader::choose-custom-executable',
    async(event, ...rawArguments: unknown[]) => {
      if (rawArguments.length !== 0) {
        throw new TypeError(
          'Uploader executable chooser accepts no renderer arguments'
        )
      }
      const window = dependencies.resolveWindow(event.sender)
      if (window === null) {
        throw new Error(
          'Uploader executable selection requires an application window'
        )
      }
      const selected = await dependencies.chooseExecutable(window)
      if (selected === null) {
        return Object.freeze({
          schema: 'uploader-custom-executable-receipt-1' as const,
          selected: false as const,
          executablePath: null
        })
      }
      const executablePath =
        await dependencies.verifyExecutable(selected)
      await dependencies.persistExecutable(executablePath)
      return Object.freeze({
        schema: 'uploader-custom-executable-receipt-1' as const,
        selected: true as const,
        executablePath
      })
    }
  )
}
