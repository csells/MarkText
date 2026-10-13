import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

// The shipped app turns Electron's EnableNodeCliInspectArguments fuse off, so
// packaged `--debug` reaches MarkText (#5409, upstream #5643). Playwright's
// Electron launcher attaches through Node's `--inspect`, which that fuse
// refuses. The installed suite therefore drives a copy of the artifact with
// only that fuse on; `installed-artifact-launch.spec.ts` launches the artifact
// itself, fuse off, over the Chromium debugging protocol.

const workspaceRoot = path.resolve(__dirname, '../../../..')

/** Names the artifact itself once the installed suite drives its copy. */
export const PACKAGED_ARTIFACT_ENV = 'MARKTEXT_PACKAGED_ARTIFACT'

/** The `.app` bundle holding a macOS executable, or the executable's directory. */
const bundleRootOf = (executable: string): string => {
  let current = path.dirname(executable)
  while (current !== path.dirname(current)) {
    if (current.endsWith('.app')) return current
    current = path.dirname(current)
  }
  return path.dirname(executable)
}

const asarOf = (bundleRoot: string): string => bundleRoot.endsWith('.app')
  ? path.join(bundleRoot, 'Contents', 'Resources', 'app.asar')
  : path.join(bundleRoot, 'resources', 'app.asar')

const sha256Of = (file: string): string => createHash('sha256').update(fs.readFileSync(file)).digest('hex')

/**
 * Copies the artifact `executable` belongs to into `directory`, turns the
 * inspect-arguments fuse on in the copy, re-signs it ad hoc on macOS, and
 * returns the copy's executable. The copy runs the artifact's own `app.asar`.
 */
export const prepareInstalledTestCopy = (executable: string, directory: string): string => {
  const original = path.resolve(executable)
  const bundleRoot = bundleRootOf(original)
  const copyRoot = path.join(directory, path.basename(bundleRoot))
  fs.rmSync(copyRoot, { recursive: true, force: true })
  fs.mkdirSync(directory, { recursive: true })
  fs.cpSync(bundleRoot, copyRoot, { recursive: true, verbatimSymlinks: true })
  const copy = path.join(copyRoot, path.relative(bundleRoot, original))

  const fuses = path.join(workspaceRoot, 'node_modules', '.bin', 'electron-fuses')
  const target = copyRoot.endsWith('.app') ? copyRoot : copy
  execFileSync(fuses, ['write', '--app', target, 'EnableNodeCliInspectArguments=on'], { stdio: 'pipe' })
  if (process.platform === 'darwin') {
    execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', copyRoot], { stdio: 'pipe' })
  }

  const expected = sha256Of(asarOf(bundleRoot))
  const actual = sha256Of(asarOf(copyRoot))
  if (actual !== expected) {
    throw new Error(`The installed test copy's app.asar (${actual}) differs from the artifact's (${expected})`)
  }
  const state = execFileSync(fuses, ['read', '--app', target], { encoding: 'utf8' })
  if (!/EnableNodeCliInspectArguments is Enabled/u.test(state)) {
    throw new Error(`The installed test copy kept the inspect-arguments fuse off:\n${state}`)
  }
  return copy
}
