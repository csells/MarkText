import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

interface CorpusReference {
  readonly id: string
  readonly authority: string
  readonly version: string
  readonly path: string
}

interface ExtensionReference {
  readonly id: string
  readonly version: string
  readonly path: string
  readonly constructs: readonly string[]
}

interface ProfileCorpusManifest {
  readonly schema: string
  readonly profile: {
    readonly markdownProfile: string
    readonly criticMarkupProfile: string
    readonly commonMark: string
    readonly manifest: string
  }
  readonly corpora: readonly CorpusReference[]
  readonly extensions: readonly ExtensionReference[]
}

interface CorpusCase {
  readonly id: string
  readonly source: string
}

interface CorpusArtifact {
  readonly schema: string
  readonly id: string
  readonly authority: string
  readonly version: string
  readonly cases: readonly CorpusCase[]
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const MANIFEST_PATH = resolve(REPO_ROOT, 'specs/migration/profile1-corpora.yml')

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function expectNoDisabledRows(path: string): void {
  const source = readFileSync(path, 'utf8')
  expect(source).not.toMatch(/"(?:skip|xfail|pending|retry)"\s*:/)
}

describe('Profile 1 corpus ownership contract', () => {
  it('validates separate standard profile and recovery corpora', () => {
    const manifest = readJson<ProfileCorpusManifest>(MANIFEST_PATH)

    expect(manifest.schema).toBe('marktext-profile1-corpora-v1')
    expect(manifest.profile).toEqual({
      markdownProfile: 'markdown-profile-1',
      criticMarkupProfile: 'marktext-profile-1',
      commonMark: '0.31.2',
      manifest: 'specs/migration/markdown-profile-1.yml'
    })
    const profilePath = resolve(REPO_ROOT, manifest.profile.manifest)
    expectNoDisabledRows(profilePath)
    const profile = readJson<{
      readonly schema: string
      readonly id: string
      readonly criticMarkupProfile: string
      readonly commonMark: string
      readonly gfm: {
        readonly version: string
        readonly constructs: readonly string[]
      }
      readonly fixedMarkdownOptions: Readonly<Record<string, boolean>>
      readonly markdownOptions: {
        readonly schema: string
        readonly fields: readonly string[]
        readonly desktopDefaults: Readonly<Record<string, boolean>>
      }
      readonly liveHtmlSafetyProfiles: readonly string[]
    }>(profilePath)
    expect(profile).toEqual({
      schema: 'marktext-markdown-profile-manifest-v1',
      id: 'markdown-profile-1',
      criticMarkupProfile: 'marktext-profile-1',
      commonMark: '0.31.2',
      gfm: {
        version: '0.29-gfm',
        constructs: [
          'tables',
          'task-list-items',
          'strikethrough',
          'extended-autolinks',
          'tagfilter'
        ]
      },
      fixedMarkdownOptions: {
        breaks: false,
        pedantic: false
      },
      markdownOptions: {
        schema: 'markdown-options-1',
        fields: [
          'gfm',
          'frontMatter',
          'math',
          'gitLabMath',
          'footnotes',
          'subscriptAndSuperscript'
        ],
        desktopDefaults: {
          gfm: true,
          frontMatter: true,
          math: true,
          gitLabMath: false,
          footnotes: false,
          subscriptAndSuperscript: true
        }
      },
      liveHtmlSafetyProfiles: ['live-html-sanitized-v1', 'live-html-escaped-v1']
    })
    expect(manifest.corpora).toEqual([
      {
        id: 'CM_STANDARD',
        authority: 'canonical-criticmarkup',
        version: 'cm-standard-corpus-1',
        path: 'specs/migration/cm-standard.yml'
      },
      {
        id: 'PROFILE1_RULINGS',
        authority: 'marktext-profile-1',
        version: 'profile1-rulings-corpus-1',
        path: 'specs/migration/profile1-rulings.yml'
      },
      {
        id: 'MALFORMED_RECOVERY',
        authority: 'marktext-profile-1-recovery',
        version: 'malformed-recovery-corpus-1',
        path: 'specs/migration/malformed-recovery.yml'
      },
      {
        id: 'PROFILE1_ADVERSARIAL',
        authority: 'marktext-profile-1',
        version: 'profile1-adversarial-corpus-1',
        path: 'specs/migration/profile1-adversarial.yml'
      }
    ])

    const caseIds = new Set<string>()
    for (const reference of manifest.corpora) {
      const absolutePath = resolve(REPO_ROOT, reference.path)
      expect(existsSync(absolutePath), `${reference.path} must exist`).toBe(true)
      expectNoDisabledRows(absolutePath)
      const artifact = readJson<CorpusArtifact>(absolutePath)
      expect(artifact.schema).toBe('marktext-language-corpus-v1')
      expect(artifact.id).toBe(reference.id)
      expect(artifact.authority).toBe(reference.authority)
      expect(artifact.version).toBe(reference.version)
      expect(artifact.cases.length).toBeGreaterThan(0)
      for (const row of artifact.cases) {
        expect(row.id).toMatch(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/)
        expect(row.source).toBeTypeOf('string')
        expect(caseIds.has(row.id), `duplicate case ID ${row.id}`).toBe(false)
        caseIds.add(row.id)
      }
    }
  })

  it('pins the complete GFM and MarkText built-in extension sets', () => {
    const manifest = readJson<ProfileCorpusManifest>(MANIFEST_PATH)

    expect(manifest.extensions).toEqual([
      {
        id: 'GFM',
        version: '0.29-gfm',
        path: 'packages/document-core/test/fixtures/gfm-profile1-0.29.json',
        constructs: [
          'tables',
          'task-list-items',
          'strikethrough',
          'extended-autolinks',
          'tagfilter'
        ]
      },
      {
        id: 'MARKTEXT_BUILTINS',
        version: 'marktext-builtins-1',
        path: 'packages/document-core/test/fixtures/marktext-builtins-1.json',
        constructs: [
          'table-of-contents-marker',
          'yaml-front-matter',
          'inline-math',
          'math-blocks',
          'diagram-blocks',
          'footnotes'
        ]
      }
    ])
    for (const reference of manifest.extensions) {
      const absolutePath = resolve(REPO_ROOT, reference.path)
      expect(existsSync(absolutePath), `${reference.path} must exist`).toBe(true)
      expectNoDisabledRows(absolutePath)
      const fixture = readJson<{
        readonly schema: string
        readonly id: string
        readonly version: string
        readonly cases: readonly (CorpusCase & {
          readonly example?: number
        })[]
      }>(absolutePath)
      expect(fixture.schema).toBe('marktext-extension-corpus-v1')
      expect(fixture.id).toBe(reference.id)
      expect(fixture.version).toBe(reference.version)
      expect(fixture.cases.map((row) => row.id)).toHaveLength(
        new Set(fixture.cases.map((row) => row.id)).size
      )
      expect(fixture.cases.length).toBeGreaterThanOrEqual(reference.constructs.length)
      if (reference.id === 'GFM') {
        expect(fixture.cases.map((row) => row.example)).toEqual([
          198, 199, 200, 201, 202, 203, 204, 205,
          279, 280,
          491, 492,
          621, 622, 623, 624, 625, 626, 627, 628, 629, 630, 631,
          652
        ])
      }
    }
  })

  it('pins the target-owned adversarial cases and scale families', () => {
    const manifest = readJson<ProfileCorpusManifest>(MANIFEST_PATH)
    const reference = manifest.corpora.find(
      candidate => candidate.id === 'PROFILE1_ADVERSARIAL'
    )
    if (reference === undefined) {
      throw new Error('Missing Profile 1 adversarial corpus')
    }
    const absolutePath = resolve(REPO_ROOT, reference.path)
    expect(existsSync(absolutePath), reference.path).toBe(true)
    expectNoDisabledRows(absolutePath)
    const artifact = readJson<{
      readonly schema: string
      readonly cases: readonly CorpusCase[]
      readonly scaleFamilies: readonly { readonly id: string }[]
    }>(absolutePath)
    expect(artifact.schema).toBe('marktext-language-corpus-v1')
    expect(artifact.cases).toHaveLength(46)
    expect(artifact.scaleFamilies).toHaveLength(7)
    expect(new Set(artifact.cases.map((row) => row.id)).size).toBe(46)
    expect(new Set(artifact.scaleFamilies.map((row) => row.id)).size).toBe(7)
  })
})
