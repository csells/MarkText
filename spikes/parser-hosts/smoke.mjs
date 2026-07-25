// Smoke: run both extended parsers over every tracked markdown file in the
// repo — crash/pathology check with the CriticMarkup extensions active.
// Usage: node smoke.mjs   (from spikes/parser-hosts)

import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { micromark } from 'micromark'
import { pairedParser } from './lezer-critic.js'
import { criticSyntax, criticHtml } from './micromark-critic.js'

const files = execSync('git -C ../.. ls-files "*.md"', { encoding: 'utf8' })
  .trim()
  .split('\n')

let count = 0
let bytes = 0
const totals = { lezer: 0, micromark: 0 }
const worst = { lezer: [0, ''], micromark: [0, ''] }

for (const file of files) {
  let doc
  try {
    doc = readFileSync('../../' + file, 'utf8')
  } catch {
    continue
  }
  count++
  bytes += doc.length

  let t = performance.now()
  pairedParser.parse(doc)
  const lz = performance.now() - t
  totals.lezer += lz
  if (lz > worst.lezer[0]) worst.lezer = [lz, file]

  t = performance.now()
  micromark(doc, { extensions: [criticSyntax], htmlExtensions: [criticHtml] })
  const mm = performance.now() - t
  totals.micromark += mm
  if (mm > worst.micromark[0]) worst.micromark = [mm, file]
}

console.log(`${count} files, ${(bytes / 1024).toFixed(0)}KB total`)
console.log(
  `lezer+CM:     total ${totals.lezer.toFixed(0)}ms, worst ${worst.lezer[0].toFixed(1)}ms (${worst.lezer[1]})`
)
console.log(
  `micromark+CM: total ${totals.micromark.toFixed(0)}ms, worst ${worst.micromark[0].toFixed(1)}ms (${worst.micromark[1]})`
)
