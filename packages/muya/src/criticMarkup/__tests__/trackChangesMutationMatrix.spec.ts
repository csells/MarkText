// @vitest-environment happy-dom

/**
 * Wave 3 table-driven Track Changes mutation matrix
 * (specs/plans/archive/0006-criticmarkup-production-readiness-closure.md,
 * bullets 3-5).
 *
 * Every row drives a real browser gesture (typing or Backspace) through the
 * booted editor's input path — exactly like
 * src/block/base/__tests__/criticMarkupTrackChanges.spec.ts — and locks the
 * gateway outcome for one construct x form x caret-position-class cell:
 *
 * - `tracked`: the commit landed, the document is canonical five-form
 *   CriticMarkup, `project('original')` equals the before-semantics,
 *   `project('revised')` equals the after-semantics, and exactly one history
 *   entry restores the source byte-exactly (expectSingleUndoRedo).
 * - `rejected`: the fail-closed path — markdown, JSON state, and history are
 *   untouched and exactly one `critic-markup-track-change-rejected` event
 *   fired. No delimiter edit may partially mutate the document.
 * - `blocked`: the caret target is hidden comment syntax, so `beforeinput`
 *   prevents the browser mutation before it can enter the Track Changes
 *   gateway. Markdown, JSON state, and history remain untouched and no
 *   gateway rejection event fires.
 *
 * Expected values are derived from the grammar authority
 * (specs/architecture/criticmarkup.md) plus the coded invariant in
 * src/criticMarkup/trackChanges.ts:
 *
 * 1. An edit whose source range is contained by an item's editable payload
 *    (addition/deletion/highlight `contentRange`, substitution
 *    `oldRange`/`newRange`) is applied as a plain payload edit — but only
 *    when both projections still hold: `tracked.original` must equal the
 *    ORIGINAL projection of the before-document and `tracked.revised` the
 *    REVISED projection of the proposal. Payload edits inside a deletion,
 *    a highlight, or a substitution's old arm change the Original projection
 *    and are therefore rejected (fail-closed); payload edits inside an
 *    addition or a substitution's new arm are committed. Comment syntax is
 *    never a WYSIWYG caret target; deliberate comment edits use the Review
 *    command path and are covered separately.
 * 2. An edit intersecting an item anywhere else (delimiters, separator) is
 *    rejected outright.
 * 3. An edit wholly outside every item is authored as a new
 *    addition/deletion/substitution whose projections are proven before
 *    commit.
 *
 * Caret offsets are raw block-text offsets (Marked view shows canonical
 * marker bytes). Backspace rows note: fast-diff resolves a deletion inside a
 * run of identical delimiter characters to one canonical position in that
 * run; the classification (inside a delimiter => rejected) is unaffected.
 *
 * Every matrix row is locked against the observed engine behavior, which was
 * verified to satisfy both plan invariants: fail-closed rejection leaves the
 * document byte-identical with one typed rejection event, and tracked edits
 * satisfy Original = before and Revised = after with exact undo restoration.
 */

import type Format from '../../block/base/format';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../muya';
import { scanCriticMarkup } from '../parser';
import { projectCriticMarkupTokens } from '../project';

const hosts: HTMLElement[] = [];
const editors: Muya[] = [];

afterEach(() => {
    while (editors.length)
        editors.pop()!.destroy();
    while (hosts.length)
        hosts.pop()!.remove();
    document.getSelection()?.removeAllRanges();
});

function boot(markdown: string) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    const muya = new Muya(host, {
        markdown,
        criticMarkupTrackChanges: true,
    } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    editors.push(muya);
    const block = muya.editor.scrollPage!.firstContentInDescendant() as Format;
    return { muya, block };
}

function input(
    block: Format,
    browserText: string,
    caret: number,
    inputType: string,
    data: string | null,
) {
    block.domNode!.textContent = browserText;
    block.setCursor(caret, caret);
    block.inputHandler(new InputEvent('input', {
        bubbles: true,
        data,
        inputType,
    }));
}

function expectExactProjections(
    tracked: string,
    original: string,
    revised: string,
): void {
    const tokens = scanCriticMarkup(tracked);
    expect(projectCriticMarkupTokens(tracked, 'original', tokens))
        .toBe(original);
    expect(projectCriticMarkupTokens(tracked, 'revised', tokens))
        .toBe(revised);
}

function expectSingleUndoRedo(
    muya: Muya,
    before: string,
    after: string,
): void {
    expect(muya.getHistory().stack.undo).toHaveLength(1);
    muya.undo();
    expect(muya.getMarkdown()).toBe(before);
    expect(muya.getHistory().stack.redo).toHaveLength(1);
    muya.redo();
    expect(muya.getMarkdown()).toBe(after);
}

// Any marker fragment OUTSIDE a scanned item is corruption. Payload bytes
// inside an item's range are that item's content and deliberately excluded.
const STRAY_MARKER_FRAGMENT
    = /\{\+\+|\+\+\}|\{--|--\}|\{~~|~~\}|~>|\{==|==\}|\{>>|<<\}/;

function expectCanonicalCriticMarkup(markdown: string): void {
    const roots = [...scanCriticMarkup(markdown)]
        .sort((left, right) => left.range.start - right.range.start);
    let stripped = '';
    let cursor = 0;
    for (const token of roots) {
        stripped += markdown.slice(cursor, token.range.start);
        cursor = token.range.end;
    }
    stripped += markdown.slice(cursor);
    expect(stripped).not.toMatch(STRAY_MARKER_FRAGMENT);
}

type TConstruct
    = 'addition' | 'deletion' | 'substitution' | 'highlight' | 'comment';
type TForm = 'plain' | 'empty' | 'nested' | 'block-spanning';
type TPosition
    = 'before' | 'open' | 'content' | 'old-arm' | 'separator' | 'new-arm'
        | 'close' | 'after';
type TOperation = 'type' | 'backspace';

type TMatrixExpectation
    = | {
        result: 'tracked';
        markdown: string;
        original: string;
        revised: string;
    }
        | { result: 'rejected' }
        | { result: 'blocked' };

