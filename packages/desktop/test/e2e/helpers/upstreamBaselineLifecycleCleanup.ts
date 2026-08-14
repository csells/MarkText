import { realpathSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

interface UpstreamPerformanceApplicationLifecycle {
  readonly closeBrowser: () => Promise<void>
  readonly processId?: number
  readonly launcher: Readonly<{ readonly pid?: number }>
}

interface FailedUpstreamPerformanceLaunch {
  readonly closeBrowser: () => Promise<void>
  readonly launcher: Readonly<{ readonly pid?: number }>
  readonly processTable: string
  readonly identity: Readonly<UpstreamPerformanceProcessIdentity>
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

export interface UpstreamPerformanceObservationIsolation {
  readonly root: string
  readonly profile: string
}

const CLEANUP_TIMEOUT_MS = 10_000
const ORCHESTRATION_MEASUREMENT_BUDGET_MS = 15_000
const ORCHESTRATION_LIFECYCLE_BUDGET_MS = 15_000
const ORCHESTRATION_FINALIZATION_HEADROOM_MS = 180_000

export const upstreamPerformanceOrchestrationTimeoutMs = (
  totalSamples: number
): number => {
  if (!Number.isSafeInteger(totalSamples) || totalSamples < 1) {
    throw new Error('Upstream performance total samples must be a positive integer')
  }
  const timeout = totalSamples * (
    ORCHESTRATION_MEASUREMENT_BUDGET_MS +
    ORCHESTRATION_LIFECYCLE_BUDGET_MS
  ) +
    ORCHESTRATION_FINALIZATION_HEADROOM_MS
  if (!Number.isSafeInteger(timeout)) {
    throw new Error('Upstream performance orchestration timeout is unsafe')
  }
  return timeout
}

export interface UpstreamPerformanceProcessIdentity {
  readonly executable: string
  readonly profile: string
}

export const resolveUpstreamPerformanceProcessIdentity = (
  appBundle: string,
  profile: string,
  resolveExecutable: (executable: string) => string = realpathSync
): Readonly<UpstreamPerformanceProcessIdentity> => Object.freeze({
  executable: resolveExecutable(join(
    appBundle,
    'Contents/MacOS/marktext'
  )),
  profile
})

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

const matchingUpstreamPerformanceProcessIds = (
  processTable: string,
  executable: string,
  profile: string
): readonly number[] => Object.freeze(processTable.split('\n').flatMap(line => {
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
}).filter(candidate => Number.isSafeInteger(candidate) && candidate > 0))

export const findUpstreamPerformanceProcessId = (
  processTable: string,
  identity: Readonly<UpstreamPerformanceProcessIdentity>
): number | undefined => {
  const candidates = matchingUpstreamPerformanceProcessIds(
    processTable,
    identity.executable,
    identity.profile
  )
  if (candidates.length > 1) {
    throw new Error(
      'Expected at most one upstream main process for the unique profile; ' +
      `found ${String(candidates.length)}`
    )
  }
  return candidates[0]
}

export const closeFailedUpstreamPerformanceLaunch = async(
  application: FailedUpstreamPerformanceLaunch,
  lifecycle: UpstreamProcessLifecycle
): Promise<void> => {
  const processIds = matchingUpstreamPerformanceProcessIds(
    application.processTable,
    application.identity.executable,
    application.identity.profile
  )
  const ambiguityFailure = processIds.length > 1
    ? new Error(
      'Expected at most one upstream main process for the unique profile; ' +
      `found ${String(processIds.length)}`
    )
    : undefined
  let cleanupFailure: unknown
  try {
    await application.closeBrowser().catch(() => undefined)
    for (const processId of processIds) {
      if (!lifecycle.isRunning(processId)) continue
      lifecycle.terminate(processId)
      await waitForExit(processId, lifecycle)
    }
    const launcherId = application.launcher.pid
    if (launcherId !== undefined && lifecycle.isRunning(launcherId)) {
      lifecycle.terminate(launcherId)
      await waitForExit(launcherId, lifecycle)
    }
  } catch (error) {
    cleanupFailure = error
  }
  if (ambiguityFailure !== undefined && cleanupFailure !== undefined) {
    throw new AggregateError(
      [ambiguityFailure, cleanupFailure],
      'Upstream performance process identity and cleanup both failed'
    )
  }
  if (cleanupFailure !== undefined) throw cleanupFailure
  if (ambiguityFailure !== undefined) throw ambiguityFailure
}

const transientRemovalRace = (error: unknown): boolean => error instanceof Error &&
  'code' in error && (error.code === 'ENOTEMPTY' || error.code === 'EBUSY')

const ownedUpstreamPerformanceRunRoot = (runRoot: string): string => {
  const ownedRoot = resolve(runRoot)
  if (
    dirname(ownedRoot) !== resolve(tmpdir()) ||
    !basename(ownedRoot).startsWith('mt-upstream-performance-')
  ) {
    throw new Error(`Refusing to use non-owned run root: ${ownedRoot}`)
  }
  return ownedRoot
}

const removeOwnedUpstreamPerformanceRoot = async(
  ownedRoot: string,
  lifecycle: UpstreamRunRootLifecycle
): Promise<void> => {
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

export const createUpstreamPerformanceObservationIsolation = async(
  runRoot: string,
  index: number
): Promise<Readonly<UpstreamPerformanceObservationIsolation>> => {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error('Upstream performance observation index must be non-negative')
  }
  const ownedRoot = ownedUpstreamPerformanceRunRoot(runRoot)
  const observationsRoot = join(ownedRoot, 'observations')
  await mkdir(observationsRoot, { recursive: true })
  const root = join(
    observationsRoot,
    `observation-${String(index + 1).padStart(4, '0')}`
  )
  await mkdir(root)
  return Object.freeze({
    root,
    profile: join(root, 'profile')
  })
}

export const createUpstreamPerformanceBlankBootstrapFile = async(
  runRoot: string
): Promise<string> => {
  const ownedRoot = ownedUpstreamPerformanceRunRoot(runRoot)
  const bootstrap = join(ownedRoot, 'blank-bootstrap.md')
  await writeFile(bootstrap, '', { encoding: 'utf8', flag: 'wx' })
  return bootstrap
}

export const removeUpstreamPerformanceObservationIsolation = async(
  runRoot: string,
  isolation: Readonly<UpstreamPerformanceObservationIsolation>,
  lifecycle: UpstreamRunRootLifecycle = {
    remove: root => rm(root, { recursive: true }),
    sleep: () => new Promise(resolve => setTimeout(resolve, 50)),
    now: Date.now
  }
): Promise<void> => {
  const ownedRoot = ownedUpstreamPerformanceRunRoot(runRoot)
  const observationRoot = resolve(isolation.root)
  const observationsRoot = join(ownedRoot, 'observations')
  if (
    dirname(observationRoot) !== observationsRoot ||
    !/^observation-[0-9]{4,}$/u.test(basename(observationRoot)) ||
    resolve(isolation.profile) !== join(observationRoot, 'profile')
  ) {
    throw new Error(
      `Refusing to remove non-owned observation root: ${observationRoot}`
    )
  }
  await removeOwnedUpstreamPerformanceRoot(observationRoot, lifecycle)
}

export const removeUpstreamPerformanceRunRoot = async(
  runRoot: string,
  lifecycle: UpstreamRunRootLifecycle = {
    remove: root => rm(root, { recursive: true }),
    sleep: () => new Promise(resolve => setTimeout(resolve, 50)),
    now: Date.now
  }
): Promise<void> => {
  const ownedRoot = ownedUpstreamPerformanceRunRoot(runRoot)
  await removeOwnedUpstreamPerformanceRoot(ownedRoot, lifecycle)
}

export const finalizeUpstreamPerformanceRun = async(
  runRoot: string,
  writeOutput: () => void,
  lifecycle?: UpstreamRunRootLifecycle
): Promise<void> => {
  await removeUpstreamPerformanceRunRoot(runRoot, lifecycle)
  writeOutput()
}
