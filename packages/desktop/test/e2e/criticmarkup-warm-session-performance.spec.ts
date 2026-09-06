import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { cpus, platform, release, tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  expectEditorNotFrontmost, expectEditorWindowHidden,
  expectNoRendererErrors, launchWithMarkdown, sendIpcToRenderer
} from './helpers'
import {
  readInputLatencyTrace, readInputLatencyTraceStatus,
  startInputLatencyTrace, waitForInputLatencyEcho
} from './helpers/inputLatencyTrace'
import type { CoreAuthorityPerformanceEvent } from '../../src/renderer/src/documentAuthority/coreAuthorityPerformanceTrace'
import { pairAppendedInputs } from './helpers/warmInputPairing'

const enabled = process.env.MARKTEXT_WARM_PERFORMANCE === '1'
const repo = path.resolve(__dirname, '../../../..')
const warmup = 8
const measured = Number(process.env.MARKTEXT_WARM_SAMPLES ?? 40)
const paragraphCount = Number(process.env.MARKTEXT_WARM_PARAGRAPHS ?? 80)
const interval = Number(process.env.MARKTEXT_WARM_INTERVAL_MS ?? 80)
const denseParagraph = 'Review {++new evidence++} alongside {--obsolete details--}, {~~old wording~>better wording~~}, and {==a claim==}{>>Check this source.<<}.'
const workloads: ReadonlyArray<{ name: string, paragraph: string, tracking: boolean, input?: string, media?: boolean }> = [
  { name: 'plain', paragraph: 'Writing a useful document takes careful editing and a clear view of the text.', tracking: false },
  { name: 'dense-criticmarkup-ordinary', paragraph: denseParagraph, tracking: false },
  { name: 'dense-criticmarkup', paragraph: denseParagraph, tracking: true },
  ...(process.env.MARKTEXT_WARM_EXTENDED === '1'
    ? [
      { name: 'unicode-tracked', paragraph: '日本語の編集、café, naïve, Ελληνικά, العربية, and 👩🏽‍💻. ' + denseParagraph, tracking: true, input: 'λ' },
      { name: 'mixed-blocks-tracked', paragraph: '## Section\n\n' + denseParagraph + '\n\n- List item\n- Another item\n\n```js\nconst value = 42\n```\n\n$$\nx^2 + y^2 = z^2\n$$', tracking: true }
    ]
    : []),
  ...(process.env.MARKTEXT_WARM_MEDIA === '1'
    ? [{
      name: 'mixed-media-tracked',
      tracking: true,
      media: true,
      paragraph: denseParagraph + '\n\n```mermaid\nflowchart LR\n A-->B\n```\n\n![Local image](' +
          pathToFileURL(path.join(repo, 'packages/desktop/static/logo-small.png')).href + ')\n\n$$\nx^2+y^2=z^2\n$$'
    }]
    : [])
]

const rendererBuildHashes = (): Record<string, string> => {
  const root = path.join(repo, 'packages/desktop/out/renderer')
  return Object.fromEntries(readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => path.join(entry.parentPath, entry.name))
    .sort()
    .map(filename => [path.relative(root, filename), createHash('sha256').update(readFileSync(filename)).digest('hex')]))
}

const distribution = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const percentile = (value: number): number | null => sorted.length === 0
    ? null
    : sorted[Math.max(0, Math.ceil(sorted.length * value) - 1)]
  return { count: values.length, p50: percentile(0.5), p95: percentile(0.95), maximum: sorted.at(-1) ?? null }
}

