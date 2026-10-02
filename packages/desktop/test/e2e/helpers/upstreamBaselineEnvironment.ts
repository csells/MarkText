import { execFileSync } from 'node:child_process'

export interface MacHardwareProfile {
  readonly machine_name?: string
  readonly machine_model?: string
  readonly chip_type?: string
  readonly physical_memory?: string
}

const requiredHardwareField = (
  value: string | undefined,
  label: string
): string => {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Upstream hardware ${label} is required`)
  }
  return value.trim()
}

export const formatUpstreamBaselineHardware = (
  profile: MacHardwareProfile
): string => {
  const product = requiredHardwareField(profile.machine_name, 'product name')
  const model = requiredHardwareField(profile.machine_model, 'model')
  const chip = requiredHardwareField(profile.chip_type, 'chip type')
  const memory = requiredHardwareField(profile.physical_memory, 'physical memory')
  return `${product} ${model}, ${chip}, ${memory}`
}

export interface UpstreamBaselineMachineEnvironment {
  /** The host properties a ratification run must share with the performance targets. */
  readonly pinned: Readonly<Record<string, string>>
  /** The raw-run evidence: the pinned properties plus the macOS version, which never gates a run. */
  readonly recorded: Readonly<Record<string, string>>
}

export const readUpstreamBaselineMachineEnvironment =
  (): UpstreamBaselineMachineEnvironment => {
    const hardware = JSON.parse(execFileSync(
      'system_profiler',
      ['SPHardwareDataType', '-json'],
      { encoding: 'utf8' }
    )) as { readonly SPHardwareDataType?: readonly MacHardwareProfile[] }
    const item = hardware.SPHardwareDataType?.[0]
    if (item === undefined) throw new Error('macOS hardware profile is unavailable')
    const productVersion = execFileSync('sw_vers', ['-productVersion'], {
      encoding: 'utf8'
    }).trim()
    const buildVersion = execFileSync('sw_vers', ['-buildVersion'], {
      encoding: 'utf8'
    }).trim()
    const pinned = Object.freeze({
      hardware: formatUpstreamBaselineHardware(item),
      architecture: process.arch,
      build: 'MarkText production Electron bundle'
    })
    return Object.freeze({
      pinned,
      recorded: Object.freeze({
        ...pinned,
        os: `macOS ${productVersion} (${buildVersion})`
      })
    })
  }
