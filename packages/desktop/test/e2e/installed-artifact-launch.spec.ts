import { expect, test } from '@playwright/test'
import { chromium, type Browser, type Page } from 'playwright'
import { spawn, type ChildProcess } from 'node:child_process'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { assertInstalledBuildCommit, defaultCoreLaunchEnvironment, requiredExpectedBuildCommit } from './installedArtifactProvenance'
import { PACKAGED_ARTIFACT_ENV } from './installedTestCopy'

const TEXT = 'Shipped artifact text'

// The rest of the installed suite drives a copy with Node's inspect fuse on
// (see installedTestCopy.ts). This launches the artifact as shipped, fuse off,
// and reads it over the Chromium debugging protocol, which that fuse leaves
// alone.

const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address() as net.AddressInfo
    server.close(() => resolve(port))
  })
})

const editorPage = async(browser: Browser): Promise<Page> => {
  for (;;) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (await page.locator('.editor-component').count() > 0) return page
      }
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
}

test('the shipped artifact launches with its inspect fuse off and renders the editor', async() => {
  const artifact = process.env[PACKAGED_ARTIFACT_ENV]
  test.skip(artifact === undefined, 'Runs against MARKTEXT_PACKAGED_APP in the installed projects')
  const expected = requiredExpectedBuildCommit(process.env.MARKTEXT_EXPECTED_COMMIT)
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-artifact-launch-'))
  const document = path.join(userDataDir, 'artifact.md')
  fs.writeFileSync(document, `# Artifact\n\n${TEXT}\n`)
  const port = await freePort()
  let child: ChildProcess | undefined
  let browser: Browser | undefined
  try {
    child = spawn(artifact!, [`--remote-debugging-port=${port}`, '--user-data-dir', path.join(userDataDir, 'profile'), document], {
      env: defaultCoreLaunchEnvironment({ MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_ERROR_INTERACTION: '1' }),
      stdio: 'ignore',
      // Its own process group, so the whole app stops with it.
      detached: true
    })
    await expect.poll(async() => {
      try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
        return true
      } catch {
        return false
      }
    }, { timeout: 20000 }).toBe(true)
    const page = await editorPage(browser!)
    await expect(page.locator('.editor-component .mu-paragraph-content', { hasText: TEXT })).toBeAttached({ timeout: 15000 })
    assertInstalledBuildCommit(expected, await page.evaluate(() => window.electron.buildCommit))
  } finally {
    // The connection first: the app does not quit while a debugger holds it.
    await Promise.race([browser?.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 5000))])
    if (child?.pid !== undefined && child.exitCode === null) {
      const pid = child.pid
      const exited = new Promise(resolve => child!.once('exit', () => resolve(true)))
      const quit = (signal: NodeJS.Signals): Promise<unknown> => {
        try {
          process.kill(-pid, signal)
        } catch {
          return Promise.resolve(true)
        }
        return Promise.race([exited, new Promise(resolve => setTimeout(() => resolve(false), 10000))])
      }
      if (await quit('SIGTERM') !== true) await quit('SIGKILL')
    }
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
})
