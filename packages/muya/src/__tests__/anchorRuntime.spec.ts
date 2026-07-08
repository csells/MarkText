// @vitest-environment happy-dom

import type Content from '../block/base/content';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../muya';

// P3 stage 2 (specs/architecture/comment-anchors.md): the engine cutover.
// After load, MC bytes exist nowhere in the editable document — not in state
// leaf text, not in the rendered DOM (invariant 1). getMarkdown materializes
// them back (invariant 2). getComments reads the model. Mutations and undo
// keep working across the cutover.

const hosts: HTMLElement[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (hosts.length)
        hosts.pop()!.remove();
    document.getSelection()?.removeAllRanges();
});

function boot(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    hosts.push(muya.domNode);
    return muya;
}

const HEAD = '[MC:a]: {"version":2,"status":"open","authors":["Ada"],"createdAt":"2026-07-07T09:00:00.000Z"}';
const REPLY_0 = '[MC:a.0]: {"author":"Ada","createdAt":"2026-07-07T09:00:00.000Z","body":"First"}';
const DOC = `Hello <!--MC:a-->reviewed<!--MC:~a--> world.\n\n${HEAD}\n${REPLY_0}\n`;

function collectStateTexts(states: unknown[]): string[] {
    const texts: string[] = [];
    const walk = (nodes: unknown[]) => {
        for (const node of nodes as Array<Record<string, unknown>>) {
            if (typeof node.text === 'string')
                texts.push(node.text);
            if (Array.isArray(node.children))
                walk(node.children);
        }
    };
    walk(states);
    return texts;
}

