import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assert0009EvidenceCollectorRuntime,
  collect0009Evidence,
  parse0009EvidenceArguments
} from '../packages/document-core/test/plan/0009-evidence-collector.js'

async function main(): Promise<void> {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  assert0009EvidenceCollectorRuntime(repoRoot)
  const githubRunIds = parse0009EvidenceArguments(process.argv.slice(2))
  const bundle = await collect0009Evidence({
    repoRoot,
    githubRunIds
  })
  console.log(
    `Plan 0009 candidate evidence collected for ${bundle.candidateCommit}: ` +
      'specs/migration/0009-candidate-evidence.yml'
  )
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
