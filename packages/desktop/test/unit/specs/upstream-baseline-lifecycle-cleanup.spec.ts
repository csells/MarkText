import { constants } from 'node:fs'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  runIsolatedPerformanceObservations
} from '../../e2e/helpers/performanceSampleLifecycle'
import {
  closeFailedUpstreamPerformanceLaunch,
  closeUpstreamPerformanceApplication,
  forceKillOwnedProcess,
  createUpstreamPerformanceBlankBootstrapFile,
  createUpstreamPerformanceObservationIsolation,
  findUpstreamPerformanceProcessId,
  finalizeUpstreamPerformanceRun,
  removeUpstreamPerformanceObservationIsolation,
  removeUpstreamPerformanceRunRoot,
  resolveUpstreamPerformanceProcessIdentity,
  upstreamPerformanceOrchestrationTimeoutMs
} from '../../e2e/helpers/upstreamBaselineLifecycleCleanup'

describe('upstream baseline lifecycle cleanup', () => {
  it('runs every observation in one fresh profile lifecycle before starting the next', async() => {
    const events: string[] = []
    let clock = 0

    const result = await runIsolatedPerformanceObservations([
      { id: 'warmup-1', expected: 11 },
      { id: 'measured-1', expected: 22 },
      { id: 'measured-2', expected: 33 }
    ], {
      createIsolation: async(declaration, index) => {
        const profile = `/tmp/mt-performance-observation-${String(index + 1)}/profile`
        events.push(`create:${declaration.id}:${profile}`)
        return { profile }
      },
      launchAndPrepare: async(declaration, isolation) => {
        clock += 5_000
        events.push(`launch:${declaration.id}:${isolation.profile}`)
        return { id: declaration.id }
      },
      measure: async(application, declaration) => {
        events.push(`measure:${application.id}`)
        const startedAt = clock
        clock += declaration.expected
        return { value: clock - startedAt }
      },
      close: async application => {
        clock += 7_000
        events.push(`close:${application.id}`)
      },
      cleanup: async(declaration, isolation) => {
        clock += 9_000
        events.push(`cleanup:${declaration.id}:${isolation.profile}`)
      }
    })

    expect(result.measurements).toEqual([
      { value: 11 },
      { value: 22 },
      { value: 33 }
    ])
    expect(result.counts).toEqual({
      applicationLaunchCount: 3,
      uniqueProfileCount: 3,
      applicationCloseCount: 3,
      profileCleanupCount: 3
    })
    expect(events).toEqual([
      'create:warmup-1:/tmp/mt-performance-observation-1/profile',
      'launch:warmup-1:/tmp/mt-performance-observation-1/profile',
      'measure:warmup-1',
      'close:warmup-1',
      'cleanup:warmup-1:/tmp/mt-performance-observation-1/profile',
      'create:measured-1:/tmp/mt-performance-observation-2/profile',
      'launch:measured-1:/tmp/mt-performance-observation-2/profile',
      'measure:measured-1',
      'close:measured-1',
      'cleanup:measured-1:/tmp/mt-performance-observation-2/profile',
      'create:measured-2:/tmp/mt-performance-observation-3/profile',
      'launch:measured-2:/tmp/mt-performance-observation-3/profile',
      'measure:measured-2',
      'close:measured-2',
      'cleanup:measured-2:/tmp/mt-performance-observation-3/profile'
    ])
  })

  it('closes and removes the current profile after measurement failure without launching the next observation', async() => {
    const events: string[] = []
    const measurementFailure = new Error('exact measurement failed')

    await expect(runIsolatedPerformanceObservations([
      { id: 'first' },
      { id: 'must-not-launch' }
    ], {
      createIsolation: async(declaration, index) => {
        events.push(`create:${declaration.id}`)
        return { profile: `/tmp/mt-isolated-${String(index + 1)}/profile` }
      },
      launchAndPrepare: async declaration => {
        events.push(`launch:${declaration.id}`)
        return { id: declaration.id }
      },
      measure: async application => {
        events.push(`measure:${application.id}`)
        throw measurementFailure
      },
      close: async application => {
        events.push(`close:${application.id}`)
      },
      cleanup: async declaration => {
        events.push(`cleanup:${declaration.id}`)
      }
    })).rejects.toBe(measurementFailure)

    expect(events).toEqual([
      'create:first',
      'launch:first',
      'measure:first',
      'close:first',
      'cleanup:first'
    ])
  })

  it('creates and removes one exact run-owned profile root per observation', async() => {
    const runRoot = await mkdtemp(join(tmpdir(), 'mt-upstream-performance-'))
    try {
      const first = await createUpstreamPerformanceObservationIsolation(
        runRoot,
        0
      )
      const second = await createUpstreamPerformanceObservationIsolation(
        runRoot,
        1
      )
      await writeFile(join(first.root, 'profile-writer'), 'first')
      await writeFile(join(second.root, 'profile-writer'), 'second')

      expect(first).toEqual({
        root: join(runRoot, 'observations', 'observation-0001'),
        profile: join(
          runRoot,
          'observations',
          'observation-0001',
          'profile'
        )
      })
      expect(second.profile).not.toBe(first.profile)

      await removeUpstreamPerformanceObservationIsolation(runRoot, first)

      await expect(access(first.root, constants.F_OK)).rejects.toMatchObject({
        code: 'ENOENT'
      })
      await expect(access(second.root, constants.F_OK)).resolves.toBeUndefined()
    } finally {
      await rm(runRoot, { recursive: true, force: true })
    }
  })

  it('creates one blank bootstrap file outside every measured observation', async() => {
    const runRoot = await mkdtemp(join(tmpdir(), 'mt-upstream-performance-'))
    try {
      const bootstrap = await createUpstreamPerformanceBlankBootstrapFile(
        runRoot
      )

      expect(bootstrap).toBe(join(runRoot, 'blank-bootstrap.md'))
      expect(await readFile(bootstrap, 'utf8')).toBe('')
    } finally {
      await rm(runRoot, { recursive: true, force: true })
    }
  })

  it('budgets measurement and fresh lifecycle time per observation plus finalization headroom', () => {
    expect(upstreamPerformanceOrchestrationTimeoutMs(15)).toBe(630_000)
    expect(upstreamPerformanceOrchestrationTimeoutMs(350)).toBe(10_680_000)
    expect(upstreamPerformanceOrchestrationTimeoutMs(1_100)).toBe(33_180_000)
  })

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
      forceKill: processId => { events.push(`force-kill-${String(processId)}`) },
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
      forceKill: processId => { events.push(`force-kill-${String(processId)}`) },
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
      forceKill: processId => { events.push(`force-kill-${String(processId)}`) },
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

  it('terminates a failed launch whose executable ps spells in another case', async() => {
    const profile = '/tmp/mt-upstream-performance-case/profile'
    const identity = resolveUpstreamPerformanceProcessIdentity('/Apps/MarkText.app', profile, path => path)
    const running = new Set([48001, 48002])
    const events: string[] = []
    await closeFailedUpstreamPerformanceLaunch({
      closeBrowser: async() => { events.push('browser-close') },
      launcher: { pid: 48002 },
      processTable: [
        ` 48001 /Apps/MarkText.app/Contents/MacOS/MarkText --inspect-brk=1 --user-data-dir ${profile} /tmp/x.md`,
        ` 48003 /Apps/MarkText.app/Contents/MacOS/MarkTextHelper --user-data-dir ${profile}`
      ].join('\n'),
      identity
    }, {
      terminate: processId => {
        events.push(`terminate-${String(processId)}`)
        running.delete(processId)
      },
      forceKill: processId => { events.push(`force-kill-${String(processId)}`) },
      isRunning: processId => running.has(processId),
      sleep: async() => undefined,
      now: Date.now
    })
    expect(events).toEqual(['browser-close', 'terminate-48001', 'terminate-48002'])
    expect(running).toEqual(new Set())
  })

  it('force-kills an owned app that SIGTERM leaves running, as at --inspect-brk', async() => {
    const events: string[] = []
    const running = new Set([49001, 49002])
    let now = 0
    await closeUpstreamPerformanceApplication({
      closeBrowser: async() => { events.push('browser-close') },
      processId: 49001,
      launcher: { pid: 49002 }
    }, {
      terminate: processId => {
        events.push(`terminate-${String(processId)}`)
        if (processId === 49002) running.delete(processId)
      },
      forceKill: processId => {
        events.push(`force-kill-${String(processId)}`)
        running.delete(processId)
      },
      isRunning: processId => running.has(processId),
      sleep: async() => { now += 1_000 },
      now: () => now
    })
    expect(events).toEqual(['browser-close', 'terminate-49001', 'force-kill-49001', 'terminate-49002'])
    expect(running).toEqual(new Set())
  })

  it('force-kills a group leader with its group and any other process alone', () => {
    const kills: Array<[number, string]> = []
    const kill = (target: number, signal: NodeJS.Signals) => { kills.push([target, signal]) }
    forceKillOwnedProcess(51001, () => 51001, kill)
    forceKillOwnedProcess(51002, () => 700, kill)
    forceKillOwnedProcess(51003, () => undefined, kill)
    expect(kills).toEqual([[-51001, 'SIGKILL'], [51002, 'SIGKILL'], [51003, 'SIGKILL']])
    expect(() => forceKillOwnedProcess(51004, () => undefined, () => {
      throw Object.assign(new Error('gone'), { code: 'ESRCH' })
    })).not.toThrow()
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