describe('anchor runtime — no MC bytes at runtime (invariant 1)', () => {
    it('keeps every state leaf clean after load', () => {
        const muya = boot(DOC);

        for (const text of collectStateTexts(muya.editor.jsonState.getState())) {
            expect(text).not.toContain('<!--MC:');
            expect(text).not.toMatch(/^ {0,3}\[MC:/u);
        }
    });

    it('renders no marker or metadata DOM', () => {
        const muya = boot(DOC);

        expect(muya.domNode.innerHTML).not.toContain('MC:');
        expect(muya.domNode.querySelectorAll('.mu-comment-marker').length).toBe(0);
        expect(muya.domNode.querySelectorAll('.mu-comment-metadata').length).toBe(0);
        // The visible text is the clean text.
        expect(muya.domNode.textContent).toContain('Hello reviewed world.');
        expect(muya.domNode.textContent).not.toContain('[MC:');
    });

    it('still highlights the commented range from anchors', () => {
        const muya = boot(DOC);

        const highlight = muya.domNode.querySelector('.mu-comment-highlight');
        expect(highlight).not.toBeNull();
        expect(highlight?.textContent).toBe('reviewed');
    });
});

describe('anchor runtime — serialization (invariant 2)', () => {
    it('getMarkdown materializes byte-identically with no edits', () => {
        const muya = boot(DOC);

        expect(muya.getMarkdown()).toBe(DOC);
    });

    it('keeps a mid-document definition block at its position through the runtime', () => {
        const midDoc = [
            'alpha <!--MC:a-->x<!--MC:~a-->',
            '',
            '[MC:a]: {"version":2,"status":"open"}',
            '',
            'omega',
            '',
        ].join('\n');
        const muya = boot(midDoc);

        expect(muya.getMarkdown()).toBe(midDoc);
    });

    it('an edit elsewhere leaves a mid-document definition block in place', () => {
        const midDoc = [
            'alpha <!--MC:a-->x<!--MC:~a-->',
            '',
            '[MC:a]: {"version":2,"status":"open"}',
            '',
            'omega',
            '',
        ].join('\n');
        const muya = boot(midDoc);
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;

        leaf.text = `ZZ${leaf.text}`;
        muya.flush();

        expect(muya.getMarkdown()).toBe([
            'ZZalpha <!--MC:a-->x<!--MC:~a-->',
            '',
            '[MC:a]: {"version":2,"status":"open"}',
            '',
            'omega',
            '',
        ].join('\n'));
    });

    it('serializes a v1 document as v2 with identical decoded content', () => {
        const v1 = 'Hello <!--MC:a-->x<!--MC:~a--> world.\n\n[MC:a]: data:application/json;base64,eyJ2ZXJzaW9uIjoxLCJzdGF0dXMiOiJvcGVuIiwicmVwbGllcyI6W119\n';
        const muya = boot(v1);

        const output = muya.getMarkdown();
        expect(output).toContain('Hello <!--MC:a-->x<!--MC:~a--> world.');
        expect(output).toContain('[MC:a]: {"version":2,"status":"open"}');
        expect(output).not.toContain('data:application/json;base64,');
    });
});

describe('anchor runtime — model reads', () => {
    it('getComments serves threads and clean-offset ranges from the model', () => {
        const muya = boot(DOC);

        const comments = muya.getComments();
        expect(comments.diagnostics).toEqual([]);
        expect(comments.threads).toEqual([
            {
                id: 'a',
                status: 'open',
                authors: ['Ada'],
                createdAt: '2026-07-07T09:00:00.000Z',
                updatedAt: '2026-07-07T09:00:00.000Z',
                replies: [
                    {
                        author: 'Ada',
                        createdAt: '2026-07-07T09:00:00.000Z',
                        body: 'First',
                    },
                ],
            },
        ]);
        expect(comments.ranges).toEqual([
            {
                id: 'a',
                startPath: [0, 'text'],
                endPath: [0, 'text'],
                startOffset: 'Hello '.length,
                endOffset: 'Hello reviewed'.length,
                preview: 'reviewed',
            },
        ]);
    });

    it('reports a detached thread as orphan-metadata, never dropping it', () => {
        const muya = boot(`No markers here.\n\n${HEAD}\n`);

        const comments = muya.getComments();
        expect(comments.threads).toEqual([]);
        expect(comments.ranges).toEqual([]);
        expect(comments.diagnostics).toContainEqual(expect.objectContaining({
            code: 'orphan-metadata',
            id: 'a',
        }));
        // The detached thread still serializes.
        expect(muya.getMarkdown()).toContain('[MC:a]: {"version":2,"status":"open"');
    });

    it('reports anchors without metadata as missing-metadata', () => {
        const muya = boot('Hello <!--MC:x-->reviewed<!--MC:~x--> world.\n');

        expect(muya.getComments().diagnostics).toContainEqual(expect.objectContaining({
            code: 'missing-metadata',
            id: 'x',
        }));
    });
});

describe('anchor runtime — typing moves anchors (transform hook)', () => {
    it('typing before a comment shifts its range', () => {
        const muya = boot(DOC);
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;

        // Simulate a keystroke at the very start of the paragraph.
        leaf.text = `XX${leaf.text}`;
        muya.flush();

        const range = muya.getComments().ranges[0];
        expect(range.startOffset).toBe('XXHello '.length);
        expect(range.endOffset).toBe('XXHello reviewed'.length);
        expect(muya.getMarkdown()).toContain('XXHello <!--MC:a-->reviewed<!--MC:~a--> world.');
    });

    it('typing inside a comment grows its range', () => {
        const muya = boot(DOC);
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;

        leaf.text = leaf.text.replace('reviewed', 'reviewedZZ');
        muya.flush();

        expect(muya.getMarkdown()).toContain('<!--MC:a-->reviewedZZ<!--MC:~a-->');
    });

    it('deleting a whole commented range detaches the thread instead of dropping it', () => {
        const muya = boot(DOC);
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;

        leaf.text = 'Hello  world.';
        muya.flush();

        const comments = muya.getComments();
        expect(comments.ranges).toEqual([]);
        expect(comments.diagnostics).toContainEqual(expect.objectContaining({
            code: 'orphan-metadata',
            id: 'a',
        }));
        // The thread's words survive in the serialized metadata.
        expect(muya.getMarkdown()).toContain('"body":"First"');
    });
});

describe('anchor runtime — mutations and undo across the cutover', () => {
    it('addComment anchors a selection and getMarkdown emits v2 bytes', () => {
        const muya = boot('A reviewed span.\n');
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;
        leaf.setCursor(2, 10, true);

        expect(muya.addComment({
            id: 'cmt_test',
            author: 'Ada',
            body: 'Please check this.',
            createdAt: '2026-06-30T12:00:00.000Z',
        })).toBe('cmt_test');

        // Runtime stays clean…
        for (const text of collectStateTexts(muya.editor.jsonState.getState()))
            expect(text).not.toContain('<!--MC:');
        // …while serialization carries the new thread.
        const markdown = muya.getMarkdown();
        expect(markdown).toContain('A <!--MC:cmt_test-->reviewed<!--MC:~cmt_test--> span.');
        expect(markdown).toContain('[MC:cmt_test]: {"version":2,"status":"open"');

        muya.undo();
        expect(muya.getMarkdown()).toBe('A reviewed span.\n');
        expect(muya.getComments().threads).toEqual([]);
    });

    it('resolveComment updates the model and undo restores it', () => {
        const muya = boot(DOC);

        expect(muya.resolveComment('a', '2026-07-07T10:00:00.000Z')).toBe(true);
        expect(muya.getComments().threads[0].status).toBe('resolved');
        expect(muya.getMarkdown()).toContain('"status":"resolved"');

        muya.undo();
        expect(muya.getComments().threads[0].status).toBe('open');
    });

    it('removeComment removes anchors and thread, and undo restores both', () => {
        const muya = boot(DOC);

        expect(muya.removeComment('a')).toBe(true);
        expect(muya.getComments().threads).toEqual([]);
        expect(muya.getMarkdown()).not.toContain('MC:');

        muya.undo();
        const restored = muya.getComments();
        expect(restored.threads[0]?.id).toBe('a');
        expect(restored.ranges[0]?.preview).toBe('reviewed');
        expect(muya.getMarkdown()).toBe(DOC);
    });

    it('undoing a range-swallowing deletion restores the range from the history snapshot', () => {
        const muya = boot(DOC);
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;

        leaf.text = 'Hello  world.';
        muya.flush();
        expect(muya.getComments().ranges).toEqual([]);

        muya.undo();
        const restored = muya.getComments();
        expect(restored.ranges[0]?.preview).toBe('reviewed');
        expect(muya.getMarkdown()).toBe(DOC);
    });

    it('undoing a text edit restores anchor positions (undo symmetry)', () => {
        const muya = boot(DOC);
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;

        leaf.text = `XX${leaf.text}`;
        muya.flush();
        expect(muya.getComments().ranges[0].startOffset).toBe('XXHello '.length);

        muya.undo();
        expect(muya.getComments().ranges[0].startOffset).toBe('Hello '.length);
        expect(muya.getMarkdown()).toBe(DOC);
    });
});