interface IMatrixRow {
    construct: TConstruct;
    form: TForm;
    position: TPosition;
    operation: TOperation;
    /** Document markdown booted into the editor; must round-trip byte-exact. */
    source: string;
    /** Content block receiving the browser edit (block-spanning rows). */
    block?: 'first' | 'last';
    /** Asserted before editing so block-local caret offsets stay honest. */
    blockText?: string;
    /**
     * Block-local caret before the gesture; `type` inserts here, `backspace`
     * removes the character before it.
     */
    caretOffset: number;
    /** Character typed by `type` rows; defaults to the neutral letter Z. */
    insert?: string;
    /** Browser-reported mutation range when the visible caret is at a hidden edge. */
    beforeInputTarget?: 'comment-close-marker';
    expected: TMatrixExpectation;
}

function tracked(
    markdown: string,
    original: string,
    revised: string,
): TMatrixExpectation {
    return { result: 'tracked', markdown, original, revised };
}

const REJECTED: TMatrixExpectation = { result: 'rejected' };
const BLOCKED: TMatrixExpectation = { result: 'blocked' };

const TYPED = 'Z';

/* eslint-disable antfu/consistent-list-newline */
const MATRIX: readonly IMatrixRow[] = [
    // ------------------------------------------------------------------
    // ADDITION, plain form: 'a{++x++}b' — item [1,8), content [4,5).
    // ------------------------------------------------------------------
    { construct: 'addition', form: 'plain', position: 'before', operation: 'type', source: 'a{++x++}b\n', caretOffset: 1,
        expected: tracked('a{++Z++}{++x++}b\n', 'ab\n', 'aZxb\n') },
    { construct: 'addition', form: 'plain', position: 'before', operation: 'backspace', source: 'a{++x++}b\n', caretOffset: 1,
        expected: tracked('{--a--}{++x++}b\n', 'ab\n', 'xb\n') },
    { construct: 'addition', form: 'plain', position: 'open', operation: 'type', source: 'a{++x++}b\n', caretOffset: 2,
        expected: REJECTED },
    { construct: 'addition', form: 'plain', position: 'open', operation: 'type', source: 'a{++x++}b\n', caretOffset: 3,
        expected: REJECTED },
    { construct: 'addition', form: 'plain', position: 'open', operation: 'backspace', source: 'a{++x++}b\n', caretOffset: 2,
        expected: REJECTED }, // deletes '{'
    { construct: 'addition', form: 'plain', position: 'open', operation: 'backspace', source: 'a{++x++}b\n', caretOffset: 4,
        expected: REJECTED }, // deletes a '+' of the opener run
    { construct: 'addition', form: 'plain', position: 'content', operation: 'type', source: 'a{++x++}b\n', caretOffset: 4,
        expected: tracked('a{++Zx++}b\n', 'ab\n', 'aZxb\n') },
    { construct: 'addition', form: 'plain', position: 'content', operation: 'type', source: 'a{++x++}b\n', caretOffset: 5,
        expected: tracked('a{++xZ++}b\n', 'ab\n', 'axZb\n') },
    // Removing the whole pending payload must leave the empty semantic form
    // (architecture: empty payloads remain semantic while authoring).
    { construct: 'addition', form: 'plain', position: 'content', operation: 'backspace', source: 'a{++x++}b\n', caretOffset: 5,
        expected: tracked('a{++++}b\n', 'ab\n', 'ab\n') },
    { construct: 'addition', form: 'plain', position: 'close', operation: 'type', source: 'a{++x++}b\n', caretOffset: 6,
        expected: REJECTED },
    { construct: 'addition', form: 'plain', position: 'close', operation: 'type', source: 'a{++x++}b\n', caretOffset: 7,
        expected: REJECTED },
    { construct: 'addition', form: 'plain', position: 'close', operation: 'backspace', source: 'a{++x++}b\n', caretOffset: 6,
        expected: REJECTED }, // deletes a '+' of the closer run
    { construct: 'addition', form: 'plain', position: 'close', operation: 'backspace', source: 'a{++x++}b\n', caretOffset: 8,
        expected: REJECTED }, // deletes '}'
    { construct: 'addition', form: 'plain', position: 'after', operation: 'type', source: 'a{++x++}b\n', caretOffset: 8,
        expected: tracked('a{++x++}{++Z++}b\n', 'ab\n', 'axZb\n') },
    { construct: 'addition', form: 'plain', position: 'after', operation: 'backspace', source: 'a{++x++}b\n', caretOffset: 9,
        expected: tracked('a{++x++}{--b--}\n', 'ab\n', 'ax\n') },

    // ------------------------------------------------------------------
    // DELETION, plain form: 'a{--x--}b' — item [1,8), content [4,5).
    // Payload edits change the Original projection, so they fail closed.
    // ------------------------------------------------------------------
    { construct: 'deletion', form: 'plain', position: 'before', operation: 'type', source: 'a{--x--}b\n', caretOffset: 1,
        expected: tracked('a{++Z++}{--x--}b\n', 'axb\n', 'aZb\n') },
    { construct: 'deletion', form: 'plain', position: 'before', operation: 'backspace', source: 'a{--x--}b\n', caretOffset: 1,
        expected: tracked('{--a--}{--x--}b\n', 'axb\n', 'b\n') },
    { construct: 'deletion', form: 'plain', position: 'open', operation: 'type', source: 'a{--x--}b\n', caretOffset: 2,
        expected: REJECTED },
    { construct: 'deletion', form: 'plain', position: 'open', operation: 'type', source: 'a{--x--}b\n', caretOffset: 3,
        expected: REJECTED },
    { construct: 'deletion', form: 'plain', position: 'open', operation: 'backspace', source: 'a{--x--}b\n', caretOffset: 2,
        expected: REJECTED },
    { construct: 'deletion', form: 'plain', position: 'open', operation: 'backspace', source: 'a{--x--}b\n', caretOffset: 4,
        expected: REJECTED },
    { construct: 'deletion', form: 'plain', position: 'content', operation: 'type', source: 'a{--x--}b\n', caretOffset: 4,
        expected: REJECTED }, // would rewrite the recorded Original text
    { construct: 'deletion', form: 'plain', position: 'content', operation: 'type', source: 'a{--x--}b\n', caretOffset: 5,
        expected: REJECTED },
    { construct: 'deletion', form: 'plain', position: 'content', operation: 'backspace', source: 'a{--x--}b\n', caretOffset: 5,
        expected: REJECTED }, // would erase recorded Original text
    { construct: 'deletion', form: 'plain', position: 'close', operation: 'type', source: 'a{--x--}b\n', caretOffset: 6,
        expected: REJECTED },
    { construct: 'deletion', form: 'plain', position: 'close', operation: 'type', source: 'a{--x--}b\n', caretOffset: 7,
        expected: REJECTED },
    { construct: 'deletion', form: 'plain', position: 'close', operation: 'backspace', source: 'a{--x--}b\n', caretOffset: 6,
        expected: REJECTED },
    { construct: 'deletion', form: 'plain', position: 'close', operation: 'backspace', source: 'a{--x--}b\n', caretOffset: 8,
        expected: REJECTED },
    { construct: 'deletion', form: 'plain', position: 'after', operation: 'type', source: 'a{--x--}b\n', caretOffset: 8,
        expected: tracked('a{--x--}{++Z++}b\n', 'axb\n', 'aZb\n') },
    { construct: 'deletion', form: 'plain', position: 'after', operation: 'backspace', source: 'a{--x--}b\n', caretOffset: 9,
        expected: tracked('a{--x--}{--b--}\n', 'axb\n', 'a\n') },

    // ------------------------------------------------------------------
    // SUBSTITUTION, plain form: 'a{~~o~>n~~}b' — item [1,11),
    // old arm [4,5), separator [5,7), new arm [7,8).
    // ------------------------------------------------------------------
    { construct: 'substitution', form: 'plain', position: 'before', operation: 'type', source: 'a{~~o~>n~~}b\n', caretOffset: 1,
        expected: tracked('a{++Z++}{~~o~>n~~}b\n', 'aob\n', 'aZnb\n') },
    { construct: 'substitution', form: 'plain', position: 'before', operation: 'backspace', source: 'a{~~o~>n~~}b\n', caretOffset: 1,
        expected: tracked('{--a--}{~~o~>n~~}b\n', 'aob\n', 'nb\n') },
    { construct: 'substitution', form: 'plain', position: 'open', operation: 'type', source: 'a{~~o~>n~~}b\n', caretOffset: 2,
        expected: REJECTED },
    { construct: 'substitution', form: 'plain', position: 'open', operation: 'type', source: 'a{~~o~>n~~}b\n', caretOffset: 3,
        expected: REJECTED },
    { construct: 'substitution', form: 'plain', position: 'open', operation: 'backspace', source: 'a{~~o~>n~~}b\n', caretOffset: 2,
        expected: REJECTED }, // deletes '{'
    { construct: 'substitution', form: 'plain', position: 'open', operation: 'backspace', source: 'a{~~o~>n~~}b\n', caretOffset: 4,
        expected: REJECTED }, // deletes a '~' of the opener run
    { construct: 'substitution', form: 'plain', position: 'old-arm', operation: 'type', source: 'a{~~o~>n~~}b\n', caretOffset: 4,
        expected: REJECTED }, // old arm records Original text
    { construct: 'substitution', form: 'plain', position: 'old-arm', operation: 'type', source: 'a{~~o~>n~~}b\n', caretOffset: 5,
        expected: REJECTED },
    { construct: 'substitution', form: 'plain', position: 'old-arm', operation: 'backspace', source: 'a{~~o~>n~~}b\n', caretOffset: 5,
        expected: REJECTED },
    { construct: 'substitution', form: 'plain', position: 'separator', operation: 'type', source: 'a{~~o~>n~~}b\n', caretOffset: 6,
        expected: REJECTED },
    { construct: 'substitution', form: 'plain', position: 'separator', operation: 'backspace', source: 'a{~~o~>n~~}b\n', caretOffset: 6,
        expected: REJECTED }, // deletes the separator '~'
    { construct: 'substitution', form: 'plain', position: 'separator', operation: 'backspace', source: 'a{~~o~>n~~}b\n', caretOffset: 7,
        expected: REJECTED }, // deletes the separator '>'
    { construct: 'substitution', form: 'plain', position: 'new-arm', operation: 'type', source: 'a{~~o~>n~~}b\n', caretOffset: 7,
        expected: tracked('a{~~o~>Zn~~}b\n', 'aob\n', 'aZnb\n') },
    { construct: 'substitution', form: 'plain', position: 'new-arm', operation: 'type', source: 'a{~~o~>n~~}b\n', caretOffset: 8,
        expected: tracked('a{~~o~>nZ~~}b\n', 'aob\n', 'anZb\n') },
    // Emptying the new arm must keep the empty-arm semantic form.
    { construct: 'substitution', form: 'plain', position: 'new-arm', operation: 'backspace', source: 'a{~~o~>n~~}b\n', caretOffset: 8,
        expected: tracked('a{~~o~>~~}b\n', 'aob\n', 'ab\n') },
    { construct: 'substitution', form: 'plain', position: 'close', operation: 'type', source: 'a{~~o~>n~~}b\n', caretOffset: 9,
        expected: REJECTED },
    { construct: 'substitution', form: 'plain', position: 'close', operation: 'type', source: 'a{~~o~>n~~}b\n', caretOffset: 10,
        expected: REJECTED },
    { construct: 'substitution', form: 'plain', position: 'close', operation: 'backspace', source: 'a{~~o~>n~~}b\n', caretOffset: 9,
        expected: REJECTED }, // deletes a '~' of the closer run
    { construct: 'substitution', form: 'plain', position: 'close', operation: 'backspace', source: 'a{~~o~>n~~}b\n', caretOffset: 11,
        expected: REJECTED }, // deletes '}'
    { construct: 'substitution', form: 'plain', position: 'after', operation: 'type', source: 'a{~~o~>n~~}b\n', caretOffset: 11,
        expected: tracked('a{~~o~>n~~}{++Z++}b\n', 'aob\n', 'anZb\n') },
    { construct: 'substitution', form: 'plain', position: 'after', operation: 'backspace', source: 'a{~~o~>n~~}b\n', caretOffset: 12,
        expected: tracked('a{~~o~>n~~}{--b--}\n', 'aob\n', 'an\n') },

    // ------------------------------------------------------------------
    // HIGHLIGHT, plain form: 'a{==x==}b' — item [1,8), content [4,5).
    // Highlight text belongs to BOTH projections; payload edits change the
    // Original projection and therefore fail closed.
    // ------------------------------------------------------------------
    { construct: 'highlight', form: 'plain', position: 'before', operation: 'type', source: 'a{==x==}b\n', caretOffset: 1,
        expected: tracked('a{++Z++}{==x==}b\n', 'axb\n', 'aZxb\n') },
    { construct: 'highlight', form: 'plain', position: 'before', operation: 'backspace', source: 'a{==x==}b\n', caretOffset: 1,
        expected: tracked('{--a--}{==x==}b\n', 'axb\n', 'xb\n') },
    { construct: 'highlight', form: 'plain', position: 'open', operation: 'type', source: 'a{==x==}b\n', caretOffset: 2,
        expected: REJECTED },
    { construct: 'highlight', form: 'plain', position: 'open', operation: 'type', source: 'a{==x==}b\n', caretOffset: 3,
        expected: REJECTED },
    { construct: 'highlight', form: 'plain', position: 'open', operation: 'backspace', source: 'a{==x==}b\n', caretOffset: 2,
        expected: REJECTED },
    { construct: 'highlight', form: 'plain', position: 'open', operation: 'backspace', source: 'a{==x==}b\n', caretOffset: 4,
        expected: REJECTED },
    { construct: 'highlight', form: 'plain', position: 'content', operation: 'type', source: 'a{==x==}b\n', caretOffset: 4,
        expected: REJECTED },
    { construct: 'highlight', form: 'plain', position: 'content', operation: 'type', source: 'a{==x==}b\n', caretOffset: 5,
        expected: REJECTED },
    { construct: 'highlight', form: 'plain', position: 'content', operation: 'backspace', source: 'a{==x==}b\n', caretOffset: 5,
        expected: REJECTED },
    { construct: 'highlight', form: 'plain', position: 'close', operation: 'type', source: 'a{==x==}b\n', caretOffset: 6,
        expected: REJECTED },
    { construct: 'highlight', form: 'plain', position: 'close', operation: 'type', source: 'a{==x==}b\n', caretOffset: 7,
        expected: REJECTED },
    { construct: 'highlight', form: 'plain', position: 'close', operation: 'backspace', source: 'a{==x==}b\n', caretOffset: 6,
        expected: REJECTED },
    { construct: 'highlight', form: 'plain', position: 'close', operation: 'backspace', source: 'a{==x==}b\n', caretOffset: 8,
        expected: REJECTED },
    { construct: 'highlight', form: 'plain', position: 'after', operation: 'type', source: 'a{==x==}b\n', caretOffset: 8,
        expected: tracked('a{==x==}{++Z++}b\n', 'axb\n', 'axZb\n') },
    { construct: 'highlight', form: 'plain', position: 'after', operation: 'backspace', source: 'a{==x==}b\n', caretOffset: 9,
        expected: tracked('a{==x==}{--b--}\n', 'axb\n', 'ax\n') },

    // ------------------------------------------------------------------
    // COMMENT, plain form: 'a{>>x<<}b' — item [1,8), content [4,5).
    // Comment payload appears in NEITHER projection, so payload edits are
    // plain edits to the annotation.
    // ------------------------------------------------------------------
    { construct: 'comment', form: 'plain', position: 'before', operation: 'type', source: 'a{>>x<<}b\n', caretOffset: 1,
        expected: tracked('a{++Z++}{>>x<<}b\n', 'ab\n', 'aZb\n') },
    { construct: 'comment', form: 'plain', position: 'before', operation: 'backspace', source: 'a{>>x<<}b\n', caretOffset: 1,
        expected: tracked('{--a--}{>>x<<}b\n', 'ab\n', 'b\n') },
    { construct: 'comment', form: 'plain', position: 'open', operation: 'type', source: 'a{>>x<<}b\n', caretOffset: 2,
        expected: BLOCKED },
    { construct: 'comment', form: 'plain', position: 'open', operation: 'type', source: 'a{>>x<<}b\n', caretOffset: 3,
        expected: BLOCKED },
    { construct: 'comment', form: 'plain', position: 'open', operation: 'backspace', source: 'a{>>x<<}b\n', caretOffset: 2,
        expected: BLOCKED },
    { construct: 'comment', form: 'plain', position: 'open', operation: 'backspace', source: 'a{>>x<<}b\n', caretOffset: 4,
        expected: BLOCKED },
    { construct: 'comment', form: 'plain', position: 'content', operation: 'type', source: 'a{>>x<<}b\n', caretOffset: 4,
        expected: BLOCKED },
    { construct: 'comment', form: 'plain', position: 'content', operation: 'type', source: 'a{>>x<<}b\n', caretOffset: 5,
        expected: BLOCKED },
    { construct: 'comment', form: 'plain', position: 'content', operation: 'backspace', source: 'a{>>x<<}b\n', caretOffset: 5,
        expected: BLOCKED },
    { construct: 'comment', form: 'plain', position: 'close', operation: 'type', source: 'a{>>x<<}b\n', caretOffset: 6,
        expected: BLOCKED },
    { construct: 'comment', form: 'plain', position: 'close', operation: 'type', source: 'a{>>x<<}b\n', caretOffset: 7,
        expected: BLOCKED },
    { construct: 'comment', form: 'plain', position: 'close', operation: 'backspace', source: 'a{>>x<<}b\n', caretOffset: 6,
        expected: BLOCKED },
    { construct: 'comment', form: 'plain', position: 'close', operation: 'backspace', source: 'a{>>x<<}b\n', caretOffset: 8, beforeInputTarget: 'comment-close-marker',
        expected: BLOCKED },
    { construct: 'comment', form: 'plain', position: 'after', operation: 'type', source: 'a{>>x<<}b\n', caretOffset: 8,
        expected: tracked('a{>>x<<}{++Z++}b\n', 'ab\n', 'aZb\n') },
    { construct: 'comment', form: 'plain', position: 'after', operation: 'backspace', source: 'a{>>x<<}b\n', caretOffset: 9,
        expected: tracked('a{>>x<<}{--b--}\n', 'ab\n', 'a\n') },

    // ------------------------------------------------------------------
    // Content-interior (multi-character payload) rows: the caret sits
    // strictly between payload characters, not at a payload boundary.
    // ------------------------------------------------------------------
    { construct: 'addition', form: 'plain', position: 'content', operation: 'type', source: 'a{++xy++}b\n', caretOffset: 5,
        expected: tracked('a{++xZy++}b\n', 'ab\n', 'axZyb\n') },
    { construct: 'deletion', form: 'plain', position: 'content', operation: 'type', source: 'a{--xy--}b\n', caretOffset: 5,
        expected: REJECTED },
    { construct: 'substitution', form: 'plain', position: 'old-arm', operation: 'type', source: 'a{~~op~>nm~~}b\n', caretOffset: 5,
        expected: REJECTED },
    { construct: 'substitution', form: 'plain', position: 'new-arm', operation: 'type', source: 'a{~~op~>nm~~}b\n', caretOffset: 9,
        expected: tracked('a{~~op~>nZm~~}b\n', 'aopb\n', 'anZmb\n') },
    { construct: 'highlight', form: 'plain', position: 'content', operation: 'type', source: 'a{==xy==}b\n', caretOffset: 5,
        expected: REJECTED },
    { construct: 'comment', form: 'plain', position: 'content', operation: 'type', source: 'a{>>xy<<}b\n', caretOffset: 5,
        expected: BLOCKED },

    // Authoring with a delimiter-like character: the serializer emits no
    // escape for a lone '+' — '{+++++}' reparses to the payload '+' because
    // the closer scan matches the first viable '++}' after the opener.
    { construct: 'addition', form: 'plain', position: 'before', operation: 'type', source: 'a{++x++}b\n', caretOffset: 1, insert: '+',
        expected: tracked('a{+++++}{++x++}b\n', 'ab\n', 'a+xb\n') },

    // ------------------------------------------------------------------
    // EMPTY forms: '{++++}', '{----}', '{~~~>~~}', '{====}', '{>><<}'.
    // Empty payloads/arms are semantic (architecture: authoring stability).
    // ------------------------------------------------------------------
    { construct: 'addition', form: 'empty', position: 'content', operation: 'type', source: 'a{++++}b\n', caretOffset: 4,
        expected: tracked('a{++Z++}b\n', 'ab\n', 'aZb\n') },
    { construct: 'addition', form: 'empty', position: 'close', operation: 'backspace', source: 'a{++++}b\n', caretOffset: 4,
        expected: REJECTED }, // diff resolves inside the delimiter runs
    { construct: 'addition', form: 'empty', position: 'open', operation: 'type', source: 'a{++++}b\n', caretOffset: 2,
        expected: REJECTED },
    // Typing into an empty deletion would mint Original text from nowhere.
    { construct: 'deletion', form: 'empty', position: 'content', operation: 'type', source: 'a{----}b\n', caretOffset: 4,
        expected: REJECTED },
    { construct: 'deletion', form: 'empty', position: 'close', operation: 'backspace', source: 'a{----}b\n', caretOffset: 4,
        expected: REJECTED },
    { construct: 'substitution', form: 'empty', position: 'old-arm', operation: 'type', source: 'a{~~~>~~}b\n', caretOffset: 4,
        expected: REJECTED },
    { construct: 'substitution', form: 'empty', position: 'new-arm', operation: 'type', source: 'a{~~~>~~}b\n', caretOffset: 6,
        expected: tracked('a{~~~>Z~~}b\n', 'ab\n', 'aZb\n') },
    { construct: 'substitution', form: 'empty', position: 'separator', operation: 'backspace', source: 'a{~~~>~~}b\n', caretOffset: 6,
        expected: REJECTED },
    { construct: 'highlight', form: 'empty', position: 'content', operation: 'type', source: 'a{====}b\n', caretOffset: 4,
        expected: REJECTED },
    { construct: 'highlight', form: 'empty', position: 'close', operation: 'backspace', source: 'a{====}b\n', caretOffset: 4,
        expected: REJECTED },
    { construct: 'comment', form: 'empty', position: 'content', operation: 'type', source: 'a{>><<}b\n', caretOffset: 4,
        expected: BLOCKED },
    { construct: 'comment', form: 'empty', position: 'open', operation: 'backspace', source: 'a{>><<}b\n', caretOffset: 4,
        expected: BLOCKED },

    // ------------------------------------------------------------------
    // NESTED forms: the edit targets the nested item's payload. Projection
    // impact composes through the outer item (an outer addition suppresses
    // the whole subtree from Original; an outer deletion/comment suppresses
    // it from Revised), so these payload edits keep both projections intact.
    // ------------------------------------------------------------------
    { construct: 'addition', form: 'nested', position: 'content', operation: 'type', source: 'a{++x{--y--}z++}b\n', caretOffset: 9,
        expected: tracked('a{++x{--yZ--}z++}b\n', 'ab\n', 'axzb\n') },
    { construct: 'deletion', form: 'nested', position: 'content', operation: 'type', source: 'a{--x{++y++}z--}b\n', caretOffset: 9,
        expected: tracked('a{--x{++yZ++}z--}b\n', 'axzb\n', 'ab\n') },
    { construct: 'substitution', form: 'nested', position: 'new-arm', operation: 'type', source: 'a{~~o~>x{==h==}y~~}b\n', caretOffset: 12,
        expected: tracked('a{~~o~>x{==hZ==}y~~}b\n', 'aob\n', 'axhZyb\n') },
    { construct: 'highlight', form: 'nested', position: 'content', operation: 'type', source: 'a{==x{>>c<<}y==}b\n', caretOffset: 9,
        expected: BLOCKED },
    // Comment payload is opaque to both projections whether or not the
    // grammar nests the inner form, so the outcome is identical either way.
    { construct: 'comment', form: 'nested', position: 'content', operation: 'type', source: 'a{>>x{++y++}z<<}b\n', caretOffset: 9,
        expected: BLOCKED },
    // Deleting the NESTED opener happens inside the OUTER addition's editable
    // payload: the gateway accepts it as a plain payload edit — the inner
    // marker degrades to literal payload text ('--y--}' has no opener, and
    // dangling closers are text), and both projections still hold exactly.
    { construct: 'addition', form: 'nested', position: 'open', operation: 'backspace', source: 'a{++x{--y--}z++}b\n', caretOffset: 6,
        expected: tracked('a{++x--y--}z++}b\n', 'ab\n', 'ax--y--}zb\n') },
    { construct: 'addition', form: 'nested', position: 'open', operation: 'backspace', source: 'a{++x{--y--}z++}b\n', caretOffset: 2,
        expected: REJECTED }, // outer opener is not inside any editable payload

    // ------------------------------------------------------------------
    // BLOCK-SPANNING forms: one marker pair across a paragraph break.
    // Rows edit one rendered fragment; offsets are block-local.
    // ------------------------------------------------------------------
    { construct: 'addition', form: 'block-spanning', position: 'content', operation: 'type', source: 'a{++b\n\nc++}d\n', block: 'first', blockText: 'a{++b', caretOffset: 4,
        expected: tracked('a{++Zb\n\nc++}d\n', 'ad\n', 'aZb\n\ncd\n') },
    { construct: 'addition', form: 'block-spanning', position: 'close', operation: 'backspace', source: 'a{++b\n\nc++}d\n', block: 'last', blockText: 'c++}d', caretOffset: 4,
        expected: REJECTED }, // deletes '}'
    { construct: 'deletion', form: 'block-spanning', position: 'content', operation: 'type', source: 'a{--b\n\nc--}d\n', block: 'first', blockText: 'a{--b', caretOffset: 4,
        expected: REJECTED },
    { construct: 'deletion', form: 'block-spanning', position: 'before', operation: 'type', source: 'a{--b\n\nc--}d\n', block: 'first', blockText: 'a{--b', caretOffset: 1,
        expected: tracked('a{++Z++}{--b\n\nc--}d\n', 'ab\n\ncd\n', 'aZd\n') },
    { construct: 'deletion', form: 'block-spanning', position: 'close', operation: 'backspace', source: 'a{--b\n\nc--}d\n', block: 'last', blockText: 'c--}d', caretOffset: 2,
        expected: REJECTED },
    { construct: 'substitution', form: 'block-spanning', position: 'new-arm', operation: 'type', source: 'a{~~b\n\nc~>X~~}d\n', block: 'last', blockText: 'c~>X~~}d', caretOffset: 4,
        expected: tracked('a{~~b\n\nc~>XZ~~}d\n', 'ab\n\ncd\n', 'aXZd\n') },
    { construct: 'substitution', form: 'block-spanning', position: 'separator', operation: 'backspace', source: 'a{~~b\n\nc~>X~~}d\n', block: 'last', blockText: 'c~>X~~}d', caretOffset: 3,
        expected: REJECTED }, // deletes '>'
    { construct: 'highlight', form: 'block-spanning', position: 'content', operation: 'type', source: 'a{==b\n\nc==}d\n', block: 'first', blockText: 'a{==b', caretOffset: 4,
        expected: REJECTED },
    { construct: 'highlight', form: 'block-spanning', position: 'after', operation: 'type', source: 'a{==b\n\nc==}d\n', block: 'last', blockText: 'c==}d', caretOffset: 4,
        expected: tracked('a{==b\n\nc==}{++Z++}d\n', 'ab\n\ncd\n', 'ab\n\ncZd\n') },
    { construct: 'highlight', form: 'block-spanning', position: 'close', operation: 'backspace', source: 'a{==b\n\nc==}d\n', block: 'last', blockText: 'c==}d', caretOffset: 2,
        expected: REJECTED },
    { construct: 'comment', form: 'block-spanning', position: 'content', operation: 'type', source: 'a{>>b\n\nc<<}d\n', block: 'first', blockText: 'a{>>b', caretOffset: 4,
        expected: BLOCKED },
    { construct: 'comment', form: 'block-spanning', position: 'close', operation: 'backspace', source: 'a{>>b\n\nc<<}d\n', block: 'last', blockText: 'c<<}d', caretOffset: 2,
        expected: BLOCKED },
];
/* eslint-enable antfu/consistent-list-newline */

