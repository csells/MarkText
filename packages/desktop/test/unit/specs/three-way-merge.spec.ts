import { describe, expect, it } from 'vitest'
import {
  containsConflictScaffolding,
  mergeMarkdownThreeWay,
  resolveConflictMarker
} from '../../../src/renderer/src/util/threeWayMerge'

const metadata = (body: string): string =>
  `data:application/json;base64,${Buffer.from(JSON.stringify({
    version: 1,
    status: 'open',
    replies: [
      {
        author: 'Agent',
        createdAt: '2026-06-30T12:00:00.000Z',
        body
      }
    ]
  })).toString('base64')}`

describe('mergeMarkdownThreeWay', () => {
  it('auto-merges non-overlapping line changes', () => {
    const result = mergeMarkdownThreeWay({
      base: ['one\n', 'two\n', 'three\n'].join(''),
      local: ['one local\n', 'two\n', 'three\n'].join(''),
      remote: ['one\n', 'two\n', 'three remote\n'].join('')
    })

    expect(result.conflicts).toEqual([])
    expect(result.mergedMarkdown).toBe(['one local\n', 'two\n', 'three remote\n'].join(''))
  })

  it('emits conflict markers for overlapping line changes', () => {
    const result = mergeMarkdownThreeWay({
      base: 'one\nshared\nthree\n',
      local: 'one\nlocal\nthree\n',
      remote: 'one\nremote\nthree\n'
    })

    expect(result.conflicts).toHaveLength(1)
    expect(result.mergedMarkdown).toContain('<<<<<<< MARKTEXT_LOCAL c1')
    expect(result.mergedMarkdown).toContain('||||||| MARKTEXT_BASE c1')
    expect(result.mergedMarkdown).toContain('>>>>>>> MARKTEXT_REMOTE c1')
  })

  it('preserves CRLF line endings in generated conflict markers', () => {
    const result = mergeMarkdownThreeWay({
      base: 'one\r\nshared\r\nthree\r\n',
      local: 'one\r\nlocal\r\nthree\r\n',
      remote: 'one\r\nremote\r\nthree\r\n'
    })

    expect(result.conflicts).toHaveLength(1)
    expect(result.mergedMarkdown).toContain('<<<<<<< MARKTEXT_LOCAL c1\r\n')
    expect(result.mergedMarkdown).toContain('||||||| MARKTEXT_BASE c1\r\n')
    expect(result.mergedMarkdown).toContain('=======\r\n')
    expect(result.mergedMarkdown).toContain('>>>>>>> MARKTEXT_REMOTE c1\r\n')
    expect(result.mergedMarkdown).not.toMatch(/(?<!\r)\n/)
  })

  it('can resolve a generated conflict marker', () => {
    const result = mergeMarkdownThreeWay({
      base: 'one\nshared\nthree\n',
      local: 'one\nlocal\nthree\n',
      remote: 'one\nremote\nthree\n'
    })
    const [conflict] = result.conflicts

    expect(resolveConflictMarker(result.mergedMarkdown, conflict, 'remote')).toBe(
      'one\nremote\nthree\n'
    )
  })

  it('keeps Use Both conflict choices separated when neither side ends with a newline', () => {
    const result = mergeMarkdownThreeWay({
      base: 'shared',
      local: 'local',
      remote: 'remote'
    })
    const [conflict] = result.conflicts

    expect(resolveConflictMarker(result.mergedMarkdown, conflict, 'both')).toBe(
      'local\nremote'
    )
  })

  it('keeps Use Both conflict choices separated with the conflict line ending', () => {
    const result = mergeMarkdownThreeWay({
      base: 'one\r\nshared',
      local: 'one\r\nlocal',
      remote: 'one\r\nremote'
    })
    const [conflict] = result.conflicts

    expect(resolveConflictMarker(result.mergedMarkdown, conflict, 'both')).toBe(
      'one\r\nlocal\r\nremote'
    )
  })

  it('auto-merges non-overlapping prose and comment metadata edits without changing marker bytes', () => {
    const base = [
      'A <!--MC:a-->reviewed<!--MC:~a--> span.',
      '',
      `[MC:a]: ${metadata('Base note.')}`,
      ''
    ].join('\n')
    const local = base.replace(' span.', ' span with local edits.')
    const remote = base.replace(metadata('Base note.'), metadata('Agent note.'))

    const result = mergeMarkdownThreeWay({ base, local, remote })

    expect(result.conflicts).toEqual([])
    expect(result.mergedMarkdown).toContain('<!--MC:a-->reviewed<!--MC:~a-->')
    expect(result.mergedMarkdown).toContain('span with local edits.')
    expect(result.mergedMarkdown).toContain(`[MC:a]: ${metadata('Agent note.')}`)
  })

  // Byte-preservation invariants for the auto-merge (non-overlapping) path.
  // A silent external merge must not perturb encoding-significant bytes, or an
  // otherwise-clean agent edit would churn the file and could break comment
  // marker anchoring. Existing coverage only asserted CRLF inside conflict
  // markers, not through a clean auto-merge.
  it('preserves a leading UTF-8 BOM through a non-overlapping auto-merge', () => {
    const result = mergeMarkdownThreeWay({
      base: '﻿title\n\nbody\n',
      local: '﻿title\n\nbody\nlocal add\n',
      remote: '﻿title changed\n\nbody\n'
    })

    expect(result.conflicts).toEqual([])
    expect(result.mergedMarkdown).toBe('﻿title changed\n\nbody\nlocal add\n')
    expect(result.mergedMarkdown.startsWith('﻿')).toBe(true)
  })

  it('preserves a missing final newline through a non-overlapping auto-merge', () => {
    const result = mergeMarkdownThreeWay({
      base: 'line1\nline2',
      local: 'line1 edited\nline2',
      remote: 'line1\nline2 edited'
    })

    expect(result.conflicts).toEqual([])
    expect(result.mergedMarkdown).toBe('line1 edited\nline2 edited')
    expect(/\n$/.test(result.mergedMarkdown)).toBe(false)
  })

  it('preserves CRLF line endings through a non-overlapping auto-merge', () => {
    const result = mergeMarkdownThreeWay({
      base: 'a\r\nb\r\nc\r\n',
      local: 'A\r\nb\r\nc\r\n',
      remote: 'a\r\nb\r\nC\r\n'
    })

    expect(result.conflicts).toEqual([])
    expect(result.mergedMarkdown).toBe('A\r\nb\r\nC\r\n')
    expect(result.mergedMarkdown).not.toMatch(/(?<!\r)\n/)
  })

  // Repeated-line topologies where BOTH sides change how many times a line
  // occurs are genuinely ambiguous — line counts cannot tell an identical
  // insertion (git collapses) from an independent one (git sums), and the old
  // position-blind reconciliation guessed and silently corrupted. The safe
  // contract is now: escalate to a whole-file conflict that preserves BOTH
  // sides verbatim (the user resolves), never a silently mis-counted merge.
  // Each of these asserts the conflict carries both sides' distinguishing
  // content, so a reintroduced silent auto-merge (conflicts:[]) fails the test.
  it('escalates rather than silently reconciling a line both sides remove from a run', () => {
    const result = mergeMarkdownThreeWay({
      base: 'c\na\na\na\n',
      local: 'c\nA\na\na\n',
      remote: 'c\na\na\n'
    })

    expect(result.conflicts).toHaveLength(1)
    expect(result.mergedMarkdown).toContain('A\n')
    expect(result.mergedMarkdown).toContain('MARKTEXT_LOCAL')
    expect(result.mergedMarkdown).toContain('MARKTEXT_REMOTE')
  })

  it('escalates a local edit colliding with a disk de-duplication of a repeated item', () => {
    const result = mergeMarkdownThreeWay({
      base: '- apple\n- apple\n- apple\n',
      local: '- apple pie\n- apple\n- apple\n',
      remote: '- apple\n- apple\n'
    })

    expect(result.conflicts).toHaveLength(1)
    // Neither side's distinguishing content is lost.
    expect(result.mergedMarkdown).toContain('- apple pie')
    expect(result.mergedMarkdown).toContain('MARKTEXT_LOCAL')
    expect(result.mergedMarkdown).toContain('MARKTEXT_REMOTE')
  })

  it('escalates when a local deletion collides with a disk edit of a sibling repeated line', () => {
    const result = mergeMarkdownThreeWay({
      base: '- task\n- task\n- task\n',
      local: '- task\n- task\n',
      remote: '- task done\n- task\n- task\n'
    })

    expect(result.conflicts).toHaveLength(1)
    expect(result.mergedMarkdown).toContain('- task done')
    expect(result.mergedMarkdown).toContain('MARKTEXT_LOCAL')
    expect(result.mergedMarkdown).toContain('MARKTEXT_REMOTE')
  })

  // The exact code-fence corruption the previous round introduced: escalating
  // (a conflict) is safe; silently splicing a blank line into the fence is not.
  it('never silently splices a blank line into a code fence (escalates instead)', () => {
    const result = mergeMarkdownThreeWay({
      base: 'title\naaa\n```\ncode1\n\n\ncode2\n```\nzzz\n',
      local: 'title\n\naaa\n```\ncode1\n\n\ncode2\n```\nzzz\n',
      remote: 'title\n\naaa\n```\ncode1\n\n\ncode2\n```\n'
    })

    if (result.conflicts.length === 0) {
      // If ever auto-merged, the fenced body must be byte-identical.
      expect(result.mergedMarkdown).toContain('```\ncode1\n\n\ncode2\n```')
    } else {
      expect(result.conflicts).toHaveLength(1)
    }
  })

  // Both sides independently insert identical content: git sums, but line
  // counts can't prove it's independent vs identical, so we escalate rather
  // than risk dropping a copy.
  it('escalates concurrent identical insertions rather than guess a count', () => {
    const result = mergeMarkdownThreeWay({
      base: '- item\na\n- item\nc\n',
      local: '- item\na\na\n- item\nc\n',
      remote: 'a\na\n- item\nc\n'
    })

    expect(result.conflicts).toHaveLength(1)
    expect(result.mergedMarkdown).toContain('MARKTEXT_LOCAL')
    expect(result.mergedMarkdown).toContain('MARKTEXT_REMOTE')
  })

  // Finding 2 (CRITICAL): resolveConflictMarker used String.replace, whose
  // replacement string interprets $$, $&, $` etc. — corrupting KaTeX math.
  it('preserves $ sequences (KaTeX math) when resolving a conflict', () => {
    const result = mergeMarkdownThreeWay({
      base: 'x\n',
      local: '$$E = mc^2$$\n',
      remote: 'y\n'
    })
    expect(result.conflicts).toHaveLength(1)

    const [conflict] = result.conflicts
    const resolved = resolveConflictMarker(result.mergedMarkdown, conflict, 'local')
    expect(resolved).toBe('$$E = mc^2$$\n')
  })

  it('preserves $&, $` and $\' literals when resolving a conflict', () => {
    const weird = 'a $& b $` c $\' d\n'
    const result = mergeMarkdownThreeWay({ base: 'x\n', local: weird, remote: 'y\n' })
    const [conflict] = result.conflicts
    expect(resolveConflictMarker(result.mergedMarkdown, conflict, 'local')).toBe(weird)
  })

  // Finding 3 (HIGH): O(n·m) dual LCS tables freeze/OOM the renderer on large
  // files. Beyond a guard size the merge must degrade to a whole-file conflict
  // rather than allocating gigabytes, and must never drop content.
  it('degrades huge inputs to a whole-file conflict instead of allocating an O(n·m) table', () => {
    const base = `${Array.from({ length: 40000 }, (_, i) => `line ${i}`).join('\n')}\n`
    const local = base.replace('line 0', 'LOCAL 0')
    const remote = base.replace('line 1', 'REMOTE 1')
    const started = performance.now()
    const result = mergeMarkdownThreeWay({ base, local, remote })
    const elapsed = performance.now() - started

    // Without the cell-budget guard this allocates a ~40000×40000 LCS table and
    // freezes/OOMs; the guard must return a whole-file conflict quickly.
    expect(elapsed).toBeLessThan(1000)
    expect(result.conflicts).toHaveLength(1)
    expect(result.mergedMarkdown).toContain('LOCAL 0')
    expect(result.mergedMarkdown).toContain('REMOTE 1')
  })

  it('escalates overlapping comment range edits to conflict markers', () => {
    const result = mergeMarkdownThreeWay({
      base: 'A <!--MC:a-->reviewed<!--MC:~a--> span.\n',
      local: 'A <!--MC:a-->locally reviewed<!--MC:~a--> span.\n',
      remote: 'A <!--MC:a-->agent reviewed<!--MC:~a--> span.\n'
    })

    expect(result.conflicts).toHaveLength(1)
    expect(result.mergedMarkdown).toContain('<<<<<<< MARKTEXT_LOCAL c1')
    expect(result.mergedMarkdown).toContain('<!--MC:a-->locally reviewed<!--MC:~a-->')
    expect(result.mergedMarkdown).toContain('<!--MC:a-->agent reviewed<!--MC:~a-->')
  })
})

