import * as fs from 'node:fs'
import * as path from 'node:path'
import { LEGACY_MARKDOWN_LOG_ENV } from './helpers'

// Fails the run when any app launched in it reached Muya's legacy Markdown
// parser or serializer with a bound document, including apps a spec killed
// instead of closing.
export default async function globalTeardown(): Promise<void> {
  const log = process.env[LEGACY_MARKDOWN_LOG_ENV]
  if (!log || !fs.existsSync(log)) return
  const reaches = fs.readFileSync(log, 'utf-8')
  fs.rmSync(path.dirname(log), { recursive: true, force: true })
  if (reaches.trim().length > 0) {
    throw new Error(`A bound document reached Muya's legacy Markdown modules:\n\n${reaches}`)
  }
}
