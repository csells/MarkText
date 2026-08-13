import { constants } from 'node:fs'
import {
  access,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  closeFailedUpstreamPerformanceLaunch,
  closeUpstreamPerformanceApplication,
  findUpstreamPerformanceProcessId,
  finalizeUpstreamPerformanceRun,
  removeUpstreamPerformanceRunRoot,
  resolveUpstreamPerformanceProcessIdentity
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

    expect(findUpstreamPerformanceProcessId(processTable, {
      executable,
      profile
    })).toBe(47001)
    expect(findUpstreamPerformanceProcessId(processTable, {
      executable,
      profile: '/tmp/missing-profile'
    })).toBeUndefined()
    expect(() => findUpstreamPerformanceProcessId(
      `${processTable}\n 47005 ${executable} --user-data-dir=${profile}`,
      { executable, profile }
    )).toThrow(/at most one upstream main process/i)
  })

  it('matches the executable by canonical filesystem identity while preserving the exact profile argument', async() => {
    const root = await mkdtemp(join(tmpdir(), 'mt-upstream-process-identity-'))
    try {
      const canonicalBundle = join(root, 'canonical', 'marktext.app')
      const canonicalExecutable = join(
        canonicalBundle,
        'Contents/MacOS/marktext'
      )
      const aliasBundle = join(root, 'alias-marktext.app')
      const aliasExecutable = join(aliasBundle, 'Contents/MacOS/marktext')
      const profile = '/var/folders/run/profile-all-blocks'
      await mkdir(join(canonicalBundle, 'Contents/MacOS'), { recursive: true })
      await writeFile(canonicalExecutable, 'test executable')
      await symlink(canonicalBundle, aliasBundle, 'dir')
      const expectedExecutable = await realpath(canonicalExecutable)

      const identity = resolveUpstreamPerformanceProcessIdentity(
        aliasBundle,
        profile
      )

      expect(identity).toEqual({ executable: expectedExecutable, profile })
      expect(identity.executable).not.toBe(aliasExecutable)
      expect(findUpstreamPerformanceProcessId([
        ` 47001 ${expectedExecutable} --user-data-dir ${profile}`,
        ` 47002 ${expectedExecutable} --user-data-dir ${profile}-other`,
        ` 47003 ${aliasExecutable} --user-data-dir ${profile}`
      ].join('\n'), identity)).toBe(47001)
    } finally {
      await rm(root, { recursive: true })
    }
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

  it('rejects ambiguous identity after cleaning every exact run-owned process and launcher', async() => {
    const aliasBundle = '/var/folders/run/mounted-dmg/marktext.app'
    const canonicalExecutable =
      `/private${aliasBundle}/Contents/MacOS/marktext`
    const profile = '/var/folders/run/profile-all-blocks'
    const identity = resolveUpstreamPerformanceProcessIdentity(
      aliasBundle,
      profile,
      () => canonicalExecutable
    )
    const running = new Set([47001, 47002, 47003])
    const events: string[] = []

    await expect(closeFailedUpstreamPerformanceLaunch({
      closeBrowser: async() => { events.push('browser-close') },
      launcher: { pid: 47003 },
      processTable: [
        ` 47001 ${canonicalExecutable} --user-data-dir ${profile}`,
        ` 47002 ${canonicalExecutable} --user-data-dir=${profile}`,
        ` 47004 ${canonicalExecutable} --user-data-dir ${profile}-other`
      ].join('\n'),
      identity
    }, {
      terminate: processId => {
        events.push(`terminate-${String(processId)}`)
        running.delete(processId)
      },
      isRunning: processId => running.has(processId),
      sleep: async() => undefined,
      now: Date.now
    })).rejects.toThrow(/at most one upstream main process/i)

    expect(events).toEqual([
      'browser-close',
      'terminate-47001',
      'terminate-47002',
      'terminate-47003'
    ])
    expect(running).toEqual(new Set())
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
