// Adversarial-review find (wf_94bf082a, micromark-designs cluster): the
// attention-style alternative to the direct tokenizer in micromark-critic.js.
// `{++` and `++}` are tokenized as flat marker sequences wherever the text
// tokenizer offers them (so code spans/math own their interiors for free —
// L2), and a `resolveTo` pairs a closer with the nearest opener the moment
// the closer completes, BEFORE attention resolves — giving arm-local
// containment for emphasis in most orders, innermost same-form nesting, R2
// degradation of leftovers, E1 escaping via micromark's own characterEscape,
// and no lookahead scan (so none of the direct design's quadratic hazard).
// Residual gap (pinned in tests): attention that ALREADY resolved earlier in
// the same text context can still produce crossed pairings.

import { codes } from 'micromark-util-symbol'
import { splice, push } from 'micromark-util-chunked'
import { resolveAll } from 'micromark-util-resolve-all'

const construct = {
  name: 'criticAttention',
  tokenize (effects, ok, nok) {
    return start
    function start (code) {
      if (code === codes.leftCurlyBrace) {
        const token = effects.enter('criticSeqTemp')
        token._open = true
        effects.consume(code)
        return openPlus1
      }
      if (code === codes.plusSign) {
        const token = effects.enter('criticSeqTemp')
        token._close = true
        effects.consume(code)
        return closePlus2
      }
      return nok(code)
    }
    function openPlus1 (code) {
      if (code !== codes.plusSign) return nok(code)
      effects.consume(code)
      return openPlus2
    }
    function openPlus2 (code) {
      if (code !== codes.plusSign) return nok(code)
      effects.consume(code)
      effects.exit('criticSeqTemp')
      return ok
    }
    function closePlus2 (code) {
      if (code !== codes.plusSign) return nok(code)
      effects.consume(code)
      return closeBrace
    }
    function closeBrace (code) {
      if (code !== codes.rightCurlyBrace) return nok(code)
      effects.consume(code)
      effects.exit('criticSeqTemp')
      return ok
    }
  },
  // Pair as soon as a closer completes — attention has not resolved yet, so
  // interior attention temporaries are resolved (or dropped) inside the arm.
  resolveTo (events, context) {
    const tailToken = events[events.length - 1][1]
    if (tailToken.type !== 'criticSeqTemp' || !tailToken._close) return events
    const index = events.length - 2 // 'enter' of the closer
    let open = index
    while (open--) {
      if (
        events[open][0] === 'exit' &&
        events[open][1].type === 'criticSeqTemp' &&
        events[open][1]._open
      ) {
        events[index][1].type = 'criticSequence'
        events[open][1].type = 'criticSequence'
        const critic = {
          type: 'criticAddition',
          start: { ...events[open][1].start },
          end: { ...events[index][1].end }
        }
        const text = {
          type: 'criticAdditionText',
          start: { ...events[open][1].end },
          end: { ...events[index][1].start }
        }
        let nextEvents = [
          ['enter', critic, context],
          ['enter', events[open][1], context],
          ['exit', events[open][1], context],
          ['enter', text, context]
        ]
        const inside = context.parser.constructs.insideSpan.null
        nextEvents = push(
          nextEvents,
          resolveAll(inside, events.slice(open + 1, index), context)
        )
        nextEvents = push(nextEvents, [
          ['exit', text, context],
          ['enter', events[index][1], context],
          ['exit', events[index][1], context],
          ['exit', critic, context]
        ])
        splice(events, open - 1, index - open + 3, nextEvents)
        break
      }
    }
    return events
  },
  resolveAll (events) {
    // R2: leftover unpaired markers degrade to plain data.
    let index = -1
    while (++index < events.length) {
      if (events[index][1].type === 'criticSeqTemp') {
        events[index][1].type = 'data'
      }
    }
    return events
  }
}

export const criticResolveSyntax = {
  text: {
    [codes.leftCurlyBrace]: construct,
    [codes.plusSign]: construct
  }
}

export const criticResolveHtml = {
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