function blockUnderTest(muya: Muya, which: 'first' | 'last'): Format {
    const block = which === 'last'
        ? muya.editor.scrollPage!.lastContentInDescendant()
        : muya.editor.scrollPage!.firstContentInDescendant();
    return block as Format;
}

function applyBrowserEdit(block: Format, row: IMatrixRow): void {
    const text = block.text;
    if (row.operation === 'type') {
        const inserted = row.insert ?? TYPED;
        const browserText = text.slice(0, row.caretOffset)
            + inserted
            + text.slice(row.caretOffset);
        input(
            block,
            browserText,
            row.caretOffset + inserted.length,
            'insertText',
            inserted,
        );
    }
    else {
        const browserText = text.slice(0, row.caretOffset - 1)
            + text.slice(row.caretOffset);
        input(
            block,
            browserText,
            row.caretOffset - 1,
            'deleteContentBackward',
            null,
        );
    }
}

function expectTrackedOutcome(
    muya: Muya,
    row: IMatrixRow,
    rejected: ReturnType<typeof vi.fn>,
): void {
    if (row.expected.result !== 'tracked')
        throw new TypeError('Expected a tracked matrix expectation.');
    const trackedMarkdown = muya.getMarkdown();
    expect(trackedMarkdown).toBe(row.expected.markdown);
    expect(rejected).not.toHaveBeenCalled();
    expectCanonicalCriticMarkup(trackedMarkdown);
    expectExactProjections(
        trackedMarkdown,
        row.expected.original,
        row.expected.revised,
    );
    const criticDocument = muya.editor.criticMarkupDocument.get();
    expect(criticDocument.project('original')).toBe(row.expected.original);
    expect(criticDocument.project('revised')).toBe(row.expected.revised);
    expectSingleUndoRedo(muya, row.source, trackedMarkdown);
}

