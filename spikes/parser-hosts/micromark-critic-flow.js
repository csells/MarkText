// Adversarial-review find (wf_94bf082a, micromark-designs cluster): a
// FLOW-level construct expresses the R3 block-enclosure SUBSET — `{++` alone
// on a line … `++}` alone on a line, enclosing whole blocks — on micromark's
// public API. Interior lines are linked contentType:'document' chunks, the
// same mechanism chunkFlow uses, so the interior parses as real block
// structure. Mid-inline openers remain impossible (flow constructs run only
// at line starts); this is micromark's parallel to the lezer composite-block
// design and to Penney's proposed markers-on-own-lines block syntax.

import { codes } from 'micromark-util-symbol'

const closerLineProbe = {
  partial: true,
  tokenize (effects, ok, nok) {
    let step = 0
    return probe
    function probe (code) {
      if (step === 0 || step === 1) {
        if (code !== codes.plusSign) return nok(code)
        if (step === 0) effects.enter('criticCloserLineProbe')
        effects.consume(code)
        step++
        return probe
      }
      if (step === 2) {
        if (code !== codes.rightCurlyBrace) return nok(code)
        effects.consume(code)
        step++
        return probe
      }
      if (
        code === codes.eof ||
        code === codes.carriageReturn ||
        code === codes.lineFeed ||
        code === codes.carriageReturnLineFeed
      ) {
        effects.exit('criticCloserLineProbe')
        return ok(code)
      }
      return nok(code)
    }
  }
}

const criticBlock = {
  name: 'criticBlockAddition',
  concrete: true,
  tokenize (effects, ok, nok) {
    let previous
    return start
    function start (code) {
      effects.enter('criticBlockAddition')
      effects.enter('criticAdditionMarker')
      effects.consume(code) // '{'
      return open1
    }
    function open1 (code) {
      if (code !== codes.plusSign) return nok(code)
      effects.consume(code)
      return open2
    }
    function open2 (code) {
      if (code !== codes.plusSign) return nok(code)
      effects.consume(code)
      effects.exit('criticAdditionMarker')
      return afterOpener
    }
    function afterOpener (code) {
      // Opener must sit alone on its line to open a block annotation.
      if (
        code === codes.carriageReturn ||
        code === codes.lineFeed ||
        code === codes.carriageReturnLineFeed
      ) {
        effects.enter('lineEnding')
        effects.consume(code)
        effects.exit('lineEnding')
        return lineStart
      }
      return nok(code)
    }
    function lineStart (code) {
      if (code === codes.eof) return nok(code) // unclosed → degrade (R2)
      if (code === codes.plusSign) {
        return effects.check(closerLineProbe, closer, chunkStart)(code)
      }
      return chunkStart(code)
    }
    function chunkStart (code) {
      const token = effects.enter('criticBlockContent', {
        contentType: 'document',
        previous
      })
      if (previous) previous.next = token
      previous = token
      return chunkInside(code)
    }
    function chunkInside (code) {
      if (code === codes.eof) return nok(code) // unclosed → degrade (R2)
      if (
        code === codes.carriageReturn ||
        code === codes.lineFeed ||
        code === codes.carriageReturnLineFeed
      ) {
        effects.consume(code)
        effects.exit('criticBlockContent')
        return lineStart
      }
      effects.consume(code)
      return chunkInside
    }
    function closer (code) {
      effects.enter('criticAdditionMarker')
      effects.consume(code) // '+'
      return closer2
    }
    function closer2 (code) {
      effects.consume(code) // '+'
      return closer3
    }
    function closer3 (code) {
      effects.consume(code) // '}'
      effects.exit('criticAdditionMarker')
      effects.exit('criticBlockAddition')
      return ok
    }
  }
}

export const criticFlowSyntax = { flow: { [codes.leftCurlyBrace]: criticBlock } }

export const criticFlowHtml = {
  enter: {
    criticBlockAddition () {
      this.tag('<ins>')
    }
  },
  exit: {
    criticBlockAddition () {
      this.tag('</ins>')
    }
  }
}
