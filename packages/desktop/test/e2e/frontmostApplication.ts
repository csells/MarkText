import { execFileSync } from 'node:child_process'

export const processIdFromLsappinfo = (output: string): number => {
  const match = /"pid"\s*=\s*(\d+)/u.exec(output)
  const processId = match === null ? Number.NaN : Number(match[1])
  if (!Number.isSafeInteger(processId) || processId < 1) {
    throw new Error('lsappinfo returned an invalid frontmost process id')
  }
  return processId
}

export const frontmostApplicationProcessId = (): number | undefined => {
  if (process.platform !== 'darwin') return undefined
  const application = execFileSync('/usr/bin/lsappinfo', ['front'], {
    encoding: 'utf8'
  }).trim()
  const information = execFileSync(
    '/usr/bin/lsappinfo',
    ['info', '-only', 'pid', application],
    { encoding: 'utf8' }
  )
  return processIdFromLsappinfo(information)
}