function expectRejectedOutcome(
    muya: Muya,
    row: IMatrixRow,
    stateBefore: unknown,
    rejected: ReturnType<typeof vi.fn>,
    changes: ReturnType<typeof vi.fn>,
): void {
    expect(muya.getMarkdown()).toBe(row.source);
    expect(muya.getState()).toEqual(stateBefore);
    expect(muya.getHistory().stack.undo).toHaveLength(0);
    expect(rejected).toHaveBeenCalledOnce();
    expect(changes).not.toHaveBeenCalled();
}

function expectBlockedBeforeMutation(
    muya: Muya,
    block: Format,
    row: IMatrixRow,
    stateBefore: unknown,
    rejected: ReturnType<typeof vi.fn>,
    changes: ReturnType<typeof vi.fn>,
): void {
    const selection = muya.editor.selection.getSelection();
    if (!selection)
        throw new TypeError('Expected an editor selection.');
    const getSelection = vi.spyOn(
        muya.editor.selection,
        'getSelection',
    ).mockReturnValue({
        ...selection,
        anchor: {
            offset: row.caretOffset,
            block,
            path: block.path,
        },
        focus: {
            offset: row.caretOffset,
            block,
            path: block.path,
        },
        isCollapsed: true,
        isSelectionInSameBlock: true,
    });
    const event = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: row.operation === 'type' ? row.insert ?? TYPED : null,
        inputType: row.operation === 'type'
            ? 'insertText'
            : 'deleteContentBackward',
    });
    if (row.beforeInputTarget === 'comment-close-marker') {
        const markers = block.domNode!.querySelectorAll(
            '.mu-critic-comment .mu-critic-marker',
        );
        const target = markers[markers.length - 1]?.firstChild;
        if (!target) {
            throw new TypeError(
                'Expected a rendered hidden comment close marker.',
            );
        }
        const endOffset = target.textContent?.length ?? 0;
        Object.defineProperty(event, 'getTargetRanges', {
            value: () => [{
                startContainer: target,
                startOffset: Math.max(0, endOffset - 1),
                endContainer: target,
                endOffset,
                collapsed: false,
            }],
        });
    }

    const accepted = muya.domNode.dispatchEvent(event);
    getSelection.mockRestore();

    expect(accepted).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(muya.getMarkdown()).toBe(row.source);
    expect(muya.getState()).toEqual(stateBefore);
    expect(muya.getHistory().stack.undo).toHaveLength(0);
    expect(rejected).not.toHaveBeenCalled();
    expect(changes).not.toHaveBeenCalled();
}

