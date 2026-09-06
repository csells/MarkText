// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../muya';
import { getTextContent } from '../selection/dom';
import { getImageInfo } from '../utils/image';

const editors: Muya[] = [];

afterEach(() => {
    for (const muya of editors.splice(0)) {
        muya.destroy();
        muya.domNode.remove();
    }
});

function boot(): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host);
    muya.init();
    editors.push(muya);
    return muya;
}

describe('host inline presentation', () => {
    it('renders an empty host image as the native editable placeholder', () => {
        const muya = boot();
        muya.setInlinePresentation((_path, text, context) => {
            const widget = context.renderImage({ raw: text, range: { start: 0, end: text.length }, src: '', alt: '', title: '' });
            return widget === undefined ? text : `${widget.open}${text}${widget.close}`;
        });
        muya.setContent([{ name: 'paragraph', text: '![]()' }]);
        expect(muya.domNode.querySelector('.mu-empty-image')).not.toBeNull();
        expect(muya.domNode.textContent).toBe('![]()');
        const block = muya.editor.scrollPage?.queryBlock([0, 'text']);
        if (!block?.isContent())
            throw new Error('Missing image paragraph');
        block.setCursor(4, 4);
        const opened = vi.fn();
        muya.on('muya-image-selector', opened);
        expect(muya.showImageSelectorAtSelection()).toBe(true);
        expect(opened).toHaveBeenCalledWith(expect.objectContaining({ block }));
    });
    it('forwards exact native search ranges to the host presentation', () => {
        const muya = boot();
        const ranges = [{ start: 1, end: 3, active: true }];
        const provider = vi.fn((_path, text, _context) => text);
        muya.setInlinePresentation(provider);
        muya.setContent([{ name: 'paragraph', text: 'word' }]);
        const block = muya.editor.scrollPage?.queryBlock([0, 'text']);
        if (!block?.isContent())
            throw new Error('Missing content');
        block.update(undefined, ranges);
        expect(provider.mock.calls[provider.mock.calls.length - 1]?.[2].highlights).toEqual(ranges);
    });

    it('rejects unsafe host image destinations before starting the native loader', () => {
        const muya = boot();
        const load = vi.spyOn(muya.editor.inlineRenderer.renderer, 'loadImageAsync');
        muya.setInlinePresentation((_path, text, context) => {
            expect(context.renderImage({ raw: text, range: { start: 0, end: text.length }, src: 'javascript:alert(1)', alt: '', title: '' })).toBeUndefined();
            return text;
        });
        muya.setContent([{ name: 'paragraph', text: 'unsafe' }]);
        expect(load).not.toHaveBeenCalled();
        load.mockRestore();
    });

    it('renders a host-owned image through the native widget without reparsing its spelling', () => {
        const muya = boot();
        const load = vi.spyOn(muya.editor.inlineRenderer.renderer, 'loadImageAsync').mockReturnValue({
            id: 'host_image',
            isSuccess: true,
            url: 'https://example.com/resolved.png',
            width: 200,
            height: 200,
        });
        const source = '![**alt**][ref]';
        muya.setInlinePresentation((_path, text, context) => {
            const widget = context.renderImage({ raw: text, range: { start: 0, end: text.length }, src: 'https://example.com/resolved.png', alt: 'alt*', title: 'Title' });
            return widget === undefined ? text : `${widget.open}${text}${widget.close}`;
        });
        muya.setContent([{ name: 'paragraph', text: source }]);
        const content = muya.domNode.querySelector<HTMLElement>('.mu-paragraph-content')!;
        const widget = content.querySelector<HTMLElement>('.mu-inline-image')!;
        expect(load).toHaveBeenCalled();
        expect(widget.querySelector('img')?.getAttribute('src')).toBe('https://example.com/resolved.png');
        expect(widget.querySelector('img')?.getAttribute('alt')).toBe('alt*');
        expect(widget.getAttribute('contenteditable')).toBe('false');
        expect(content.textContent).toBe(source);
        expect(getTextContent(content, ['mu-math-render'])).toBe(source);
        expect(getImageInfo(widget).token.attrs).toMatchObject({ src: 'https://example.com/resolved.png', alt: 'alt*', title: 'Title' });
        load.mockRestore();
    });

    it('preserves isolated substitution-arm spelling instead of creating emphasis across arms', () => {
        const muya = boot();
        const observed: { path: readonly (string | number)[]; text: string }[] = [];
        muya.setInlinePresentation((path, text) => {
            observed.push({ path, text });
            if (path.length === 2 && path[0] === 0 && path[1] === 'text' && text === '*oldnew*')
                return '<span data-arm="old">*old</span><span data-arm="new">new*</span>';
            return undefined;
        });

        // The host projects {~~*old~>new*~~}; these stars belong to separate arms.
        muya.setContent('*oldnew*\n\n*ordinary*\n');

        const paragraphs = muya.domNode.querySelectorAll('.mu-paragraph-content');
        expect(paragraphs[0]?.textContent).toBe('*oldnew*');
        expect(paragraphs[0]?.querySelector('em')).toBeNull();
        expect(paragraphs[0]?.querySelector('[data-arm="old"]')?.textContent).toBe('*old');
        expect(paragraphs[1]?.querySelector('em')?.textContent).toContain('ordinary');
        expect(observed).toContainEqual({ path: [0, 'text'], text: '*oldnew*' });
        expect(observed).toContainEqual({ path: [1, 'text'], text: '*ordinary*' });
        expect(muya.getMarkdown()).toBe('*oldnew*\n\n*ordinary*\n');

        muya.setContent('*changed*\n');
        expect(muya.domNode.querySelector('.mu-paragraph-content em')?.textContent).toContain('changed');
    });

    it('removes the provider without rebuilding until the host requests another render', () => {
        const muya = boot();
        muya.setInlinePresentation(() => '<span data-host>*ordinary*</span>');
        muya.setContent('*ordinary*\n');
        expect(muya.domNode.querySelector('[data-host]')?.textContent).toBe('*ordinary*');

        muya.setInlinePresentation(undefined);
        expect(muya.domNode.querySelector('[data-host]')?.textContent).toBe('*ordinary*');
        muya.setContent('*ordinary*\n');
        expect(muya.domNode.querySelector('[data-host]')).toBeNull();
        expect(muya.domNode.querySelector('.mu-paragraph-content em')?.textContent).toContain('ordinary');
    });
});
