import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus, release, tmpdir } from 'node:os'
import path from 'node:path'
import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithDoc,
  sendIpcToRenderer
} from './helpers'
import {
  expectDefaultCoreAuthority,
  expectInstalledArtifactCommit
} from './installedArtifactProvenance'

const repo = path.resolve(__dirname, '../../../..')
const plain = 'Writing a useful document takes careful editing and a clear view of the text.'
const dense =
  'Review {++new evidence++} alongside {--obsolete details--}, {~~old wording~>better wording~~}, and {==a claim==}{>>Check this source.<<}.'
const workloads = [
  { id: 'plain-80', paragraph: plain, count: 80 },
  { id: 'dense-criticmarkup-80', paragraph: dense, count: 80 },
  { id: 'plain-1000', paragraph: plain, count: 1000 }
]

test.describe('cold native document opening', () => {
  test.skip(
    process.env.MARKTEXT_COLD_PERFORMANCE !== '1',
    'Opt in to the 15 fresh-process observations.'
  )
  for (const document of workloads) {
    for (let observation = 1; observation <= 5; observation += 1) {
      test(`${document.id} observation ${observation}`, async() => {
        const scratch = mkdtempSync(path.join(tmpdir(), 'marktext-cold-open-'))
        const filePath = path.join(scratch, 'note.md')
        const source =
          [
            'Cold editing paragraph.',
            ...Array.from({ length: document.count }, () => document.paragraph)
          ].join('\n\n') + '\n'
        writeFileSync(filePath, source, { flag: 'wx' })
        const { app, page } = await launchWithDoc(filePath, {
          suppressErrorDialog: true,
          env: {
            MARKTEXT_DOCUMENT_CORE_MODE: undefined,
            MARKTEXT_DOCUMENT_CORE_SHADOW: undefined,
            MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined,
            MARKTEXT_E2E_HIDDEN_WINDOW: '1'
          }
        })
        try {
          await expectEditorWindowHidden(app)
          expectEditorNotFrontmost(app)
          await expectInstalledArtifactCommit(page)
          await expectDefaultCoreAuthority(page)
          await expect(
            page.locator('.mu-paragraph-content[contenteditable="true"]').first()
          ).toBeVisible()
          const diagnostics = await page.evaluate(async() => ({
            documentId: window.__marktextDocumentCore?.documentId,
            source: await window.__marktextDocumentCore?.authoritySource?.(),
            events: window.__marktextDocumentCore?.performanceEvents?.() ?? []
          }))
          expect(diagnostics.source).toBe(source)
          const { events } = diagnostics
          const opened = events.find(
            (event) => event.phase === 'open-request' && event.documentId === diagnostics.documentId
          )
          expect(opened, 'the fixture must have its own measured open').toBeDefined()
          if (opened === undefined) throw new Error('Fixture opening was not measured')
          const acknowledged = events.find(
            (event) => event.phase === 'open-ack' && event.documentId === opened.documentId
          )
          const editable = events.find(
            (event) =>
              event.phase === 'first-editable-viewport' &&
              event.documentId === opened.documentId &&
              event.surface === 'wysiwyg'
          )
          expect(acknowledged).toBeDefined()
          expect(editable).toBeDefined()
          if (acknowledged === undefined || editable === undefined) { throw new Error('Opening did not reach an editable viewport') }
          const artifact = await app.evaluate(({ app }) => {
            const fs = process.getBuiltinModule('node:fs')
            const paths = process.getBuiltinModule('node:path')
            const crypto = process.getBuiltinModule('node:crypto')
            const root = paths.join(app.getAppPath(), 'out')
            const files = fs
              .readdirSync(root, { recursive: true, withFileTypes: true })
              .filter((entry) => entry.isFile())
              .map((entry) => paths.join(entry.parentPath, entry.name))
              .sort()
            return {
              appRoot: app.getAppPath(),
              packaged: app.isPackaged,
              executable: process.execPath,
              executableSha256: crypto
                .createHash('sha256')
                .update(fs.readFileSync(process.execPath))
                .digest('hex'),
              compiledFiles: Object.fromEntries(
                files.map((filename) => [
                  paths.relative(root, filename),
                  crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex')
                ])
              )
            }
          })
          const measurement = {
            document: document.id,
            observation,
            sourceSha256: createHash('sha256').update(source).digest('hex'),
            head: execFileSync('git', ['rev-parse', 'HEAD'], {
              cwd: repo,
              encoding: 'utf8'
            }).trim(),
            artifact,
            hardware: { model: cpus()[0]?.model, logicalCpus: cpus().length, release: release() },
            openMs: acknowledged.at - opened.at,
            firstEditableViewportMs: editable.at - opened.at,
            events,
            limits: { openMs: 500, firstEditableViewportMs: 1500 },
            note: 'A fresh hidden process and profile per observation. Renderer document-open checkpoints, not whole-application startup, cold filesystem caches or physical paint.'
          }
          writeFileSync(
            path.join(scratch, 'measurement.json'),
            JSON.stringify(measurement, null, 2),
            { flag: 'wx' }
          )
          console.log(
            `[cold] ${document.id} ${observation}/5: open ${measurement.openMs} ms, editable ${measurement.firstEditableViewportMs} ms; ${scratch}`
          )
          await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
          await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
          expect(measurement.openMs).toBeGreaterThanOrEqual(0)
          expect(measurement.firstEditableViewportMs).toBeGreaterThanOrEqual(measurement.openMs)
          expect(measurement.openMs).toBeLessThanOrEqual(500)
          expect(measurement.firstEditableViewportMs).toBeLessThanOrEqual(1500)
          await expectNoRendererErrors(app)
          await expectEditorWindowHidden(app)
          expectEditorNotFrontmost(app)
        } finally {
          await app.close()
        }
      })
    }
  }
})