describe('criticMarkup Track Changes mutation matrix', () => {
    it.each(MATRIX)(
        '$construct/$form $operation at $position (caret $caretOffset)',
        (row) => {
            const { muya } = boot(row.source);
            expect(muya.getMarkdown()).toBe(row.source);
            const block = blockUnderTest(muya, row.block ?? 'first');
            expect(block.text)
                .toBe(row.blockText ?? row.source.replace(/\n$/, ''));
            const stateBefore = muya.getState();
            const rejected = vi.fn();
            const changes = vi.fn();
            muya.on('critic-markup-track-change-rejected', rejected);
            muya.on('json-change', changes);

            if (row.expected.result === 'blocked') {
                expectBlockedBeforeMutation(
                    muya,
                    block,
                    row,
                    stateBefore,
                    rejected,
                    changes,
                );
                return;
            }

            applyBrowserEdit(block, row);

            if (row.expected.result === 'tracked')
                expectTrackedOutcome(muya, row, rejected);
            else
                expectRejectedOutcome(muya, row, stateBefore, rejected, changes);
        },
    );
});

describe('selection replacement across item boundaries', () => {
    function replaceSelection(
        block: Format,
        browserText: string,
        caret: number,
        data: string,
    ): void {
        input(block, browserText, caret, 'insertReplacementText', data);
    }

    // The three boundary-crossing tests below assert
    // the required fail-closed contract (specs/architecture/criticmarkup.md,
    // "Malformed input" / "Projection and mutation": an edit that would
    // damage a live delimiter must be rejected with one typed
    // `critic-markup-track-change-rejected` event and an untouched document).
    // The engine instead throws an uncaught RangeError ("CriticMarkup
    // document fragment ... exceeds its inline source",
    // src/inlineRenderer/lexer.ts tryCriticMarkupDocumentFragment) from
    // inputHandler's cursor-context probe (format.ts _checkCursorInTokenType)
    // BEFORE the mutation gateway runs: the browser has already shrunk the
    // DOM text below the stale fragment's range, so a routine select-and-type
    // gesture over a marker crashes the input path with no typed rejection
    // and no DOM restore. Keep these red until the input path fails closed.
    it('rejects a replacement straddling the opening boundary', () => {
        const source = 'a{++x++}b\n';
        const { muya, block } = boot(source);
        const stateBefore = muya.getState();
        const rejected = vi.fn();
        muya.on('critic-markup-track-change-rejected', rejected);
        block.setCursor(0, 5, true);

        replaceSelection(block, 'Q++}b', 1, 'Q');

        expect(muya.getMarkdown()).toBe(source);
        expect(muya.getState()).toEqual(stateBefore);
        expect(muya.getHistory().stack.undo).toHaveLength(0);
        expect(rejected).toHaveBeenCalledOnce();
    });

    it('rejects a replacement straddling the closing boundary', () => {
        const source = 'a{++x++}b\n';
        const { muya, block } = boot(source);
        const stateBefore = muya.getState();
        const rejected = vi.fn();
        muya.on('critic-markup-track-change-rejected', rejected);
        block.setCursor(5, 9, true);

        replaceSelection(block, 'a{++xQ', 6, 'Q');

        expect(muya.getMarkdown()).toBe(source);
        expect(muya.getState()).toEqual(stateBefore);
        expect(muya.getHistory().stack.undo).toHaveLength(0);
        expect(rejected).toHaveBeenCalledOnce();
    });

    it('rejects replacing an entire item until a multi-edit transform exists', () => {
        const source = 'a{++x++}b\n';
        const { muya, block } = boot(source);
        const stateBefore = muya.getState();
        const rejected = vi.fn();
        muya.on('critic-markup-track-change-rejected', rejected);
        block.setCursor(1, 8, true);

        replaceSelection(block, 'aQb', 2, 'Q');

        expect(muya.getMarkdown()).toBe(source);
        expect(muya.getState()).toEqual(stateBefore);
        expect(muya.getHistory().stack.undo).toHaveLength(0);
        expect(rejected).toHaveBeenCalledOnce();
    });

    it('replaces a selection wholly inside a pending payload as a plain edit', () => {
        const source = 'a{++xyz++}b\n';
        const { muya, block } = boot(source);
        block.setCursor(5, 6, true);

        replaceSelection(block, 'a{++xQz++}b', 6, 'Q');

        const trackedMarkdown = muya.getMarkdown();
        expect(trackedMarkdown).toBe('a{++xQz++}b\n');
        expectCanonicalCriticMarkup(trackedMarkdown);
        expectExactProjections(trackedMarkdown, 'ab\n', 'axQzb\n');
        expectSingleUndoRedo(muya, source, trackedMarkdown);
    });
});

