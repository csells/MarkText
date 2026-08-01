// Bind the exact official Node distribution on a hosted runner. The
// toolcache repackages Node and its bytes have diverged from nodejs.org
// (the Windows Corepack byte check caught it), so the archive is fetched
// from the official host, verified against these committed pins, and its
// bin directory prepended to the job PATH. The ambient runtime only
// bootstraps this pinned fetch.
import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { get } from 'node:https'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

const VERSION = 'v22.21.1'
const PINS = Object.freeze({
  'darwin-arm64': Object.freeze({
    archive: `node-${VERSION}-darwin-arm64.tar.gz`,
    sha256: 'c170d6554fba83d41d25a76cdbad85487c077e51fa73519e41ac885aa429d8af'
  }),
  'linux-x64': Object.freeze({
    archive: `node-${VERSION}-linux-x64.tar.gz`,
    sha256: '219a152ea859861d75adea578bdec3dce8143853c13c5187f40c40e77b0143b2'
  }),
  'win32-x64': Object.freeze({
    archive: `node-${VERSION}-win-x64.zip`,
    sha256: '3c624e9fbe07e3217552ec52a0f84e2bdc2e6ffa7348f3fdfb9fbf8f42e23fcf'
  })
})

function fail (message) {
  console.error(`bind-official-node: ${message}`)
  process.exit(1)
}

const pin = PINS[`${process.platform}-${process.arch}`]
if (pin === undefined) fail(`unpinned platform ${process.platform}-${process.arch}`)
const temporary = process.env.RUNNER_TEMP
if (!temporary) fail('RUNNER_TEMP is required')

const archivePath = path.join(temporary, pin.archive)
const url = `https://nodejs.org/dist/${VERSION}/${pin.archive}`

function download (target, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    get(target, (response) => {
      if (
        response.statusCode !== undefined &&
        response.statusCode >= 300 && response.statusCode < 400 &&
        response.headers.location && redirectsLeft > 0
      ) {
        response.resume()
        resolve(download(response.headers.location, redirectsLeft - 1))
        return
      }
      if (response.statusCode !== 200) {
        reject(new Error(`download failed with status ${response.statusCode}`))
        return
      }
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve(Buffer.concat(chunks)))
      response.on('error', reject)
    }).on('error', reject)
  })
}

const bytes = await download(url)
const actual = createHash('sha256').update(bytes).digest('hex')
if (actual !== pin.sha256) {
  fail(`archive ${pin.archive} hashed ${actual}, pinned ${pin.sha256}`)
}
writeFileSync(archivePath, bytes)

const distribution = path.join(temporary, 'marktext-node')
mkdirSync(distribution, { recursive: true })
// bsdtar on Windows parses a drive-letter path as a remote host, so the
// archive and target stay relative to an explicit working directory.
// Git Bash puts GNU tar first on the Windows PATH and it cannot read
// zip archives; System32 ships bsdtar, which can.
const tarBinary = process.platform === 'win32'
  ? 'C:\\Windows\\System32\\tar.exe'
  : 'tar'
const extract = spawnSync(
  tarBinary,
  ['-xf', pin.archive, '-C', 'marktext-node'],
  { cwd: temporary, encoding: 'utf8' }
)
if (extract.status !== 0) fail(`extraction failed: ${extract.stderr}`)

const root = path.join(
  distribution,
  pin.archive.replace(/\.(?:tar\.gz|zip)$/u, '')
)
const bin = process.platform === 'win32' ? root : path.join(root, 'bin')
const githubPath = process.env.GITHUB_PATH
if (!githubPath) fail('GITHUB_PATH is required')
appendFileSync(githubPath, `${bin}\n`)

const manifest = JSON.parse(readFileSync(
  path.join(
    root,
    process.platform === 'win32'
      ? 'node_modules/corepack/package.json'
      : 'lib/node_modules/corepack/package.json'
  ),
  'utf8'
))
// The first execution of a freshly downloaded binary pays the platform's
// one-time signature assessment; paying it here keeps it out of any
// test's spawn timeout and proves the binary executes at all.
const nodeBinary = path.join(bin, process.platform === 'win32' ? 'node.exe' : 'node')
const warm = spawnSync(nodeBinary, ['--version'], { encoding: 'utf8' })
if (warm.status !== 0 || !warm.stdout.includes(VERSION)) {
  fail(`bound runtime failed its warm-up: ${warm.stderr || warm.stdout}`)
}
console.log(
  `bind-official-node: bound Node ${VERSION} with Corepack ${manifest.version}`
)
