// G9: two-sided mutation proof runner. For one acceptance target: prove the
// un-mutated tree passes it, apply the stated production mutation, prove the
// target fails, restore, and record both results. A target that cannot pass
// its own baseline is red, not proved; assertion presence is not proof.
//
//   node scripts/mutationProof.mjs A05
//
// The mutation is authored in specs/migration/0009-mutation-proofs.yml before
// running; this runner only fills in the evidence fields. It touches exactly
// one tracked source file and restores it through git, refusing to start if
// that file is dirty.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname)
const acceptancePath = path.join(
  repoRoot, 'specs', 'migration', '0009-acceptance.yml'
)
const proofsPath = path.join(
  repoRoot, 'specs', 'migration', '0009-mutation-proofs.yml'
)

const fail = (message) => {
  console.error(`mutation-proof: ${message}`)
  process.exit(1)
}

const id = process.argv[2]
if (!id || !/^A\d+$/.test(id)) fail('usage: node scripts/mutationProof.mjs A<N>')

const acceptance = JSON.parse(readFileSync(acceptancePath, 'utf8'))
const target = acceptance.acceptance.find((entry) => entry.id === id)
if (!target) fail(`${id} is not an acceptance target`)

const proofs = JSON.parse(readFileSync(proofsPath, 'utf8'))
const proof = proofs.proofs.find((entry) => entry.id === id)
if (!proof) fail(`${id} has no authored mutation in 0009-mutation-proofs.yml`)
for (const field of ['file', 'exactOld', 'exactNew', 'statement']) {
  if (typeof proof.mutation?.[field] !== 'string' || !proof.mutation[field]) {
    fail(`${id} mutation is missing ${field}`)
  }
}

const targetPath = target.target.path
const packageDir = targetPath.startsWith('packages/document-core/')
  ? 'packages/document-core'
  : targetPath.startsWith('packages/desktop/')
    ? 'packages/desktop'
    : null
if (packageDir === null) fail(`${id} target package is not recognized`)
const relativeTarget = targetPath.slice(packageDir.length + 1)
const isE2e = relativeTarget.startsWith('test/e2e/')
// Installed targets run the packaged artifact; each phase repackages so
// the bundle under test carries that phase's sources. HEAD does not move
// across phases (mutation dirties the tree only), so the artifact's
// embedded commit equals HEAD in every phase.
const isInstalled = relativeTarget.startsWith('test/e2e/installed-')
const command = isE2e
  ? ['npx', '-y', 'pnpm@10.33.4', 'exec', 'playwright', 'test',
      '--config', 'test/e2e/playwright.config.ts', relativeTarget]
  : ['npx', '-y', 'pnpm@10.33.4', 'exec', 'vitest', 'run', relativeTarget]
const headCommit = execFileSync(
  'git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }
).trim()
const installedEnvironment = isInstalled
  ? {
      ...process.env,
      MARKTEXT_PACKAGED_APP: path.join(
        repoRoot, 'dist', 'mac-arm64',
        'marktext.app', 'Contents', 'MacOS', 'marktext'
      ),
      MARKTEXT_EXPECTED_COMMIT: headCommit
    }
  : undefined

const mutatedFile = path.join(repoRoot, proof.mutation.file)
const porcelain = () => execFileSync(
  'git', ['status', '--porcelain', '--', proof.mutation.file],
  { cwd: repoRoot, encoding: 'utf8' }
).trim()
if (porcelain() !== '') {
  fail(`${proof.mutation.file} is dirty; refusing to mutate a dirty file`)
}

// An e2e target runs the packaged renderer/main bundles, so a source
// mutation is invisible until the desktop build regenerates them — and the
// build-freshness gate would otherwise fail the run loudly. Unit targets
// import source directly and skip this.
const rebuildForE2e = (label) => {
  if (!isE2e) return
  if (isInstalled) {
    console.log(`mutation-proof: repackaging installed artifact (${label})…`)
    const packaged = spawnSync(
      'npx', ['-y', 'pnpm@10.33.4', 'run', 'build:mac:arm64'],
      { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    )
    if (packaged.status !== 0) {
      fail(`artifact packaging failed (${label}); inspect before retrying`)
    }
    return
  }
  console.log(`mutation-proof: rebuilding desktop (${label})…`)
  const build = spawnSync(
    'npx', ['-y', 'pnpm@10.33.4', 'run', 'build:desktop'],
    {
      cwd: path.join(repoRoot, 'packages', 'desktop'),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    }
  )
  if (build.status !== 0) {
    fail(`desktop build failed (${label}); inspect before retrying`)
  }
}

const runTarget = (label) => {
  console.log(`mutation-proof: running ${id} (${label})…`)
  const run = spawnSync(command[0], command.slice(1), {
    cwd: path.join(repoRoot, packageDir),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: installedEnvironment
  })
  const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`
  return { passed: run.status === 0, output }
}

const startedAt = new Date().toISOString()
rebuildForE2e('baseline')
const baseline = runTarget('baseline')
if (!baseline.passed) {
  fail(`${id} failed its baseline; the target is red, not provable`)
}

const original = readFileSync(mutatedFile, 'utf8')
const occurrences = original.split(proof.mutation.exactOld).length - 1
if (occurrences !== 1) {
  fail(`${id} exactOld matches ${occurrences} times; a mutation must be exact`)
}
writeFileSync(
  mutatedFile,
  original.replace(proof.mutation.exactOld, proof.mutation.exactNew)
)

let mutated
try {
  rebuildForE2e('mutated')
  mutated = runTarget('mutated')
} finally {
  execFileSync(
    'git', ['restore', '--', proof.mutation.file], { cwd: repoRoot }
  )
  rebuildForE2e('restored')
}
if (porcelain() !== '') {
  fail(`${proof.mutation.file} did not restore cleanly; inspect the tree`)
}
if (mutated.passed) {
  fail(`${id} still passes under its stated mutation; the proof is one-sided`)
}

const failureLines = mutated.output
  .split('\n')
  .filter((line) => /FAIL|Error|expect|×|failed/.test(line))
  .slice(0, 6)
  .join('\n')
  .trim()

proof.baseline = Object.freeze({
  command: `${packageDir}: ${command.join(' ')}`,
  outcome: 'pass',
  at: startedAt
})
proof.mutated = Object.freeze({
  outcome: 'fail',
  failureExcerpt: failureLines.slice(0, 2000) || 'target exited non-zero'
})
proof.recordedAt = new Date().toISOString()
writeFileSync(proofsPath, `${JSON.stringify(proofs, null, 2)}\n`)
console.log(`mutation-proof: ${id} proved two-sided and recorded.`)