test.describe('warm native-keyboard performance', () => {
  test.skip(!enabled, 'Opt in with MARKTEXT_WARM_PERFORMANCE=1 to measure sustained native input.')
  for (const workload of workloads) {
    test(workload.name, async() => {
      test.setTimeout(Math.max(180_000, measured * (interval + 150)))
      const scratch = mkdtempSync(path.join(tmpdir(), `marktext-warm-${workload.name}-`))
      const character = workload.input ?? 'x'
      const source = ['Warm editing paragraph.', ...Array.from({ length: paragraphCount }, () => workload.paragraph)].join('\n\n') + '\n'
      const metadata = {
        startedAt: new Date().toISOString(),
        workload: workload.name,
        sourceUnits: source.length,
        repeatedSections: paragraphCount,
        inputText: character,
        sourceSha256: createHash('sha256').update(source).digest('hex'),
        head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
        mainBuildSha256: createHash('sha256').update(readFileSync(path.join(repo, 'packages/desktop/out/main/index.js'))).digest('hex'),
        rendererBuildHashes: rendererBuildHashes(),
        hardware: { model: cpus()[0]?.model, logicalCpus: cpus().length, platform: platform(), release: release() },
        warmup,
        measured,
        intervalMs: interval,
        tracking: workload.tracking,
        rendererCpuProfiling: process.env.MARKTEXT_WARM_PROFILE === '1',
        retainedHeapCheck: process.env.MARKTEXT_WARM_HEAP === '1',
        limits: 'One warm app per workload; browser beforeinput to exact DOM echo, not physical input or compositor paint. Native Playwright keyboard through Chromium; hidden unfocused window. Concurrent machine work is uncontrolled. Reconcile corrected is a code-path flag, not a measured visual correction.'
      }
      writeFileSync(path.join(scratch, 'metadata.json'), JSON.stringify(metadata, null, 2), { flag: 'wx' })
      console.log(`[warm] ${workload.name}: launching one process for ${warmup + measured} keys; output ${scratch}`)
      const { app, page, filePath } = await launchWithMarkdown(source, {
        suppressErrorDialog: true,
        env: {
          MARKTEXT_DOCUMENT_CORE_MODE: undefined,
          MARKTEXT_DOCUMENT_CORE_SHADOW: undefined,
          MARKTEXT_E2E_HIDDEN_WINDOW: '1',
          MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined
        }
      })
      const runtimeEvents: Array<{ kind: string, detail?: unknown }> = []
      app.process().once('exit', (code, signal) => {
        runtimeEvents.push({ kind: 'process-exit', detail: { code, signal } })
        writeFileSync(path.join(scratch, 'process-exit.json'), JSON.stringify(runtimeEvents, null, 2), { flag: 'wx' })
      })
      page.on('crash', () => { runtimeEvents.push({ kind: 'renderer-crash' }) })
      page.on('pageerror', error => { runtimeEvents.push({ kind: 'page-error', detail: String(error) }) })
      page.on('console', message => {
        if (message.type() === 'error' && runtimeEvents.length < 128) {
          runtimeEvents.push({ kind: 'console-error', detail: message.text() })
        }
      })
      await app.evaluate(({ app }) => {
        app.on('render-process-gone', (_event, _contents, details) => {
          console.error('[warm-runtime] renderer exit', JSON.stringify(details))
        })
        app.on('before-quit', () => { console.error('[warm-runtime] before quit') })
      })
      try {
        await expectEditorWindowHidden(app)
        expectEditorNotFrontmost(app)
        const paragraph = page.locator('span.mu-paragraph-content').first()
        await expect(paragraph).toHaveAttribute('contenteditable', 'true')
        if (workload.media) {
          await expect(page.locator('.mu-diagram-preview svg')).toHaveCount(paragraphCount, { timeout: 60_000 })
          await expect.poll(() => page.locator('.editor-component img').evaluateAll(images =>
            images.filter(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0).length
          ), { timeout: 60_000 }).toBe(paragraphCount)
        }
        if (workload.tracking) {
          const tracking = page.getByTestId('critic-review-track-changes')
          await tracking.click()
          await expect(tracking).toHaveAttribute('aria-pressed', 'true')
        }
        await paragraph.click()
        await page.keyboard.press('End')
        await page.evaluate(() => window.__marktextDocumentCore?.settled())
        for (let index = 0; index < warmup; index += 1) {
          await page.keyboard.type(character, { delay: 0 })
          await page.waitForTimeout(interval)
        }
        await page.evaluate(() => window.__marktextDocumentCore?.settled())
        console.log(`[warm] ${workload.name}: ${warmup} warmup keys acknowledged; measuring ${measured} sustained keys`)
        const memoryBefore = await app.evaluate(({ app }) => app.getAppMetrics().map(({ type, memory }) => ({ type, memory })))
        const heapSession = process.env.MARKTEXT_WARM_HEAP === '1'
          ? await page.context().newCDPSession(page)
          : undefined
        const retainedHeap = async() => {
          if (heapSession === undefined) return undefined
          await heapSession.send('HeapProfiler.collectGarbage')
          return heapSession.send('Runtime.getHeapUsage')
        }
        const retainedHeapBefore = await retainedHeap()
        const initialEvents = await page.evaluate(() => window.__marktextDocumentCore?.performanceEvents?.() ?? [])
        const initialTransaction = Math.max(0, ...initialEvents.flatMap(event => 'transaction' in event ? [event.transaction] : []))
        await startInputLatencyTrace(page, { maxSamples: measured })
        const profiler = process.env.MARKTEXT_WARM_PROFILE === '1'
          ? await page.context().newCDPSession(page)
          : undefined
        if (profiler !== undefined) {
          await profiler.send('Profiler.enable')
          await profiler.send('Profiler.start')
        }
        for (let index = 0; index < measured; index += 1) {
          await page.keyboard.type(character, { delay: 0 })
          // No authority/settled barrier between keys: backlog is part of the observation.
          await page.waitForTimeout(interval)
          if ((index + 1) % Math.max(8, Math.ceil(measured / 10)) === 0) console.log(`[warm] ${workload.name}: ${index + 1}/${measured} measured keys sent`)
        }
        await waitForInputLatencyEcho(page, measured, 30_000)
        await page.evaluate(() => window.__marktextDocumentCore?.settled())
        if (profiler !== undefined) {
          const { profile } = await profiler.send('Profiler.stop')
          writeFileSync(path.join(scratch, 'renderer.cpuprofile'), JSON.stringify(profile), { flag: 'wx' })
          await profiler.detach()
        }
        const input = await readInputLatencyTrace(page)
        const probeStatus = await readInputLatencyTraceStatus(page)
        const authority = await page.evaluate(() => ({
          events: window.__marktextDocumentCore?.performanceEvents?.() ?? [],
          status: window.__marktextDocumentCore?.performanceStatus?.(),
          state: window.__marktextDocumentCore?.latest()
        }))
        const byTransaction = new Map<number, Partial<Record<'dispatch' | 'ack' | 'reconcile', CoreAuthorityPerformanceEvent>>>()
        for (const event of authority.events) {
          if (!('transaction' in event) || event.transaction <= initialTransaction) continue
          const phases = byTransaction.get(event.transaction) ?? {}
          phases[event.phase] = event
          byTransaction.set(event.transaction, phases)
        }
        const transactions = [...byTransaction.entries()].sort(([a], [b]) => a - b)
        const pairing = pairAppendedInputs(input, transactions.flatMap(([, phases]) =>
          phases.dispatch?.phase === 'dispatch' ? [phases.dispatch] : []))
        const samples = input.map((sample, index) => {
          const transaction = pairing?.[index]
          const phases = transaction === undefined ? undefined : byTransaction.get(transaction)
          const relative = (phase: 'dispatch' | 'ack' | 'reconcile'): number | null =>
            phases?.[phase] === undefined ? null : phases[phase].at - sample.tEvent
          return {
            sequence: sample.sequence,
            transaction,
            echoMs: sample.tEcho === undefined ? null : sample.tEcho - sample.tEvent,
            dispatchMs: relative('dispatch'),
            ackMs: relative('ack'),
            reconcileMs: relative('reconcile'),
            pendingDepth: phases?.dispatch?.phase === 'dispatch' ? phases.dispatch.pendingDepth : null,
            correctedPath: phases?.reconcile?.phase === 'reconcile' ? phases.reconcile.corrected : null
          }
        })
        const stable = samples
        const metrics = Object.fromEntries(['echoMs', 'dispatchMs', 'ackMs', 'reconcileMs'].map(key => [key,
          distribution(stable.flatMap(sample => {
            const value = sample[key as 'echoMs' | 'dispatchMs' | 'ackMs' | 'reconcileMs']
            return value === null ? [] : [value]
          }))
        ]))
        const inserted = character.repeat(warmup + measured)
        const expectedSource = source.replace('Warm editing paragraph.',
          'Warm editing paragraph.' + (workload.tracking ? `{++${inserted}++}` : inserted))
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(expectedSource)
        const summary = {
          metrics,
          maximumPendingDepth: Math.max(0, ...stable.flatMap(sample => sample.pendingDepth === null ? [] : [sample.pendingDepth])),
          pairingValid: pairing !== undefined,
          transactionCount: transactions.length,
          inputCount: input.length,
          finalText: await paragraph.textContent(),
          processMemory: {
            before: memoryBefore,
            after: await app.evaluate(({ app }) => app.getAppMetrics().map(({ type, memory }) => ({ type, memory }))),
            note: 'Electron process working-set observations, not retained heap size.'
          },
          retainedRendererHeap: heapSession === undefined
            ? undefined
            : {
              before: retainedHeapBefore,
              after: await retainedHeap(),
              note: 'Chromium renderer heap after explicit garbage collection outside the timed input loop; includes editor undo history and bounded diagnostic traces.'
            },
          savedSourceMatches: readFileSync(filePath, 'utf8') === expectedSource,
          savedSourceSha256: createHash('sha256').update(readFileSync(filePath)).digest('hex')
        }
        await heapSession?.detach()
        writeFileSync(path.join(scratch, 'raw.json'), JSON.stringify({ metadata, summary, samples, input, probeStatus, authority }, null, 2), { flag: 'wx' })
        console.log(`[warm] ${workload.name}: ${JSON.stringify(summary)}; raw ${path.join(scratch, 'raw.json')}`)
        expect(summary.pairingValid).toBe(true)
        expect(rendererBuildHashes()).toEqual(metadata.rendererBuildHashes)
        expect(summary.finalText).toBe('Warm editing paragraph.' + inserted)
        expect(stable.every(sample => sample.ackMs !== null && sample.reconcileMs !== null)).toBe(true)
        for (const [metric, target] of Object.entries({ echoMs: 16.7, dispatchMs: 8, ackMs: 50, reconcileMs: 50 })) {
          expect(metrics[metric].p95, `${metric} p95 target`).toBeLessThanOrEqual(target)
        }
        await expectNoRendererErrors(app)
        await expectEditorWindowHidden(app)
        expectEditorNotFrontmost(app)
      } catch (error) {
        const diagnostic = await page.evaluate(() => ({
          text: document.querySelector('span.mu-paragraph-content')?.textContent,
          generation: window.__marktextDocumentCore?.generation,
          latest: window.__marktextDocumentCore?.latest(),
          events: window.__marktextDocumentCore?.performanceEvents?.()
        })).catch(() => ({ unavailable: true }))
        writeFileSync(path.join(scratch, 'failure.json'), JSON.stringify({ error: String(error), runtimeEvents, diagnostic }, null, 2), { flag: 'wx' })
        throw error
      } finally {
        await app.close()
      }
    })
  }
})
