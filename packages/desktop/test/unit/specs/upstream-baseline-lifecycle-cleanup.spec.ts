import { constants } from 'node:fs'
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  closeUpstreamPerformanceApplication,
  findUpstreamPerformanceProcessId,
  finalizeUpstreamPerformanceRun,
  removeUpstreamPerformanceRunRoot
} from '../../e2e/helpers/upstreamBaselineLifecycleCleanup'

describe('upstream baseline lifecycle cleanup', () => {
  it('waits for both the exact application and launcher to exit', async() => {
    const events: string[] = []
    let applicationRunning = true
    let launcherRunning = true

    await closeUpstreamPerformanceApplication({
      closeBrowser: async() => { events.push('browser-close') },
      processId: 47001,
      launcher: { pid: 47002 }
    }, {
      terminate: processId => {
        events.push(`terminate-${String(processId)}`)
      },
      isRunning: processId => processId === 47001
        ? applicationRunning
        : launcherRunning,
      sleep: async() => {
        if (applicationRunning) {
          events.push('application-exited')
          applicationRunning = false
        } else {
          events.push('launcher-exited')
          launcherRunning = false
        }
      },
      now: (() => {
        let now = 0
        return () => ++now
      })()
    })

    expect(events).toEqual([
      'browser-close',
      'terminate-47001',
      'application-exited',
      'terminate-47002',
      'launcher-exited'
    ])
  })

  it('finds only the exact unique profile-owned application process', () => {
    const executable = '/Volumes/MarkText/MarkText.app/Contents/MacOS/marktext'
    const profile = '/tmp/mt-upstream-performance-red/profile-prose'
    const processTable = [
      ` 47001 ${executable} --user-data-dir ${profile}`,
      ` 47002 ${executable} --user-data-dir /tmp/unrelated`,
      ` 47003 /usr/bin/open -W /Volumes/MarkText/MarkText.app --args ${profile}`,
      ` 47004 ${executable} --user-data-dir ${profile}-other`
    ].join('\n')

    expect(findUpstreamPerformanceProcessId(
      processTable,
      executable,
      profile
    )).toBe(47001)
    expect(findUpstreamPerformanceProcessId(
      processTable,
      executable,
      '/tmp/missing-profile'
    )).toBeUndefined()
    expect(() => findUpstreamPerformanceProcessId(
      `${processTable}\n 47005 ${executable} --user-data-dir=${profile}`,
      executable,
      profile
    )).toThrow(/at most one upstream main process/i)
  })

  it('cleans a pre-sample launch failure with no connected browser', async() => {
    const events: string[] = []
    let applicationRunning = true
    let launcherRunning = true

    await closeUpstreamPerformanceApplication({
      closeBrowser: async() => { events.push('no-browser') },
      processId: 47001,
      launcher: { pid: 47002 }
    }, {
      terminate: processId => events.push(`terminate-${String(processId)}`),
      isRunning: processId => processId === 47001
        ? applicationRunning
        : launcherRunning,
      sleep: async() => {
        if (applicationRunning) applicationRunning = false
        else launcherRunning = false
      },
      now: (() => {
        let now = 0
        return () => ++now
      })()
    })

    expect(events).toEqual([
      'no-browser',
      'terminate-47001',
      'terminate-47002'
    ])
  })

  it('retries only transient removal races for a run-owned root', async() => {
    const runRoot = await mkdtemp(join(tmpdir(), 'mt-upstream-performance-'))
    const profile = join(runRoot, 'profile-unicode-prose')
    await mkdir(profile)
    await writeFile(join(profile, 'Preferences'), '{}')
    let attempts = 0

    await removeUpstreamPerformanceRunRoot(runRoot, {
      remove: async root => {
        attempts += 1
        if (attempts < 3) {
          throw Object.assign(new Error('profile writer race'), {
            code: attempts === 1 ? 'ENOTEMPTY' : 'EBUSY'
          })
        }
        const { rm } = await import('node:fs/promises')
        await rm(root, { recursive: true })
      },
      sleep: async() => undefined,
      now: (() => {
        let now = 0
        return () => ++now
      })()
    })

    expect(attempts).toBe(3)
    await expect(access(runRoot, constants.F_OK)).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('does not admit output unless run-root cleanup succeeds first', async() => {
    const runRoot = join(tmpdir(), 'mt-upstream-performance-cleanup-red')
    let outputWritten = false

    await expect(finalizeUpstreamPerformanceRun(
      runRoot,
      () => { outputWritten = true },
      {
        remove: async() => {
          throw Object.assign(new Error('profile writer remains active'), {
            code: 'ENOTEMPTY'
          })
        },
        sleep: async() => undefined,
        now: (() => {
          let now = 0
          return () => { now += 10_001; return now }
        })()
      }
    )).rejects.toMatchObject({ code: 'ENOTEMPTY' })
    expect(outputWritten).toBe(false)
  })

  it('rejects cleanup outside its exact temporary run-root namespace', async() => {
    await expect(removeUpstreamPerformanceRunRoot(join(tmpdir(), 'unowned'), {
      remove: async() => undefined,
      sleep: async() => undefined,
      now: Date.now
    })).rejects.toThrow(/non-owned run root/i)
  })

  it('fails at the bounded deadline while a profile writer stays active', async() => {
    const runRoot = join(tmpdir(), 'mt-upstream-performance-still-busy')
    let attempts = 0
    let sleeps = 0
    const times = [0, 5_000, 10_001]

    await expect(removeUpstreamPerformanceRunRoot(runRoot, {
      remove: async() => {
        attempts += 1
        throw Object.assign(new Error('profile writer remains active'), {
          code: 'ENOTEMPTY'
        })
      },
      sleep: async() => { sleeps += 1 },
      now: () => times.shift() ?? 10_001
    })).rejects.toMatchObject({ code: 'ENOTEMPTY' })
    expect(attempts).toBe(2)
    expect(sleeps).toBe(1)
  })
})
