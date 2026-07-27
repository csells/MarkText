import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import type { ElectronApplication } from 'playwright'
import { describe, expect, it, vi } from 'vitest'

import playwrightConfig from '../../../playwright.config'
import {
  closeElectron,
  closeElectronAfterStartupFailure
} from '../../e2e/helpers'

describe('e2e background safety', () => {
  const packagePath = path.resolve(__dirname, '../../../package.json')
  const helpersPath = path.resolve(__dirname, '../../e2e/helpers.ts')
  const installedFixturePath = path.resolve(
    __dirname,
    '../../e2e/installedDocumentCoreE2e.ts'
  )
  const criticMarkupE2ePath = path.resolve(__dirname, '../../e2e/critic-markup-review.spec.ts')

  it('loads the one-worker Playwright config in fail-closed background mode', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(packagePath, 'utf-8')
    ) as { scripts: Record<string, string> }
    const helpers = fs.readFileSync(helpersPath, 'utf8')

    expect(packageJson.scripts['test:e2e']).toBe(
      'cross-env MARKTEXT_TEST_BACKGROUND=1 playwright test ' +
      '--config test/e2e/playwright.config.ts --project=unpacked'
    )
    expect(packageJson.scripts['test:e2e:interactive']).toBe(
      'cross-env MARKTEXT_TEST_INTERACTIVE=1 MARKTEXT_TEST_BACKGROUND=0 ' +
      'playwright test --config test/e2e/playwright.config.ts --project=unpacked'
    )
    expect(packageJson.scripts['test:e2e:installed']).toBe(
      'cross-env MARKTEXT_TEST_BACKGROUND=1 playwright test ' +
      '--config test/e2e/playwright.config.ts --project=installed'
    )
    expect(playwrightConfig.workers).toBe(1)
    expect(playwrightConfig.projects?.map((project) => project.name)).toEqual([
      'unpacked',
      'installed'
    ])
    expect(helpers).toContain('MARKTEXT_TEST_INTERACTIVE')
    expect(helpers).not.toContain(": process.platform === 'darwin'")
  })

  it('asserts the canonical main/renderer error ledger across lossless reopen boundaries', () => {
    const helpers = fs.readFileSync(helpersPath, 'utf8')
    const criticMarkupE2e = fs.readFileSync(criticMarkupE2ePath, 'utf8')

    expect(helpers).toContain('export const getCapturedErrors')
    expect(helpers).toContain('export const clearCapturedErrors')
    expect(helpers).toContain('export const expectNoCapturedErrors')
    expect(criticMarkupE2e).toContain('await expectNoCapturedErrors(app)')
    expect(criticMarkupE2e).toContain('await clearCapturedErrors(app)')
  })

  it('drives the hidden file-backed workflow from the shared executable corpus', () => {
    const criticMarkupE2e = fs.readFileSync(criticMarkupE2ePath, 'utf8')

    expect(criticMarkupE2e).toContain('CRITIC_MARKUP_CORPUS')
    expect(criticMarkupE2e).toMatch(
      /from ['"]\.\.\/fixtures\/profile1Adversarial['"]/
    )
  })

  it('treats transport closure after a scheduled background exit as successful cleanup', async() => {
    const process = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null
    })
    const app = {
      close: vi.fn(),
      process: vi.fn(() => process),
      waitForEvent: vi.fn(async() => undefined),
      evaluate: vi.fn(async(
        operation: (electron: { app: { exit: (code: number) => void } }) => void
      ) => {
        operation({
          app: {
            exit: (code: number) => {
              process.exitCode = code
              process.emit('exit', code, null)
            }
          }
        })
        await new Promise<void>((resolve) => setImmediate(resolve))
        throw new Error('transport closed after exit')
      })
    } as unknown as ElectronApplication

    await expect(closeElectron(app)).resolves.toBeUndefined()
  })

  it('makes background cleanup idempotent after the Electron process exited', async() => {
    const process = Object.assign(new EventEmitter(), {
      exitCode: 0 as number | null,
      signalCode: null as NodeJS.Signals | null
    })
    const evaluate = vi.fn()
    const app = {
      close: vi.fn(),
      process: vi.fn(() => process),
      waitForEvent: vi.fn(),
      evaluate
    } as unknown as ElectronApplication

    await expect(closeElectron(app)).resolves.toBeUndefined()
    expect(evaluate).not.toHaveBeenCalled()
  })

  it('closes a launched Electron process before preserving a startup failure', async() => {
    const process = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null
    })
    const app = {
      close: vi.fn(),
      process: vi.fn(() => process),
      evaluate: vi.fn(async(
        operation: (electron: { app: { exit: (code: number) => void } }) => void
      ) => {
        operation({
          app: {
            exit: (code: number) => {
              process.exitCode = code
              process.emit('exit', code, null)
            }
          }
        })
      })
    } as unknown as ElectronApplication
    const startupFailure = new Error('readiness failed')

    await expect(
      closeElectronAfterStartupFailure(app, startupFailure)
    ).rejects.toBe(startupFailure)
    expect(app.evaluate).toHaveBeenCalledOnce()
  })

  it('guards every post-launch readiness path with unconditional cleanup', () => {
    const helpers = fs.readFileSync(helpersPath, 'utf8')
    const installedFixture = fs.readFileSync(installedFixturePath, 'utf8')
    const launchElectron = helpers.slice(
      helpers.indexOf('export const launchElectron'),
      helpers.indexOf('export const assertBackgroundRuntimePolicy')
    )
    const installedLaunch = installedFixture.slice(
      installedFixture.indexOf('const launch = async'),
      installedFixture.indexOf('return Object.freeze')
    )

    expect(launchElectron).toContain(
      'closeElectronAfterStartupFailure(app, error)'
    )
    expect(installedLaunch).toContain(
      'closeElectronAfterStartupFailure(app, error)'
    )
    expect(launchElectron).not.toContain('app.close()')
    expect(installedLaunch).not.toContain('app.close()')
  })
})
