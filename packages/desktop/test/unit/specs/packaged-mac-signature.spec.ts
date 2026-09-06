// @vitest-environment node
import { createPackageWithOptions } from '@electron/asar'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { finished } from 'node:stream/promises'
import { expect, it } from 'vitest'
import { verifyPackagedApp } from '../../../../../scripts/verifyPackagedApp'

it.skipIf(process.platform !== 'darwin')('verifies signed native addons against the final bundle seal and rejects tampering', async() => {
  const root = mkdtempSync(join(tmpdir(), 'marktext-sealed-package-'))
  const bundle = join(root, 'fixture.app')
  const resources = join(bundle, 'Contents', 'Resources')
  const executable = join(bundle, 'Contents', 'MacOS', 'fixture')
  const source = join(root, 'source')
  const addon = 'node_modules/ced/build/Release/ced.node'
  mkdirSync(join(source, 'node_modules/ced/build/Release'), { recursive: true })
  mkdirSync(resources, { recursive: true })
  mkdirSync(join(bundle, 'Contents', 'MacOS'))
  const program = join(root, 'fixture.c')
  writeFileSync(program, 'int main(void) { return 0; }\n')
  execFileSync('/usr/bin/cc', [program, '-o', executable])
  execFileSync('/usr/bin/cc', ['-dynamiclib', program, '-o', join(source, addon)])
  writeFileSync(join(source, 'package.json'), JSON.stringify({ name: 'fixture', main: 'main.js', dependencies: { ced: '2.0.0' } }))
  writeFileSync(join(source, 'main.js'), 'module.exports = "fixture"')
  writeFileSync(join(bundle, 'Contents', 'Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>test.marktext.seal</string><key>CFBundleExecutable</key><string>fixture</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>')
  const archive = join(resources, 'app.asar')
  await finished(await createPackageWithOptions(source, archive, { unpack: '**/*.node' }))
  const signedAddon = join(archive + '.unpacked', addon)
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', 'test.marktext.addon', signedAddon], { stdio: 'pipe' })
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'pipe' })
  expect(() => verifyPackagedApp(executable)).not.toThrow()
  appendFileSync(signedAddon, 'tampered')
  expect(() => verifyPackagedApp(executable)).toThrow()
}, 15000)
