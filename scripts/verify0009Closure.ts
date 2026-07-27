import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  create0009VerifiedClosure,
  validate0009CandidateEvidence,
  write0009CiClosureAttestation
} from '../packages/document-core/test/plan/0009-evidence-collector.js'

function publicationRun(arguments_: readonly string[]): string {
  const normalized =
    arguments_.length === 4 && arguments_[1] === '--'
      ? [arguments_[0], arguments_[2], arguments_[3]]
      : arguments_
  if (
    normalized.length !== 3 ||
    normalized[0] !== '--commit' ||
    normalized[1] !== '--publication-run' ||
    normalized[2] === undefined ||
    !/^[1-9]\d*$/u.test(normalized[2])
  ) {
    throw new Error('--commit requires exactly --publication-run <numeric-run-id>')
  }
  return normalized[2]
}

async function main(): Promise<void> {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const arguments_ = process.argv.slice(2)
  if (arguments_.length === 1 && arguments_[0] === '--validate-candidate') {
    const validated = validate0009CandidateEvidence({ repoRoot })
    console.log(
      `Plan 0009 candidate evidence verified for ${validated.bundle.candidateCommit}: ` +
        validated.evidenceSha256
    )
    return
  }
  if (arguments_.length === 1 && arguments_[0] === '--ci') {
    const attestation = await write0009CiClosureAttestation({ repoRoot })
    console.log(
      `Plan 0009 CI closure verified for ${attestation.closureCommit}: ` +
        'specs/migration/0009-closure-attestation.yml'
    )
    return
  }
  if (arguments_[0] === '--commit') {
    const attestation = await create0009VerifiedClosure({
      repoRoot,
      publicationRunId: publicationRun(arguments_)
    })
    console.log(
      `Plan 0009 closure committed as ${attestation.closureCommit}: ` +
        'specs/migration/0009-closure-attestation.yml'
    )
    return
  }
  throw new Error(
    'Plan 0009 verification requires --validate-candidate, --ci, or ' +
      '--commit --publication-run <numeric-run-id>'
  )
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