// Third-review findings: the repeated-line reconciliation post-pass could
// silently emit a document neither side wrote (position-blind splice), and
// escalate git-clean merges to whole-file conflicts (count-target asymmetry).
// The contract these lock: a clean auto-merge must never fabricate or drop a
// line vs git's diff3, and a merge git resolves cleanly must not become a
// whole-file conflict.
describe('mergeMarkdownThreeWay — repeated-line safety (no silent corruption / no false escalation)', () => {
  // A clean auto-merge (conflicts:[]) must equal git's diff3 output byte for
  // byte — never a fabricated extra copy of a repeated line.
  it('does not duplicate a repeated line when one side edits away its base copy', () => {
    const result = mergeMarkdownThreeWay({
      base: 'b\n\nc\n',
      local: 'b\n\nb\nc\n',
      remote: 'a\n\nb\nc\n'
    })
    if (result.conflicts.length === 0) {
      // git merge-file --diff3 produces this exact clean result.
      expect(result.mergedMarkdown).toBe('a\n\nb\nc\n')
    }
  })

  it('does not fabricate a duplicate list item across an unrelated heading edit', () => {
    const result = mergeMarkdownThreeWay({
      base: '- a\n\nEnd\n',
      local: '- a\n\n- a\nEnd\n',
      remote: '# Title\n\n- a\nEnd\n'
    })
    if (result.conflicts.length === 0) {
      expect(result.mergedMarkdown).toBe('# Title\n\n- a\nEnd\n')
    }
  })

  // 'a' occurs once in base and both sides change its count (local appends,
  // remote changes the base 'a' to 'c'), so the merge is ambiguous by counts
  // alone: a whole-file conflict preserving both sides is the safe outcome, and
  // if ever auto-merged it must equal git's clean bytes — never a mis-count.
  it('never mis-counts a repeated line both sides touch (clean matches git, else conflict)', () => {
    const result = mergeMarkdownThreeWay({
      base: 'a\nc\n',
      local: 'a\nc\na\n',
      remote: 'c\nc\n'
    })
    if (result.conflicts.length === 0) {
      expect(result.mergedMarkdown).toBe('c\nc\na\n')
    } else {
      expect(result.conflicts).toHaveLength(1)
      expect(result.mergedMarkdown).toContain('MARKTEXT_LOCAL')
    }
  })

  it('does not escalate when both sides make the identical insertion but an anchor repeats', () => {
    const result = mergeMarkdownThreeWay({
      base: 'x\ny\n',
      local: 'x\nNEW\ny\n',
      remote: 'x\nNEW\ny\nx\n'
    })
    expect(result.conflicts).toEqual([])
    expect(result.mergedMarkdown).toBe('x\nNEW\ny\nx\n')
  })
})

