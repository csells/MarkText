// @vitest-environment node
import { createPackage } from '@electron/asar'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { finished } from 'node:stream/promises'
import { describe, expect, it } from 'vitest'
import { verifyPackagedApp } from '../../../../../scripts/verifyPackagedApp'

const packageFixture = async(manifest: string, files: Readonly<Record<string, string>> = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'marktext-package-preflight-'))
  const source = join(root, 'source')
  const resources = join(root, 'resources')
  mkdirSync(source)
  mkdirSync(resources)
  writeFileSync(join(source, 'package.json'), manifest)
  writeFileSync(join(source, 'main.js'), 'module.exports = "fixture"')
  writeFileSync(join(source, 'dependency.js'), 'module.exports = "original dependency"')
  for (const [relative, contents] of Object.entries(files)) {
    const filename = join(source, relative)
    mkdirSync(dirname(filename), { recursive: true })
    writeFileSync(filename, contents)
  }
  const archive = join(resources, 'app.asar')
  await finished(await createPackage(source, archive))
  return { archive, executable: join(root, 'marktext') }
}

describe('packaged app preflight', () => {
  it('rejects an unreadable application manifest before Electron can open a dialog', async() => {
    const fixture = await packageFixture('.0", malformed manifest')
    expect(() => verifyPackagedApp(fixture.executable)).toThrow(/package.json/)
  })

  it('rejects corrupted dependencies even when the manifest and main entry still parse', async() => {
    const fixture = await packageFixture('{"name":"marktext","main":"main.js"}')
    const bytes = readFileSync(fixture.archive)
    const offset = bytes.indexOf('original dependency')
    expect(offset).toBeGreaterThan(0)
    bytes[offset] = '!'.charCodeAt(0)
    writeFileSync(fixture.archive, bytes)
    expect(() => verifyPackagedApp(fixture.executable)).toThrow(/integrity.*dependency.js/i)
  })

  it('rejects a manifest whose main entry is missing', async() => {
    const fixture = await packageFixture('{"name":"marktext","main":"missing.js"}')
    expect(() => verifyPackagedApp(fixture.executable)).toThrow(/main entry/i)
  })

  it('rejects an encoding addon missing from the path its production loader requires', async() => {
    const fixture = await packageFixture('{"name":"marktext","main":"main.js","dependencies":{"ced":"2.0.0"}}', {
      'node_modules/ced/bin/linux-arm64-146/ced.node': 'addon at an unusable path'
    })
    expect(() => verifyPackagedApp(fixture.executable)).toThrow(/ced.*build.*Release/i)
  })

  it('accepts the required encoding addon at its loader path', async() => {
    const fixture = await packageFixture('{"name":"marktext","main":"main.js","dependencies":{"ced":"2.0.0"}}', {
      'node_modules/ced/build/Release/ced.node': 'fixture addon bytes'
    })
    expect(() => verifyPackagedApp(fixture.executable)).not.toThrow()
  })

  it('accepts an intact application', async() => {
    const fixture = await packageFixture('{"name":"marktext","main":"main.js"}')
    expect(() => verifyPackagedApp(fixture.executable)).not.toThrow()
  })

  it.each(['./out/main/index.js', '.\\out\\main\\index.js'])('resolves a nested main entry with portable separators: %s', async main => {
    const fixture = await packageFixture(JSON.stringify({ name: 'marktext', main }), {
      'out/main/index.js': 'module.exports = "nested main"'
    })
    expect(() => verifyPackagedApp(fixture.executable)).not.toThrow()
  })
})
