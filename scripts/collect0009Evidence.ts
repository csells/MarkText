import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  collect0009Evidence,
  parse0009EvidenceArguments
} from '../packages/document-core/test/plan/0009-evidence-collector.js'

async function main(): Promise<void> {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const githubRunIds = parse0009EvidenceArguments(process.argv.slice(2))
  const bundle = await collect0009Evidence({
    repoRoot,
    githubRunIds
  })
  console.log(
    `Plan 0009 evidence verified for ${bundle.commit}: ` +
    'specs/migration/0009-final-evidence.yml'
  )
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
