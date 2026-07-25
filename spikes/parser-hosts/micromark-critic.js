// Research 0006 §9 spike — can micromark host Profile 1's CriticMarkup?
//
// Implements the Addition form ({++ … ++}) as a text-level SyntaxExtension:
// tokenizer keyed on '{', closer detected via a partial `check` construct, and
// the payload emitted as a token with contentType 'text' so micromark
// subtokenizes it as ordinary inline Markdown (arm-local by construction).
// Addition alone is sufficient for the go/no-go questions.

import { codes } from 'micromark-util-symbol'

const closerProbe = {
  partial: true,
  tokenize (effects, ok, nok) {
    let plusCount = 0
    return step
    function step (code) {
      if (plusCount < 2) {
        if (code !== codes.plusSign) return nok(code)
        if (plusCount === 0) effects.enter('criticCloserProbe')
        effects.consume(code)
        plusCount++
        return step
      }
      if (code !== codes.rightCurlyBrace) return nok(code)
      effects.consume(code)
      effects.exit('criticCloserProbe')
      return ok
    }
  }
}

const openerProbe = {
  partial: true,
  tokenize (effects, ok, nok) {
    let seen = 0
    return step
    function step (code) {
      const want = seen === 0 ? codes.leftCurlyBrace : codes.plusSign
      if (code !== want) return nok(code)
      if (seen === 0) effects.enter('criticOpenerProbe')
      effects.consume(code)
      seen++
      if (seen === 3) {
        effects.exit('criticOpenerProbe')
        return ok
      }
      return step
    }
  }
}

const addition = {
  name: 'criticAddition',
  tokenize (effects, ok, nok) {
    // Same-form nesting depth: inner `{++ … ++}` pairs are consumed as raw
    // payload here (innermost pairing, N1); they FORM during subtokenization
    // of the payload, where this construct runs again at the inner opener.
    let depth = 0
    // Payload chunk tokens are LINKED (previous/next) so the text
    // subtokenizer sees one continuous stream across soft line breaks —
    // unlinked chunks each end in a synthetic EOF that kills any inline
    // construct spanning the break.
    let previousChunk
    // Backslash-run parity so an escaped `++}` or `{++` is payload (E1).
    let backslashes = 0
    return start

    function start (code) {
      effects.enter('criticAddition')
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
      return between
    }
    // Position: directly after the opener only. An immediately following
    // line ending is emitted as its own lineEnding token BEFORE the payload
    // chain starts (legal: the chain must be contiguous, but tokens before
    // its first chunk are fine).
    function between (code) {
      if (code === codes.eof) return nok(code) // ← the flow-boundary wall
      if (code === codes.plusSign) {
        return effects.check(closerProbe, closer, enterText)(code)
      }
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
      return enterText(code)
    }
    // Start of a payload line. Only a depth-0 closer may end the chain here;
    // anything else opens the next linked chunk.
    function lineStart (code) {
      if (code === codes.eof) return nok(code) // ← the flow-boundary wall
      if (code === codes.plusSign && depth === 0) {
        return effects.check(closerProbe, closer, enterText)(code)
      }
      return enterText(code)
    }
    function enterText (code) {
      const token = effects.enter('criticAdditionText', {
        contentType: 'text',
        previous: previousChunk
      })
      if (previousChunk) previousChunk.next = token
      previousChunk = token
      return content(code)
    }
    function content (code) {
      if (code === codes.eof) return nok(code) // ← the flow-boundary wall
      const escaped = backslashes % 2 === 1
      backslashes = code === codes.backslash ? backslashes + 1 : 0
      if (code === codes.leftCurlyBrace && !escaped) {
        return effects.check(openerProbe, innerOpen, keepChar)(code)
      }
      if (code === codes.plusSign && !escaped) {
        return effects.check(closerProbe, depth > 0 ? innerClose : closerAfterText, keepChar)(code)
      }
      if (
        code === codes.carriageReturn ||
        code === codes.lineFeed ||
        code === codes.carriageReturnLineFeed
      ) {
        // The line ending stays INSIDE the chunk so the linked chain is
        // contiguous — a gap between chunks breaks subtokenization.
        effects.consume(code)
        effects.exit('criticAdditionText')
        return lineStart
      }
      effects.consume(code)
      return content
    }
    function keepChar (code) {
      effects.consume(code)
      return content
    }
    // Consume an inner same-form opener/closer as raw payload text.
    function innerOpen (code) {
      depth++
      return eat(3)(code)
    }
    function innerClose (code) {
      depth--
      return eat(3)(code)
    }
    function eat (n) {
      let left = n
      return function step (code) {
        effects.consume(code)
        left--
        return left === 0 ? content : step
      }
    }
    function closerAfterText (code) {
      effects.exit('criticAdditionText')
      return closer(code)
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
      effects.exit('criticAddition')
      return ok
    }
  }
}

export const criticSyntax = {
  text: { [codes.leftCurlyBrace]: addition }
}

export const criticHtml = {
  enter: {
    criticAddition () {
      this.tag('<ins>')
    }
  },
  exit: {
    criticAddition () {
      this.tag('</ins>')
    }
  }
}
