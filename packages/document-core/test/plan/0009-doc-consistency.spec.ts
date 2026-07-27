import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')

function read(path: string): string {
  return readFileSync(resolve(REPO_ROOT, path), 'utf8')
}

describe('plan 0009 documentation consistency', () => {
  it('keeps product language architecture and non-goals consistent', () => {
    const plan = read('specs/plans/0009-criticmarkup-document-engine-rebuild.md')
    const language = read('specs/language/marktext-markdown-profile-1.md')
    const vision = read('specs/vision/criticmarkup-vision.md')
    const engineContext = read('packages/document-core/CONTEXT.md')
    const productContext = read('CONTEXT.md')
    const facts = read('specs/architecture/parser-core-verified-facts.md')
    const documents = [plan, language, vision, engineContext, productContext, facts]

    for (const document of documents) {
      expect(document).not.toMatch(/Comment(?: payload)? is (?:an )?opaque/i)
      expect(document).not.toMatch(
        /renderer (?:is|remains|becomes|must be) (?:the )?canonical/i
      )
      expect(document).not.toMatch(
        /save(?:s|d|ing)? (?:is|by|from|serializes?) (?:the )?(?:DOM|projected text)/i
      )
      expect(document).not.toMatch(/\blegacy\b/i)
      expect(document).not.toMatch(/backward.?compat/i)
      expect(document).not.toMatch(
        /(?:migration|projection|differential) oracle/i
      )
      expect(document).not.toMatch(/pre-rebuild|semantic parity/i)
      expect(document).not.toMatch(/engine flag|flagged path/i)
    }
    expect(language).toMatch(/isolated inline Profile 1 subdocument/i)
    expect(plan).toMatch(/external-file concurrent merge/i)
    expect(vision).toMatch(/portable|interoperab/i)
    expect(engineContext).toMatch(/canonical source/i)
    expect(facts).toMatch(/single|one parse/i)
  })
})
