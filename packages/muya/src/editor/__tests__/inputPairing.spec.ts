import { describe, expect, it } from 'vitest';
import { applyInputPairing } from '../inputPairing';

const options = { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true };
const context = { isInInlineMath: false, isInInlineCode: false, type: 'format' };

describe('input pairing as exact document operations', () => {
    it('pairs an opening bracket and retains the caret inside it', () => {
        expect(applyInputPairing({ text: 'seed', start: 4, end: 4, collapsed: true, inputType: 'insertText', data: '(', options, context })).toEqual({
            kind: 'replace',
            edit: { start: 4, end: 4, text: '()' },
            selection: { start: 5, end: 5 },
        });
    });

    it('skips an existing closer without replacing its document content', () => {
        expect(applyInputPairing({ text: '()', start: 1, end: 1, collapsed: true, inputType: 'insertText', data: ')', options, context })).toEqual({
            kind: 'selection',
            edit: null,
            selection: { start: 2, end: 2 },
        });
    });

    it.each(['deleteContentBackward', 'deleteContentForward'])('removes the matching pair for %s', (inputType) => {
        const start = inputType === 'deleteContentBackward' ? 0 : 1;
        expect(applyInputPairing({ text: '()', start, end: start + 1, collapsed: true, inputType, data: null, options, context })).toEqual({
            kind: 'replace',
            edit: { start: 0, end: 2, text: '' },
            selection: { start: 0, end: 0 },
        });
    });

    it('wraps selected text and retains the original selection inside the pair', () => {
        expect(applyInputPairing({ text: 'before selected after', start: 7, end: 15, collapsed: false, inputType: 'insertText', data: '(', options, context })).toEqual({
            kind: 'wrap',
            edits: [{ start: 7, end: 7, text: '(' }, { start: 15, end: 15, text: ')' }],
            selection: { start: 8, end: 16 },
        });
    });

    it('uses supplied literal context instead of recognizing syntax itself', () => {
        expect(applyInputPairing({ text: ' ', start: 0, end: 0, collapsed: true, inputType: 'insertText', data: '*', options, context: { ...context, isInInlineCode: true } })).toEqual({
            kind: 'replace',
            edit: { start: 0, end: 0, text: '*' },
            selection: { start: 1, end: 1 },
        });
    });
});