describe('inline format toggle under Track Changes', () => {
    // format() reads the live range via getCursor(), but happy-dom's global
    // Selection collapses ranges to 0 — stub the one read the way
    // formatToggle.spec.ts does so the genuine format/text-surgery path runs.
    function selectRaw(
        muya: Muya,
        block: Format,
        start: number,
        end: number,
    ): void {
        muya.editor.activeContentBlock = block as never;
        block.setCursor(start, start, true);
        (block as unknown as { getCursor: () => unknown }).getCursor = () => ({
            start: { offset: start },
            end: { offset: end },
            anchor: { offset: start },
            focus: { offset: end },
            isCollapsed: start === end,
            isSelectionInSameBlock: true,
            direction: 'forward',
            type: 'Range',
        });
    }

    // The two `**` runs land outside any item, so each is authored as its
    // own addition in one commit; Original stays byte-exact while Revised
    // carries the emphasis markers.
    it('tracks bolding a plain selection as marker additions in one commit', () => {
        const source = 'axb\n';
        const { muya, block } = boot(source);
        selectRaw(muya, block, 1, 2);

        const result = muya.editor.mutationGateway.run(
            { kind: 'user-command' },
            () => block.format('strong'),
        );

        expect(result).toBe('tracked');
        const trackedMarkdown = muya.getMarkdown();
        expect(trackedMarkdown).toBe('a{++**++}x{++**++}b\n');
        expectCanonicalCriticMarkup(trackedMarkdown);
        expectExactProjections(trackedMarkdown, 'axb\n', 'a**x**b\n');
        expectSingleUndoRedo(muya, source, trackedMarkdown);
    });

    // The selection spans an existing item, but both inserted marker runs
    // fall outside it, so the tracked transform authors two additions around
    // the untouched item instead of rejecting.
    it('tracks bolding a selection that contains an existing item', () => {
        const source = 'a{++x++}b\n';
        const { muya, block } = boot(source);
        selectRaw(muya, block, 0, 9);

        const result = muya.editor.mutationGateway.run(
            { kind: 'user-command' },
            () => block.format('strong'),
        );

        expect(result).toBe('tracked');
        const trackedMarkdown = muya.getMarkdown();
        expect(trackedMarkdown).toBe('{++**++}a{++x++}b{++**++}\n');
        expectCanonicalCriticMarkup(trackedMarkdown);
        expectExactProjections(trackedMarkdown, 'ab\n', '**axb**\n');
        expectSingleUndoRedo(muya, source, trackedMarkdown);
    });
});

