// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { Muya } from '../muya';

const hosts: HTMLElement[] = [];

afterEach(() => {
    for (const host of hosts.splice(0))
        host.remove();
});

function boot(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, {
        markdown,
    } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    hosts.push(muya.domNode);
    return muya;
}

describe('muya editable content paths', () => {
    it('keeps unbound paragraphs locked across a whole-document rebuild', () => {
        const muya = boot('locked\n\neditable\n');

        muya.setEditablePaths([[1, 'text']]);
        let paragraphs = muya.domNode.querySelectorAll<HTMLElement>(
            'span.mu-paragraph-content',
        );
        expect(paragraphs[0]?.getAttribute('contenteditable')).toBe('false');
        expect(paragraphs[1]?.getAttribute('contenteditable')).toBe('true');

        muya.setContent('locked again\n\neditable again\n');
        paragraphs = muya.domNode.querySelectorAll<HTMLElement>(
            'span.mu-paragraph-content',
        );
        expect(paragraphs[0]?.getAttribute('contenteditable')).toBe('false');
        expect(paragraphs[1]?.getAttribute('contenteditable')).toBe('true');

        expect(muya.replaceContent('replaced\n\nstill editable\n')).toBe(true);
        paragraphs = muya.domNode.querySelectorAll<HTMLElement>(
            'span.mu-paragraph-content',
        );
        expect(paragraphs[0]?.getAttribute('contenteditable')).toBe('false');
        expect(paragraphs[1]?.getAttribute('contenteditable')).toBe('true');

        muya.setOptions({ texMathDollars: false }, true);
        paragraphs = muya.domNode.querySelectorAll<HTMLElement>(
            'span.mu-paragraph-content',
        );
        expect(paragraphs[0]?.getAttribute('contenteditable')).toBe('false');
        expect(paragraphs[1]?.getAttribute('contenteditable')).toBe('true');

        muya.locale({ name: 'locked-test', resource: {} });
        paragraphs = muya.domNode.querySelectorAll<HTMLElement>(
            'span.mu-paragraph-content',
        );
        expect(paragraphs[0]?.getAttribute('contenteditable')).toBe('false');
        expect(paragraphs[1]?.getAttribute('contenteditable')).toBe('true');

        muya.setEditablePaths(null);
        expect(paragraphs[0]?.getAttribute('contenteditable')).toBe('true');
        expect(paragraphs[1]?.getAttribute('contenteditable')).toBe('true');
    });
});

it('does not toggle live editability when the authority repeats the same paths', async () => {
    const muya = boot('locked\n\neditable\n');
    try {
        muya.setEditablePaths([[1, 'text']]);
        const records: MutationRecord[] = [];
        const observer = new MutationObserver(changes => records.push(...changes));
        observer.observe(muya.domNode, { subtree: true, attributes: true, attributeFilter: ['contenteditable'] });
        muya.setEditablePaths([[1, 'text']]);
        await new Promise(resolve => setTimeout(resolve, 0));
        observer.disconnect();
        expect(records).toHaveLength(0);
    }
    finally {
        muya.destroy();
    }
});

it('asks a path source only for the roots a regional update changes', () => {
    const muya = boot('first\n\nsecond\n\nthird\n');
    try {
        const asked: (readonly [number, number] | undefined)[] = [];
        muya.setEditablePaths((roots) => {
            asked.push(roots);
            // A regional answer lists only the paths under its roots.
            return roots === undefined ? [[0, 'text'], [2, 'text']] : [[1, 'text']];
        });
        muya.setEditablePaths((roots) => {
            asked.push(roots);
            return roots === undefined ? [[0, 'text'], [1, 'text'], [2, 'text']] : [[1, 'text']];
        }, [1, 2]);
        const paragraphs = muya.domNode.querySelectorAll<HTMLElement>('span.mu-paragraph-content');
        expect(asked).toEqual([undefined, [1, 2]]);
        expect([...paragraphs].map(paragraph => paragraph.getAttribute('contenteditable')))
            .toEqual(['true', 'true', 'true']);
    }
    finally {
        muya.destroy();
    }
});

it('asks a path source only for the items of one list a regional update changes', () => {
    const muya = boot('- one\n- two\n- three\n- four\n');
    try {
        const asked: unknown[] = [];
        muya.setEditablePaths([]);
        const contents = () => [...muya.domNode.querySelectorAll<HTMLElement>('span.mu-paragraph-content')]
            .map(content => content.getAttribute('contenteditable'));
        expect(contents()).toEqual(['false', 'false', 'false', 'false']);
        // The source's answer for items [1, 3) only: the other items keep their policy.
        muya.setEditablePaths((roots, items) => {
            asked.push([roots, items]);
            return [[0, 'children', 0, 'children', 0, 'text'], [0, 'children', 2, 'children', 0, 'text']];
        }, [0, 1], [1, 3]);
        expect(asked).toEqual([[[0, 1], [1, 3]]]);
        expect(contents()).toEqual(['false', 'false', 'true', 'false']);
    }
    finally {
        muya.destroy();
    }
});
