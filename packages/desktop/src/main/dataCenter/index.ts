import fs from 'fs'
import path from 'path'
import { BrowserWindow, ipcMain } from 'electron'
import keytar from 'keytar'
import schema from './schema.json'
import Store, { type Schema } from 'electron-store'
import log from 'electron-log'
import { ensureDirSync } from 'common/filesystem'
import { IMAGE_EXTENSIONS } from 'common/filesystem/paths'
import { TypedEmitter } from '@shared/types/typedEmitter'
import { presentationPolicy } from '../presentationPolicy'
import { mintImageSourceCapability } from '../imageAssets/imageSourceCapability'
import { emitInternalChannel } from '../utils/internalIpc'
import {
  registerUploaderConfigurationHandlers
} from '../ipc/uploaderConfiguration'
import {
  verifyUploaderExecutable
} from '../uploader/uploaderService'

const DATA_CENTER_NAME = 'dataCenter'

// No events are emitted directly on this store.
type DataCenterEvents = Record<string, unknown[]>

interface DataCenterPaths {
  dataCenterPath: string
  userDataPath: string
}

class DataCenter extends TypedEmitter<DataCenterEvents> {
  dataCenterPath: string
  userDataPath: string
  serviceName: string
  encryptKeys: string[]
  hasDataCenterFile: boolean
  store: Store<Record<string, unknown>>

  constructor(paths: DataCenterPaths) {
    super()

    const { dataCenterPath, userDataPath } = paths
    this.dataCenterPath = dataCenterPath
    this.userDataPath = userDataPath
    this.serviceName = 'marktext'
    this.encryptKeys = []
    this.hasDataCenterFile = fs.existsSync(
      path.join(this.dataCenterPath, `./${DATA_CENTER_NAME}.json`)
    )
    this.store = new Store<Record<string, unknown>>({
      schema: schema as Schema<Record<string, unknown>>,
      name: DATA_CENTER_NAME
    })

    this.init()
  }

  init(): void {
    const defaultData = {
      imageFolderPath: path.join(this.userDataPath, 'images'),
      screenshotFolderPath: path.join(this.userDataPath, 'screenshot'),
      webImages: [],
      cloudImages: [],
      currentUploader: 'picgo',
      cliScript: ''
    }

    if (!this.hasDataCenterFile) {
      this.store.set(defaultData)
      ensureDirSync(this.store.get('screenshotFolderPath') as string)
    }
    this._listenForIpcMain()
    registerUploaderConfigurationHandlers({
      resolveWindow: sender =>
        BrowserWindow.fromWebContents(
          sender as Parameters<typeof BrowserWindow.fromWebContents>[0]
        ),
      chooseExecutable: async window => {
        const { filePaths } = await presentationPolicy.showOpenDialog(
          window as BrowserWindow,
          { properties: ['openFile'] }
        )
        return filePaths[0] ?? null
      },
      verifyExecutable: verifyUploaderExecutable,
      persistSelection: async kind => {
        await this.setItem(
          'currentUploader',
          kind === 'picgo' ? 'picgo' : 'cliScript'
        )
      },
      persistExecutable: async pathname => {
        await this.setItem('cliScript', pathname)
      }
    })
  }

  async getAll(): Promise<Record<string, unknown>> {
    const { serviceName, encryptKeys } = this
    const data = this.store.store
    try {
      const encryptData = await Promise.all(
        encryptKeys.map((key) => {
          return keytar.getPassword(serviceName, key)
        })
      )
      const encryptObj = encryptKeys.reduce<Record<string, string | null>>((acc, k, i) => {
        return {
          ...acc,
          [k]: encryptData[i]
        }
      }, {})

      return Object.assign(data, encryptObj)
    } catch (err) {
      log.error('Failed to decrypt secure keys:', err)
      return data
    }
  }

  addImage(key: string, url: string): void {
    const items = this.store.get(key) as Array<{ url: string; timeStamp: number }>
    const alreadyHas = items.some((item) => item.url === url)
    let item
    if (alreadyHas) {
      item = items.find((it) => it.url === url)
      if (item) item.timeStamp = +new Date()
    } else {
      item = { url, timeStamp: +new Date() }
      items.push(item)
    }

    return this.store.set(key, items)
  }

  removeImage(type: string, url: string): unknown {
    const items = this.store.get(type) as unknown[]
    const index = items.indexOf(url)
    if (index === -1) return
    items.splice(index, 1)
    return this.store.set(type, items)
  }

  getItem(key: string): Promise<unknown> {
    const { encryptKeys, serviceName } = this
    if (encryptKeys.includes(key)) {
      return keytar.getPassword(serviceName, key)
    } else {
      const value = this.store.get(key)
      return Promise.resolve(value)
    }
  }

  async setItem(key: string, value: unknown): Promise<void> {
    const { encryptKeys, serviceName } = this
    if (key === 'screenshotFolderPath') {
      ensureDirSync(value as string)
    }
    emitInternalChannel('broadcast-user-data-changed', { [key]: value })
    if (encryptKeys.includes(key)) {
      try {
        return await keytar.setPassword(serviceName, key, value as string)
      } catch (err) {
        log.error('Keytar error:', err)
      }
    } else {
      return this.store.set(key, value)
    }
  }

  /**
   * Change multiple setting entries.
   */
  setItems(settings: Record<string, unknown>): void {
    if (!settings) {
      log.error('Cannot change settings without entires: object is undefined or null.')
      return
    }

    Object.keys(settings).forEach((key) => {
      this.setItem(key, settings[key])
    })
  }

  _listenForIpcMain(): void {
    ipcMain.on('mt::ask-for-user-data', async(e) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      if (!win) return
      const userData = await this.getAll()
      win.webContents.send('mt::user-preference', userData)
    })

    ipcMain.on('mt::ask-for-modify-image-folder-path', async(e) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      if (!win) return
      const { filePaths } = await presentationPolicy.showOpenDialog(win, {
        properties: ['openDirectory', 'createDirectory']
      })
      if (filePaths && filePaths[0]) {
        this.setItem('imageFolderPath', filePaths[0])
      }
    })

    ipcMain.handle('mt::image-assets::select-native-source', async(e) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      if (!win) return null
      const { filePaths } = await presentationPolicy.showOpenDialog(win, {
        properties: ['openFile'],
        filters: [
          {
            name: 'Images',
            extensions: [...IMAGE_EXTENSIONS]
          }
        ]
      })

      if (filePaths && filePaths[0]) {
        return mintImageSourceCapability(e.sender, filePaths[0])
      }
      return null
    })
  }
}

export default DataCenter