describe('ime composition cancel under Track Changes', () => {
    it('commits nothing when a composition ends without data', () => {
        const source = 'ab\n';
        const { muya, block } = boot(source);
        const stateBefore = muya.getState();
        const rejected = vi.fn();
        const changes = vi.fn();
        muya.on('critic-markup-track-change-rejected', rejected);
        muya.on('json-change', changes);

        block.composeHandler(new CompositionEvent('compositionstart'));
        // The IME briefly shows a candidate, then the user cancels: the
        // browser restores the pre-composition text before compositionend.
        // Replacing textContent drops the DOM selection, so the caret is
        // restored afterwards the way the real browser leaves one behind.
        block.domNode!.textContent = 'aあb';
        block.domNode!.textContent = 'ab';
        block.setCursor(1, 1);
        block.composeHandler(new CompositionEvent('compositionend'));
        muya.flush();

        expect(muya.getMarkdown()).toBe(source);
        expect(muya.getState()).toEqual(stateBefore);
        expect(muya.getHistory().stack.undo).toHaveLength(0);
        expect(changes).not.toHaveBeenCalled();
        expect(rejected).not.toHaveBeenCalled();
    });

    it('still tracks ordinary typing after a cancelled composition', () => {
        const source = 'ab\n';
        const { muya, block } = boot(source);
        block.composeHandler(new CompositionEvent('compositionstart'));
        block.domNode!.textContent = 'ab';
        block.setCursor(1, 1);
        block.composeHandler(new CompositionEvent('compositionend'));
        muya.flush();

        input(block, 'aZb', 2, 'insertText', 'Z');

        const trackedMarkdown = muya.getMarkdown();
        expect(trackedMarkdown).toBe('a{++Z++}b\n');
        expectExactProjections(trackedMarkdown, source, 'aZb\n');
        expectSingleUndoRedo(muya, source, trackedMarkdown);
    });
});
