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

export const readUpstreamBaselineMachineEnvironment = (): Readonly<
  Record<string, string>
> => {
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
  return Object.freeze({
    hardware: formatUpstreamBaselineHardware(item),
    os: `macOS ${productVersion} (${buildVersion}), ${process.arch}`,
    build: 'MarkText production Electron bundle'
  })
}
