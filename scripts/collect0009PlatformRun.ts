import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, resolve } from 'node:path'

interface Arguments {
  readonly runId: string
  readonly repository: string
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

function parseArguments(values: readonly string[]): Arguments {
  let runId: string | undefined
  let repository: string | undefined
  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index]
    const value = values[index + 1]
    if (argument === '--github-run' && value !== undefined && runId === undefined) {
      runId = value
      index += 1
    } else if (argument === '--repo' && value !== undefined && repository === undefined) {
      repository = value
      index += 1
    } else {
      throw new Error(`Unknown platform evidence argument: ${String(argument)}`)
    }
  }
  if (runId === undefined || !/^[1-9]\d*$/u.test(runId)) {
    throw new Error('--github-run requires one numeric run id')
  }
  if (repository !== 'csells/MarkText') {
    throw new Error('--repo must be csells/MarkText')
  }
  return Object.freeze({ runId, repository })
}

function jsonCommand(arguments_: readonly string[]): unknown {
  return JSON.parse(
    execFileSync('gh', arguments_, {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    })
  ) as unknown
}

function filesUnder(root: string): readonly string[] {
  const paths: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name)
    if (entry.isDirectory()) paths.push(...filesUnder(path))
    else if (entry.isFile()) paths.push(path)
  }
  return paths
}

function main(): void {
  const { runId, repository } = parseArguments(process.argv.slice(2))
  const run = jsonCommand([
    'run',
    'view',
    runId,
    '--repo',
    repository,
    '--exit-status',
    '--json',
    [
      'attempt',
      'conclusion',
      'createdAt',
      'databaseId',
      'event',
      'headBranch',
      'headSha',
      'jobs',
      'status',
      'updatedAt',
      'url',
      'workflowName'
    ].join(',')
  ]) as Record<string, unknown>
  if (run.databaseId !== Number(runId)) {
    throw new Error('GitHub platform run identity differs from the requested run')
  }
  const apiRun = jsonCommand([
    'api',
    `repos/${repository}/actions/runs/${runId}`
  ]) as WorkflowRunMetadata
  if (
    apiRun.id !== Number(runId) ||
    !Number.isSafeInteger(apiRun.workflow_id) ||
    apiRun.workflow_id <= 0 ||
    apiRun.path !== '.github/workflows/document-core-platform.yml' ||
    apiRun.run_attempt !== run.attempt ||
    apiRun.status !== run.status ||
    apiRun.conclusion !== run.conclusion ||
    apiRun.event !== run.event ||
    apiRun.head_branch !== run.headBranch ||
    apiRun.head_sha !== run.headSha ||
    apiRun.html_url !== run.url
  ) {
    throw new Error('GitHub platform run does not use the exact workflow path and identity')
  }
  const tag = jsonCommand([
    'api',
    `repos/${repository}/git/ref/tags/${apiRun.head_branch}`
  ]) as GitRefMetadata
  if (
    tag.ref !== `refs/tags/${apiRun.head_branch}` ||
    tag.object.type !== 'commit' ||
    tag.object.sha !== apiRun.head_sha
  ) {
    throw new Error('GitHub platform run is not bound to an exact lightweight candidate tag')
  }
  const evidencedRun = Object.freeze({
    ...run,
    refType: 'tag',
    workflowDatabaseId: apiRun.workflow_id,
    workflowPath: apiRun.path
  })
  const listing = jsonCommand([
    'api',
    `repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`
  ]) as { readonly artifacts?: readonly ArtifactMetadata[] }
  if (!Array.isArray(listing.artifacts)) {
    throw new Error('GitHub artifact listing is malformed')
  }
  const expectedPrefix = 'document-core-platform-'
  const platformArtifacts = listing.artifacts.filter(
    (artifact) => artifact.name.startsWith(expectedPrefix) && !artifact.expired
  )
  const directory = mkdtempSync(resolve(tmpdir(), 'marktext-0009-platform-run-'))
  try {
    const attestations = platformArtifacts.map((artifact) => {
      if (
        !Number.isSafeInteger(artifact.id) ||
        artifact.id <= 0 ||
        !/^sha256:[0-9a-f]{64}$/u.test(artifact.digest)
      ) {
        throw new Error(`GitHub artifact metadata is invalid: ${artifact.name}`)
      }
      const artifactRoot = resolve(directory, String(artifact.id))
      execFileSync('gh', [
        'run',
        'download',
        runId,
        '--repo',
        repository,
        '--name',
        artifact.name,
        '--dir',
        artifactRoot
      ])
      const jsonFiles = filesUnder(artifactRoot).filter((path) => path.endsWith('.json'))
      if (jsonFiles.length !== 1) {
        throw new Error(`Platform artifact must contain exactly one JSON file: ${artifact.name}`)
      }
      const path = jsonFiles[0]
      if (path === undefined || !statSync(path).isFile()) {
        throw new Error(`Platform artifact JSON is missing: ${artifact.name}`)
      }
      return Object.freeze({
        artifactId: artifact.id,
        artifactName: artifact.name,
        artifactDigest: artifact.digest,
        fileName: basename(path),
        contentBase64: readFileSync(path).toString('base64')
      })
    })
    process.stdout.write(
      JSON.stringify(
        {
          schema: 'marktext-0009-github-run-evidence-v1',
          run: evidencedRun,
          attestations
        },
        null,
        2
      ) + '\n'
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

try {
  main()
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
