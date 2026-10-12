// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { CLASS_NAMES } from '../../../../config';
import AtxHeadingContent from '../index';

// A heading's `#`s and the space after them are hidden until the caret
// enters it. While they are, a caret before their end sits in syntax the
// user cannot see, so a click or a new document's caret goes after them.

function headingWithMarker(text: string, markerClass: string) {
    const domNode = document.createElement('span');
    const marker = document.createElement('span');
    marker.className = `${markerClass} ${CLASS_NAMES.MU_REMOVE}`;
    domNode.append(marker);
    return { text, domNode } as unknown as AtxHeadingContent;
}

const end = (content: AtxHeadingContent) => AtxHeadingContent.prototype.hiddenLeadingSyntaxEnd.call(content);

describe('atxHeadingContent.hiddenLeadingSyntaxEnd', () => {
    it('ends after the hidden `#`s and their spaces', () => {
        expect(end(headingWithMarker('## Third heading', CLASS_NAMES.MU_HIDE))).toBe(3);
        expect(end(headingWithMarker('###### Level six', CLASS_NAMES.MU_HIDE))).toBe(7);
        expect(end(headingWithMarker('  #   Spaced', CLASS_NAMES.MU_HIDE))).toBe(6);
        expect(end(headingWithMarker('#', CLASS_NAMES.MU_HIDE))).toBe(1);
    });

    it('is 0 while the `#`s are shown, so a caret there still edits them', () => {
        expect(end(headingWithMarker('## Third heading', CLASS_NAMES.MU_GRAY))).toBe(0);
    });
});
