// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { CLASS_NAMES } from '../../config';
import { getNodeAndOffset, getOffsetOfParagraph } from '../dom';

// A long paragraph keeps its last read offset and DOM point until its DOM
// changes, however the change arrives: a change made in an earlier task has
// had its records delivered to the observer before the next read.

const paragraphs: HTMLElement[] = [];

afterEach(() => {
    while (paragraphs.length)
        paragraphs.pop()!.remove();
});

/** A content span holding `count` token spans, each with one line. */
function longParagraph(count: number): HTMLElement {
    const paragraph = document.createElement('span');
    paragraph.className = `${CLASS_NAMES.MU_CONTENT}`;
    for (let index = 0; index < count; index += 1) {
        const token = document.createElement('span');
        token.textContent = `line ${index}\n`;
        paragraph.appendChild(token);
    }
    document.body.appendChild(paragraph);
    paragraphs.push(paragraph);
    return paragraph;
}

const nextTask = () => new Promise(resolve => setTimeout(resolve, 0));

describe('reads in a long paragraph', () => {
    it('reads an offset again after a change in an earlier task', async () => {
        const paragraph = longParagraph(100);
        const caret = paragraph.childNodes[50]!.firstChild!;
        const before = getOffsetOfParagraph(caret, paragraph, 2);
        expect(before).toBe(paragraph.textContent!.indexOf('line 50') + 2);
        (paragraph.childNodes[10]!.firstChild as Text).insertData(0, 'xyz');
        await nextTask();
        expect(getOffsetOfParagraph(caret, paragraph, 2)).toBe(before + 3);
    });

    it('reads a DOM point again after a change in an earlier task', async () => {
        const paragraph = longParagraph(100);
        const offset = paragraph.textContent!.indexOf('line 50') + 2;
        expect(getNodeAndOffset(paragraph, offset)).toEqual({ node: paragraph.childNodes[50]!.firstChild, offset: 2 });
        (paragraph.childNodes[10]!.firstChild as Text).insertData(0, 'xyz');
        await nextTask();
        expect(getNodeAndOffset(paragraph, offset)).toEqual({ node: paragraph.childNodes[49]!.firstChild, offset: 7 });
    });

    it('reads an offset again after a child becomes a rendered preview', async () => {
        const paragraph = longParagraph(100);
        const caret = paragraph.childNodes[50]!.firstChild!;
        const before = getOffsetOfParagraph(caret, paragraph, 2);
        (paragraph.childNodes[10] as HTMLElement).classList.add(CLASS_NAMES.MU_MATH_RENDER);
        await nextTask();
        expect(getOffsetOfParagraph(caret, paragraph, 2)).toBe(before - 'line 10\n'.length);
    });

    it('reads a DOM point again after a change in the same task', () => {
        const paragraph = longParagraph(100);
        const offset = paragraph.textContent!.indexOf('line 50') + 2;
        getNodeAndOffset(paragraph, offset);
        paragraph.childNodes[0]!.remove();
        expect(getNodeAndOffset(paragraph, offset)).toEqual({ node: paragraph.childNodes[50]!.firstChild, offset: 1 });
    });
});
