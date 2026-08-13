import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, resolve } from 'node:path'

interface UpstreamPerformanceApplicationLifecycle {
  readonly closeBrowser: () => Promise<void>
  readonly processId?: number
  readonly launcher: Readonly<{ readonly pid?: number }>
}

interface UpstreamProcessLifecycle {
  readonly terminate: (processId: number) => void
  readonly isRunning: (processId: number) => boolean
  readonly sleep: () => Promise<void>
  readonly now: () => number
}

interface UpstreamRunRootLifecycle {
  readonly remove: (runRoot: string) => Promise<void>
  readonly sleep: () => Promise<void>
  readonly now: () => number
}

const CLEANUP_TIMEOUT_MS = 10_000

const waitForExit = async(
  processId: number,
  lifecycle: UpstreamProcessLifecycle
): Promise<void> => {
  const deadline = lifecycle.now() + CLEANUP_TIMEOUT_MS
  while (lifecycle.isRunning(processId)) {
    if (lifecycle.now() >= deadline) {
      throw new Error(
        `Upstream performance process ${String(processId)} did not exit`
      )
    }
    await lifecycle.sleep()
  }
}

export const closeUpstreamPerformanceApplication = async(
  application: UpstreamPerformanceApplicationLifecycle,
  lifecycle: UpstreamProcessLifecycle
): Promise<void> => {
  await application.closeBrowser().catch(() => undefined)
  const processId = application.processId
  if (processId !== undefined && lifecycle.isRunning(processId)) {
    lifecycle.terminate(processId)
    await waitForExit(processId, lifecycle)
  }
  const launcherId = application.launcher.pid
  if (launcherId !== undefined && lifecycle.isRunning(launcherId)) {
    lifecycle.terminate(launcherId)
    await waitForExit(launcherId, lifecycle)
  }
}

export const findUpstreamPerformanceProcessId = (
  processTable: string,
  executable: string,
  profile: string
): number | undefined => {
  const candidates = processTable.split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(.+)$/u.exec(line)
    const command = match?.[2]
    if (
      command === undefined ||
      (command !== executable && !command.startsWith(`${executable} `))
    ) return []
    const profileArguments = [
      `--user-data-dir ${profile}`,
      `--user-data-dir=${profile}`
    ]
    if (!profileArguments.some(argument => {
      const offset = command.indexOf(argument)
      if (offset < 0) return false
      const following = command[offset + argument.length]
      return following === undefined || following === ' '
    })) return []
    return match?.[1] === undefined ? [] : [Number(match[1])]
  }).filter(candidate => Number.isSafeInteger(candidate) && candidate > 0)
  if (candidates.length > 1) {
    throw new Error(
      'Expected at most one upstream main process for the unique profile; ' +
      `found ${String(candidates.length)}`
    )
  }
  return candidates[0]
}

const transientRemovalRace = (error: unknown): boolean => error instanceof Error &&
  'code' in error && (error.code === 'ENOTEMPTY' || error.code === 'EBUSY')

export const removeUpstreamPerformanceRunRoot = async(
  runRoot: string,
  lifecycle: UpstreamRunRootLifecycle = {
    remove: root => rm(root, { recursive: true }),
    sleep: () => new Promise(resolve => setTimeout(resolve, 50)),
    now: Date.now
  }
): Promise<void> => {
  const ownedRoot = resolve(runRoot)
  if (
    dirname(ownedRoot) !== resolve(tmpdir()) ||
    !basename(ownedRoot).startsWith('mt-upstream-performance-')
  ) {
    throw new Error(`Refusing to remove non-owned run root: ${ownedRoot}`)
  }
  const deadline = lifecycle.now() + CLEANUP_TIMEOUT_MS
  for (;;) {
    try {
      await lifecycle.remove(ownedRoot)
      return
    } catch (error) {
      if (!transientRemovalRace(error) || lifecycle.now() >= deadline) throw error
      await lifecycle.sleep()
    }
  }
}

export const finalizeUpstreamPerformanceRun = async(
  runRoot: string,
  writeOutput: () => void,
  lifecycle?: UpstreamRunRootLifecycle
): Promise<void> => {
  await removeUpstreamPerformanceRunRoot(runRoot, lifecycle)
  writeOutput()
}
