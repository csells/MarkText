#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PINNED_NODE_VERSION = 'v22.21.1'
const PINNED_COREPACK_VERSION = '0.34.0'
const PINNED_COREPACK_LAUNCHER_SHA256 =
  '3655bc798f300951f2070fee411b337d626b0c3ae80c2d24c46ccac4595d4bf9'
const PINNED_COREPACK_BUNDLE_SHA256 =
  'bafd892df44cd70740e23e5d43eeea934b4f261a9eaff3637dac29bdea74d829'
const PINNED_PNPM =
  'pnpm@10.33.4+sha512.1c67b3b359b2d408119ba1ed289f34b8fc3c6873412bec6fd264fbdc82489e510fcbecb9ce9d22dae7f3b76269d8441046014bdca53b9979cd7a561ad631b800'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDirectory, '..')
const nodeDirectory = dirname(process.execPath)
const corepackCliPath = resolve(
  nodeDirectory,
  process.platform === 'win32'
    ? 'node_modules/corepack/dist/corepack.js'
    : '../lib/node_modules/corepack/dist/corepack.js'
)
const corepackRoot = resolve(corepackCliPath, '../..')
const corepackBundlePath = resolve(corepackRoot, 'dist/lib/corepack.cjs')
const corepackManifestPath = resolve(corepackRoot, 'package.json')

function sha256 (path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function requireIdentityEnvironment (name, expected) {
  if (process.env[name] !== expected) {
    throw new Error(`Pinned Corepack identity attestation differs: ${name}`)
  }
}

function verifyCorepackIdentity () {
  if (process.version !== PINNED_NODE_VERSION) {
    throw new Error(`Pinned Corepack requires Node ${PINNED_NODE_VERSION}`)
  }
  const manifest = JSON.parse(readFileSync(corepackManifestPath, 'utf8'))
  if (
    manifest.version !== PINNED_COREPACK_VERSION ||
    sha256(corepackCliPath) !== PINNED_COREPACK_LAUNCHER_SHA256 ||
    sha256(corepackBundlePath) !== PINNED_COREPACK_BUNDLE_SHA256
  ) {
    throw new Error('Corepack executable bytes differ from the pinned Node distribution')
  }
  requireIdentityEnvironment('MARKTEXT_COREPACK_CLI_PATH', corepackCliPath)
  requireIdentityEnvironment('MARKTEXT_COREPACK_VERSION', PINNED_COREPACK_VERSION)
  requireIdentityEnvironment(
    'MARKTEXT_COREPACK_LAUNCHER_SHA256',
    PINNED_COREPACK_LAUNCHER_SHA256
  )
  requireIdentityEnvironment('MARKTEXT_COREPACK_BUNDLE_SHA256', PINNED_COREPACK_BUNDLE_SHA256)
}

async function run () {
  verifyCorepackIdentity()
  const arguments_ = process.argv.slice(2)
  if (arguments_[0] !== PINNED_PNPM) {
    throw new Error('Pinned Corepack must execute the committed pnpm package identity')
  }

  const corepackHome = resolve(repoRoot, 'node_modules/.cache/corepack')
  mkdirSync(corepackHome, { recursive: true, mode: 0o700 })
  const environment = {
    ...process.env,
    COREPACK_DEFAULT_TO_LATEST: '0',
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    COREPACK_ENABLE_PROJECT_SPEC: '1',
    COREPACK_ENABLE_STRICT: '1',
    COREPACK_HOME: corepackHome
  }
  delete environment.COREPACK_NPM_REGISTRY
  delete environment.COREPACK_NPM_TOKEN
  delete environment.COREPACK_NPM_USERNAME
  delete environment.COREPACK_NPM_PASSWORD

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [corepackCliPath, ...arguments_], {
      cwd: process.cwd(),
      env: environment,
      shell: false,
      stdio: 'inherit'
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0 && signal === null) resolve()
      else reject(new Error(`Pinned Corepack failed with code ${String(code)}`))
    })
  })
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
