import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { dirname, isAbsolute, parse, resolve } from 'node:path'

interface Arguments {
  readonly candidateCommit: string
  readonly outputRoot: string
  readonly runId: string
}

interface ArtifactMetadata {
  readonly id: number
  readonly name: string
  readonly digest: string
  readonly expired: boolean
}

interface WorkflowRunMetadata {
  readonly conclusion: string
  readonly event: string
  readonly head_branch: string
  readonly head_sha: string
  readonly html_url: string
  readonly id: number
  readonly path: string
  readonly run_attempt: number
  readonly status: string
  readonly workflow_id: number
}

interface GitRefMetadata {
  readonly ref: string
  readonly object: Readonly<{
    readonly sha: string
    readonly type: string
  }>
}

interface PublicationAttestation {
  readonly artifactName: string
  readonly candidateCommit: string
  readonly evidenceSha256: string
  readonly publicationRunId: string
  readonly refName: string
  readonly refType: string
  readonly runAttempt: string
  readonly schema: string
  readonly sourceRunIds: readonly string[]
  readonly state: string
  readonly verifiedAt: string
  readonly workflow: string
  readonly workflowRef: string
}

const WORKFLOW_NAME = 'builds and exercises Review on macOS Windows and Linux'
const WORKFLOW_PATH = '.github/workflows/document-core-platform.yml'
const REPOSITORY = 'csells/MarkText'

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string
): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${label} has unexpected fields`)
  }
}

function parseArguments(values: readonly string[]): Arguments {
  const parsed = new Map<string, string>()
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]
    const value = values[index + 1]
    if (key === undefined || value === undefined || !key.startsWith('--') || parsed.has(key)) {
      throw new Error('Published evidence arguments must be unique key/value pairs')
    }
    parsed.set(key, value)
  }
  const candidateCommit = parsed.get('--candidate')
  const outputRoot = parsed.get('--output-root')
  const runId = parsed.get('--publication-run')
  if (parsed.size !== 3 || candidateCommit === undefined || !/^[0-9a-f]{40}$/u.test(candidateCommit)) {
    throw new Error('--candidate requires one exact 40-character commit')
  }
  if (runId === undefined || !/^[1-9]\d*$/u.test(runId)) {
    throw new Error('--publication-run requires one numeric run id')
  }
  if (
    outputRoot === undefined ||
    !isAbsolute(outputRoot) ||
    resolve(outputRoot) === parse(resolve(outputRoot)).root
  ) {
    throw new Error('--output-root requires one non-root absolute path')
  }
  return Object.freeze({ candidateCommit, outputRoot: resolve(outputRoot), runId })
}

function jsonCommand(arguments_: readonly string[]): unknown {
  return JSON.parse(
    execFileSync('gh', arguments_, {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    })
  ) as unknown
}

function normalizedContentRoot(root: string): string {
  const roots = [
    root,
    ...readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => resolve(root, entry.name))
  ]
  const matches = roots.filter((candidate) => {
    const evidencePath = resolve(candidate, 'specs/migration/0009-candidate-evidence.yml')
    const evidenceTree = resolve(candidate, 'specs/migration/0009-evidence')
    return (
      existsSync(evidencePath) &&
      statSync(evidencePath).isFile() &&
      existsSync(evidenceTree) &&
      statSync(evidenceTree).isDirectory()
    )
  })
  if (matches.length !== 1 || matches[0] === undefined) {
    throw new Error('Published evidence artifact has no unique normalized candidate evidence tree')
  }
  return matches[0]
}

function publicationAttestation(
  contentRoot: string,
  expected: Readonly<{
    artifactName: string
    candidateCommit: string
    evidenceSha256: string
    publicationRunId: string
    refName: string
    sourceRunIds: readonly number[]
  }>
): PublicationAttestation {
  const path = resolve(contentRoot, '0009-publication-attestation.json')
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error('Published evidence has no publication attestation')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    throw new Error('Published evidence publication attestation is not JSON')
  }
  const attestation = record(parsed, 'Published evidence publication attestation')
  exactKeys(
    attestation,
    [
      'artifactName',
      'candidateCommit',
      'evidenceSha256',
      'publicationRunId',
      'refName',
      'refType',
      'runAttempt',
      'schema',
      'sourceRunIds',
      'state',
      'verifiedAt',
      'workflow',
      'workflowRef'
    ],
    'Published evidence publication attestation'
  )
  const expectedWorkflowRef = `${REPOSITORY}/${WORKFLOW_PATH}@refs/tags/${expected.refName}`
  if (
    attestation.schema !== 'marktext-0009-publication-attestation-v1' ||
    attestation.state !== 'verified' ||
    attestation.candidateCommit !== expected.candidateCommit ||
    attestation.publicationRunId !== expected.publicationRunId ||
    attestation.runAttempt !== '1' ||
    attestation.refName !== expected.refName ||
    attestation.refType !== 'tag' ||
    attestation.workflow !== WORKFLOW_NAME ||
    attestation.workflowRef !== expectedWorkflowRef ||
    attestation.evidenceSha256 !== expected.evidenceSha256 ||
    attestation.artifactName !== expected.artifactName ||
    !Array.isArray(attestation.sourceRunIds) ||
    JSON.stringify(attestation.sourceRunIds) !==
      JSON.stringify(expected.sourceRunIds.map(String)) ||
    typeof attestation.verifiedAt !== 'string' ||
    !Number.isFinite(Date.parse(attestation.verifiedAt))
  ) {
    throw new Error('Published evidence publication attestation has the wrong identity')
  }
  return attestation as unknown as PublicationAttestation
}

function main(): void {
  const { candidateCommit, outputRoot, runId } = parseArguments(process.argv.slice(2))
  const repository = REPOSITORY
  const run = jsonCommand([
    'run',
    'view',
    runId,
    '--repo',
    repository,
    '--exit-status',
    '--json',
    'attempt,conclusion,databaseId,event,headBranch,headSha,status,url,workflowName'
  ]) as Record<string, unknown>
  const tag = `evidence/0009/publish-${candidateCommit}-`
  if (
    run.attempt !== 1 ||
    run.conclusion !== 'success' ||
    run.status !== 'completed' ||
    run.event !== 'push' ||
    run.databaseId !== Number(runId) ||
    run.headSha !== candidateCommit ||
    typeof run.headBranch !== 'string' ||
    !run.headBranch.startsWith(tag) ||
    !new RegExp(`^${tag}([1-9]\\d*)-([1-9]\\d*)$`, 'u').test(run.headBranch) ||
    run.workflowName !== WORKFLOW_NAME ||
    run.url !== `https://github.com/${repository}/actions/runs/${runId}`
  ) {
    throw new Error('Published evidence run is not the exact first-attempt candidate publication')
  }
  const apiRun = jsonCommand([
    'api',
    `repos/${repository}/actions/runs/${runId}`
  ]) as WorkflowRunMetadata
  if (
    apiRun.id !== Number(runId) ||
    !Number.isSafeInteger(apiRun.workflow_id) ||
    apiRun.workflow_id <= 0 ||
    apiRun.path !== WORKFLOW_PATH ||
    apiRun.run_attempt !== run.attempt ||
    apiRun.status !== run.status ||
    apiRun.conclusion !== run.conclusion ||
    apiRun.event !== run.event ||
    apiRun.head_branch !== run.headBranch ||
    apiRun.head_sha !== run.headSha ||
    apiRun.html_url !== run.url
  ) {
    throw new Error('Published evidence run does not use the exact workflow path and identity')
  }
  const gitRef = jsonCommand([
    'api',
    `repos/${repository}/git/ref/tags/${apiRun.head_branch}`
  ]) as GitRefMetadata
  if (
    gitRef.ref !== `refs/tags/${apiRun.head_branch}` ||
    gitRef.object.type !== 'commit' ||
    gitRef.object.sha !== candidateCommit
  ) {
    throw new Error('Published evidence run is not bound to an exact lightweight candidate tag')
  }
  const listing = jsonCommand([
    'api',
    `repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`
  ]) as { readonly artifacts?: readonly ArtifactMetadata[] }
  if (!Array.isArray(listing.artifacts)) throw new Error('Published evidence artifact list is invalid')
  const prefix = `document-core-candidate-evidence-${candidateCommit}-`
  const matches = listing.artifacts.filter(
    (artifact) => artifact.name.startsWith(prefix) && !artifact.expired
  )
  if (matches.length !== 1) {
    throw new Error('Published evidence run must retain exactly one candidate evidence artifact')
  }
  const artifact = matches[0]
  if (
    artifact === undefined ||
    !Number.isSafeInteger(artifact.id) ||
    artifact.id <= 0 ||
    !/^sha256:[0-9a-f]{64}$/u.test(artifact.digest) ||
    !new RegExp(`^${prefix}[0-9a-f]{64}$`, 'u').test(artifact.name)
  ) {
    throw new Error('Published evidence artifact identity is invalid')
  }
  const sourceRunIds = run.headBranch.slice(tag.length).split('-').map(Number)
  if (
    sourceRunIds.length !== 2 ||
    sourceRunIds[0] === sourceRunIds[1] ||
    sourceRunIds.includes(Number(runId))
  ) {
    throw new Error('Published evidence needs two distinct non-publication source runs')
  }
  const downloadRoot = resolve(outputRoot, '.download')
  rmSync(downloadRoot, { recursive: true, force: true })
  mkdirSync(downloadRoot, { recursive: true })
  try {
    execFileSync('gh', [
      'run',
      'download',
      runId,
      '--repo',
      repository,
      '--name',
      artifact.name,
      '--dir',
      downloadRoot
    ])
    const contentRoot = normalizedContentRoot(downloadRoot)
    const evidenceBytes = readFileSync(
      resolve(contentRoot, 'specs/migration/0009-candidate-evidence.yml')
    )
    const evidenceSha256 = createHash('sha256').update(evidenceBytes).digest('hex')
    publicationAttestation(contentRoot, {
      artifactName: artifact.name,
      candidateCommit,
      evidenceSha256,
      publicationRunId: runId,
      refName: run.headBranch,
      sourceRunIds
    })
    const normalizedRoot = resolve(outputRoot, 'normalized')
    rmSync(normalizedRoot, { recursive: true, force: true })
    mkdirSync(dirname(normalizedRoot), { recursive: true })
    renameSync(contentRoot, normalizedRoot)
    process.stdout.write(
      JSON.stringify({
        schema: 'marktext-0009-publication-v1',
        candidateCommit,
        publicationRunId: Number(runId),
        sourceRunIds,
        workflowDatabaseId: apiRun.workflow_id,
        workflowPath: apiRun.path,
        refName: run.headBranch,
        refType: 'tag',
        artifactId: artifact.id,
        artifactName: artifact.name,
        artifactDigest: artifact.digest,
        normalizedRoot
      }) + '\n'
    )
  } finally {
    rmSync(downloadRoot, { recursive: true, force: true })
  }
}

try {
  main()
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
