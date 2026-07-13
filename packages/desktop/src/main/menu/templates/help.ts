import path from 'path'
import { type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { isFile } from 'common/filesystem'
import * as actions from '../actions/help'
import { checkUpdates } from '../actions/marktext'
import { t } from '../../i18n'
import { presentationPolicy } from '../../presentationPolicy'

/// Check whether the package is updatable at runtime.
const isUpdatable = (): boolean => {
  // TODO: If not updatable, allow to check whether there is a new version available.

  const resFile = isFile(path.join(process.resourcesPath, 'app-update.yml'))
  if (!resFile) {
    // No update resource file available.
    return false
  } else if (process.env.APPIMAGE) {
    // We are running as AppImage.
    return true
  } else if (process.platform === 'win32' && isFile(path.join(process.resourcesPath, 'md.ico'))) {
    // Windows is a little but tricky. The update resource file is always available and
    // there is no way to check the target type at runtime (electron-builder#4119).
    // As workaround we check whether "md.ico" exists that is only included in the setup.
    return true
  }

  // Otherwise assume that we cannot perform an auto update (standalone binary, archives,
  // packed for package manager).
  return false
}

export default function(): MenuItemConstructorOptions {
  const submenu: MenuItemConstructorOptions[] = [
    {
      label: t('menu.help.markdownReference'),
      click() {
        presentationPolicy.openExternal(
          'https://marktext.me/docs/markdown-syntax'
        )
      }
    },
    {
      label: t('menu.help.changelog'),
      click() {
        presentationPolicy.openExternal('https://github.com/marktext/marktext/releases')
      }
    },
    {
      type: 'separator'
    },
    {
      label: t('menu.help.followUs'),
      click() {
        presentationPolicy.openExternal('https://twitter.com/marktextapp')
      }
    },
    {
      label: t('menu.help.support'),
      click() {
        presentationPolicy.openExternal('https://github.com/sponsors/marktext')
      }
    },
    {
      type: 'separator'
    },
    {
      label: t('menu.help.askQuestion'),
      click() {
        presentationPolicy.openExternal('https://github.com/marktext/marktext/discussions')
      }
    },
    {
      label: t('menu.help.reportBug'),
      click() {
        presentationPolicy.openExternal('https://github.com/marktext/marktext/issues')
      }
    },
    {
      label: t('menu.help.viewSource'),
      click() {
        presentationPolicy.openExternal('https://github.com/marktext/marktext')
      }
    },
    {
      type: 'separator'
    },
    {
      label: t('menu.help.license'),
      click() {
        presentationPolicy.openExternal(
          'https://github.com/marktext/marktext/blob/develop/LICENSE'
        )
      }
    }
  ]

  const helpMenu: MenuItemConstructorOptions = {
    label: t('menu.help.help'),
    role: 'help',
    submenu
  }

  if (isUpdatable()) {
    submenu.push(
      {
        type: 'separator'
      },
      {
        label: t('menu.help.checkUpdates'),
        click(_menuItem, browserWindow) {
          checkUpdates((browserWindow as BrowserWindow | undefined) ?? null)
        }
      }
    )
  }

  if (process.platform !== 'darwin') {
    submenu.push(
      {
        type: 'separator'
      },
      {
        label: t('menu.help.about'),
        click(_menuItem, browserWindow) {
          actions.showAboutDialog(browserWindow as BrowserWindow | undefined)
        }
      }
    )
  }
  return helpMenu
}