// Third-review finding: the Accept guard must (a) detect EVERY generated
// conflict marker line — including the '||||||| MARKTEXT_BASE' base line that
// createConflictMarker emits — so a hand-edited result that leaves the base
// marker cannot be saved with scaffolding, and (b) NOT false-positive on
// legitimate document content that merely resembles a separator, so a valid
// merge stays acceptable.
describe('containsConflictScaffolding', () => {
  it('detects a left-behind base marker line', () => {
    const doc = 'kept text\n||||||| MARKTEXT_BASE c1\nbase text\nmore\n'
    expect(containsConflictScaffolding(doc)).toBe(true)
  })

  it('detects the local/remote marker lines', () => {
    expect(containsConflictScaffolding('a\n<<<<<<< MARKTEXT_LOCAL c1\nb\n')).toBe(true)
    expect(containsConflictScaffolding('a\n>>>>>>> MARKTEXT_REMOTE c1\nb\n')).toBe(true)
  })

  it('does not false-positive on a legitimate 7-equals line (setext underline / rule)', () => {
    expect(containsConflictScaffolding('Heading\n=======\nbody\n')).toBe(false)
    expect(containsConflictScaffolding('=======\n')).toBe(false)
  })

  it('is false for a fully resolved document', () => {
    expect(containsConflictScaffolding('title\n\nbody with = signs and > quotes\n')).toBe(false)
  })

  it('flags a result that still holds only the base marker of a generated conflict', () => {
    const result = mergeMarkdownThreeWay({
      base: 'one\nshared\nthree\n',
      local: 'one\nlocal\nthree\n',
      remote: 'one\nremote\nthree\n'
    })
    const baseMarkerLine = result.mergedMarkdown
      .split('\n')
      .find((line) => line.startsWith('||||||| MARKTEXT_BASE'))
    expect(baseMarkerLine).toBeTruthy()
    expect(containsConflictScaffolding(`resolved\n${baseMarkerLine}\nbase\n`)).toBe(true)
  })
})
