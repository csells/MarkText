// Research 0006 §9 spike — can @lezer/markdown host Profile 1's CriticMarkup?
//
// Two competing designs are implemented:
//  - pairedCritic: openers are pending delimiters; closers pair via
//    findOpeningDelimiter + takeContent (manual resolution). This is the
//    design that could satisfy R2 (unmatched → literal) and C1 (containment).
//  - atomCritic: markers are standalone inline atoms (Gemini's proposal);
//    pairing would live in a projection layer above the parse.
//
// A block-level container (markers on their own lines) probes the composite
// BlockParser ceiling for whole-block enclosure.

import { parser as commonmarkParser, GFM } from '@lezer/markdown'

const FORMS = [
  { name: 'CriticAddition', open: '{++', close: '++}' },
  { name: 'CriticDeletion', open: '{--', close: '--}' },
  { name: 'CriticHighlight', open: '{==', close: '==}' },
  { name: 'CriticComment', open: '{>>', close: '<<}' },
  { name: 'CriticSubstitution', open: '{~~', close: '~~}' }
]

const delims = new Map(FORMS.map((f) => [f.name, { mark: f.name + 'Mark' }]))
// The `~>` divider is a pending delimiter, resolved only by the closer. This
// keeps R2/R4 honest: an unclosed substitution leaves no phantom nodes, and a
// stray `~>` degrades silently with everything else. Index comparison against
// the substitution opener scopes R4 to the innermost substitution, so nesting
// and dividers inside nested annotations work.
const dividerDelim = {}

const nodeSpecs = [
  ...FORMS.flatMap((f) => [{ name: f.name }, { name: f.name + 'Mark' }]),
  { name: 'CriticSubDivider' },
  { name: 'CriticSubOldArm' },
  { name: 'CriticSubNewArm' }
]

// --- Design A: paired delimiters, manual resolution ------------------------

const pairedInline = {
  name: 'CriticMarkup',
  before: 'Strikethrough',
  parse (cx, next, pos) {
    // Openers: '{' followed by a known two-char run.
    if (next === 123 /* { */) {
      const tag = cx.slice(pos, Math.min(pos + 3, cx.end))
      const form = FORMS.find((f) => f.open === tag)
      if (form) return cx.addDelimiter(delims.get(form.name), pos, pos + 3, true, false)
      return -1
    }
    // Substitution divider — a pending delimiter only; the closer decides
    // whether it is this substitution's top-level divider (R4) or payload.
    if (next === 126 /* ~ */ && cx.slice(pos, Math.min(pos + 2, cx.end)) === '~>') {
      if (cx.findOpeningDelimiter(delims.get('CriticSubstitution')) != null) {
        return cx.addDelimiter(dividerDelim, pos, pos + 2, true, false)
      }
      // fall through: a '~~}' closer also starts with '~'
    }
    // Closers.
    const tag3 = cx.slice(pos, Math.min(pos + 3, cx.end))
    const form = FORMS.find((f) => f.close === tag3)
    if (!form) return -1
    const type = delims.get(form.name)
    const open = cx.findOpeningDelimiter(type)
    if (open == null) return -1 // R2: closer with no opener → literal
    const openDelim = cx.getDelimiterAt(open)
    if (form.name === 'CriticSubstitution') {
      // R4, scoped to the innermost substitution: the divider must sit after
      // THIS opener (a divider inside a nested annotation was consumed by
      // that annotation's takeContent; an outer substitution's divider has a
      // lower index). findOpeningDelimiter returns the most recent, but R4
      // gives the FIRST top-level divider the job — scan up from the opener;
      // later dividers drop silently inside the new arm's takeContent.
      const lastDiv = cx.findOpeningDelimiter(dividerDelim)
      if (lastDiv == null || lastDiv < open) return -1
      let div = lastDiv
      for (let i = open + 1; i < lastDiv; i++) {
        const d = cx.getDelimiterAt(i)
        if (d && d.type === dividerDelim) {
          div = i
          break
        }
      }
      const divDelim = cx.getDelimiterAt(div)
      const newArm = cx.takeContent(div)
      const oldArm = cx.takeContent(open)
      const children = [
        cx.elt(form.name + 'Mark', openDelim.from, openDelim.to),
        cx.elt('CriticSubOldArm', openDelim.to, divDelim.from, oldArm),
        cx.elt('CriticSubDivider', divDelim.from, divDelim.to),
        cx.elt('CriticSubNewArm', divDelim.to, pos, newArm),
        cx.elt(form.name + 'Mark', pos, pos + 3)
      ]
      return cx.addElement(cx.elt(form.name, openDelim.from, pos + 3, children))
    }
    const content = cx.takeContent(open)
    const children = [
      cx.elt(form.name + 'Mark', openDelim.from, openDelim.to),
      ...content,
      cx.elt(form.name + 'Mark', pos, pos + 3)
    ]
    return cx.addElement(cx.elt(form.name, openDelim.from, pos + 3, children))
  }
}

// --- Design B: standalone marker atoms (projection-layer pairing) ----------

const atomNodeSpecs = [{ name: 'CriticOpenAtom' }, { name: 'CriticCloseAtom' }]

const atomInline = {
  name: 'CriticAtoms',
  before: 'Strikethrough',
  parse (cx, next, pos) {
    if (next === 123 /* { */) {
      const tag = cx.slice(pos, Math.min(pos + 3, cx.end))
      if (FORMS.some((f) => f.open === tag)) {
        return cx.addElement(cx.elt('CriticOpenAtom', pos, pos + 3))
      }
      return -1
    }
    const tag3 = cx.slice(pos, Math.min(pos + 3, cx.end))
    if (FORMS.some((f) => f.close === tag3)) {
      return cx.addElement(cx.elt('CriticCloseAtom', pos, pos + 3))
    }
    return -1
  }
}

// --- Block-level container: markers on their own lines ---------------------

const blockNodeSpecs = [
  {
    name: 'CriticBlockAddition',
    block: true,
    composite (cx, line) {
      // Continue until a line that is exactly the closing marker.
      return line.text.slice(line.pos).trim() !== '++}'
    }
  },
  { name: 'CriticBlockMark', block: true }
]

const blockParser = {
  name: 'CriticBlockAddition',
  parse (cx, line) {
    const text = line.text.slice(line.pos).trim()
    if (text === '{++') {
      cx.startComposite('CriticBlockAddition', line.pos)
      cx.addElement(cx.elt('CriticBlockMark', cx.lineStart + line.pos, cx.lineStart + line.pos + 3))
      cx.nextLine()
      return null
    }
    if (text === '++}' && cx.depth > 1 && cx.parentType().name === 'CriticBlockAddition') {
      cx.addElement(cx.elt('CriticBlockMark', cx.lineStart + line.pos, cx.lineStart + line.pos + 3))
      cx.nextLine()
      return true
    }
    return false
  }
}

export const PairedCritic = { defineNodes: nodeSpecs, parseInline: [pairedInline] }
export const AtomCritic = { defineNodes: atomNodeSpecs, parseInline: [atomInline] }
export const BlockCritic = { defineNodes: blockNodeSpecs, parseBlock: [blockParser] }

export const pairedParser = commonmarkParser.configure([GFM, PairedCritic])
export const atomParser = commonmarkParser.configure([GFM, AtomCritic])
export const blockParser_ = commonmarkParser.configure([GFM, PairedCritic, BlockCritic])
