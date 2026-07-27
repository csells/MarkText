// @vitest-environment happy-dom

import {
    createSourceSnapshot,
    type ParseConfiguration,
} from '@marktext/document-core';
import { describe, expect, it, vi } from 'vitest';
import {
    createTestDocumentCoreView as createDocumentCoreView,
} from './testDocumentCoreSession';

const COMPLETE_CONFIGURATION: ParseConfiguration = {
    criticMarkupProfile: 'marktext-profile-1',
    markdownProfile: 'markdown-profile-1',
    markdownOptions: {
        schema: 'markdown-options-1',
        gfm: true,
        frontMatter: true,
        math: true,
        gitLabMath: true,
        footnotes: true,
        subscriptAndSuperscript: true,
    },
    liveHtmlSafetyProfile: 'live-html-sanitized-v1',
    executionBudget: {
        limitsProfile: 'test-unbounded',
        accountingSchema: 'syntax-accounting-1',
    },
};

const DESKTOP_CONFIGURATION: ParseConfiguration = {
    ...COMPLETE_CONFIGURATION,
    executionBudget: {
        limitsProfile: 'desktop-v1',
        accountingSchema: 'syntax-accounting-1',
    },
};

async function mount(
    source: string,
    parseConfiguration = COMPLETE_CONFIGURATION,
) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const view = await createDocumentCoreView({
        host,
        source: createSourceSnapshot(source),
        parseConfiguration,
    });
    return { host, view };
}

function textNodeContaining(root: Node, text: string): Text {
    const walker = root.ownerDocument?.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT,
    );
    let node = walker?.nextNode() ?? null;
    while (node) {
        if (node instanceof Text && node.data.includes(text))
            return node;

        node = walker?.nextNode() ?? null;
    }
    throw new Error(`No text node contains ${JSON.stringify(text)}`);
}

function placeCaret(node: Text, offset: number): void {
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    const selection = document.getSelection();
    if (!selection)
        throw new Error('The test document has no Selection');

    selection.removeAllRanges();
    selection.addRange(range);
}

describe('Profile 1 direct DOM', () => {
    it('fails closed instead of mounting a raw local image reference', async () => {
        const { host } = await mount('![cat](assets/cat.png)\n');

        const image = host.querySelector('img');
        expect(image).not.toBeNull();
        expect(image?.hasAttribute('src')).toBe(false);
    });

    it('mounts a local image only through the host presentation authority', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const resolveImageSource = vi.fn(async (request: Readonly<{
            revisionId: string;
            reference: string;
        }>) => {
            expect(request.revisionId.length).toBeGreaterThan(0);
            expect(request.reference).toBe('assets/cat.png');
            return Object.freeze({
                kind: 'resolved' as const,
                src: 'marktext-image://asset/opaque-capability',
            });
        });
        const view = await createDocumentCoreView({
            host,
            source: createSourceSnapshot('![cat](assets/cat.png)\n'),
            parseConfiguration: COMPLETE_CONFIGURATION,
            resolveImageSource,
        });

        await view.settled();

        expect(resolveImageSource).toHaveBeenCalledTimes(1);
        expect(host.querySelector('img')?.getAttribute('src'))
            .toBe('marktext-image://asset/opaque-capability');
    });

    it('preserves remote, data, and blob image sources without host resolution', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const resolveImageSource = vi.fn();
        const view = await createDocumentCoreView({
            host,
            source: createSourceSnapshot(
                '![](https://example.test/cat.png) '
                + '![](data:image/png;base64,AA==) '
                + '![](blob:https://example.test/id)\n',
            ),
            parseConfiguration: COMPLETE_CONFIGURATION,
            resolveImageSource,
        });

        await view.settled();

        expect(resolveImageSource).not.toHaveBeenCalled();
        expect(
            [...host.querySelectorAll('img')].map(image =>
                image.getAttribute('src')),
        ).toEqual([
            'https://example.test/cat.png',
            'data:image/png;base64,AA==',
            'blob:https://example.test/id',
        ]);
    });

    it('cannot mount a display capability resolved for a stale revision', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        let releaseFirst: ((value: Readonly<{
            kind: 'resolved';
            src: string;
        }>) => void) | undefined;
        let call = 0;
        const resolveImageSource = vi.fn(() => {
            call += 1;
            if (call === 1) {
                return new Promise<Readonly<{
                    kind: 'resolved';
                    src: string;
                }>>((resolve) => {
                    releaseFirst = resolve;
                });
            }
            return Promise.resolve(Object.freeze({
                kind: 'resolved' as const,
                src: 'marktext-image://asset/current-capability',
            }));
        });
        const view = await createDocumentCoreView({
            host,
            source: createSourceSnapshot('![cat](assets/cat.png)\n'),
            parseConfiguration: COMPLETE_CONFIGURATION,
            resolveImageSource,
        });

        await view.typeText(view.modelText().length, 'x');
        releaseFirst?.(Object.freeze({
            kind: 'resolved',
            src: 'marktext-image://asset/stale-capability',
        }));
        await view.settled();

        expect(resolveImageSource).toHaveBeenCalledTimes(2);
        expect(host.querySelector('img')?.getAttribute('src'))
            .toBe('marktext-image://asset/current-capability');
    });

    it('mounts inline semantics without exposing Markdown delimiters', async () => {
        const { host } = await mount(
            '# *em* **strong** ~~gone~~ H~2~O 2^n^ ' +
            '[link](https://example.test) ![alt](image.png) `code` $x$\n',
        );

        const heading = host.querySelector('h1');
        expect(heading?.querySelector('em')?.textContent).toBe('em');
        expect(heading?.querySelector('strong')?.textContent).toBe('strong');
        expect(heading?.querySelector('del')?.textContent).toBe('gone');
        expect(heading?.querySelector('sub')?.textContent).toBe('2');
        expect(heading?.querySelector('sup')?.textContent).toBe('n');
        expect(heading?.querySelector('a')).toMatchObject({
            textContent: 'link',
        });
        expect(heading?.querySelector('a')?.getAttribute('href'))
            .toBe('https://example.test');
        expect(heading?.querySelector('img')?.getAttribute('alt')).toBe('alt');
        expect(heading?.querySelector('code')?.textContent).toBe('code');
        expect(heading?.querySelector('.math-inline')?.textContent).toBe('x');
        expect(heading?.textContent).not.toMatch(
            /#|\*\*|~~|\]\(|image\.png|`|\$x\$/,
        );
    });

    it('mounts nested lists and tables from the parser-owned tree', async () => {
        const { host } = await mount(
            '- outer\n  - inner\n\n' +
            '| a | b |\n| --- | :---: |\n| c | d |\n',
        );

        expect(host.querySelector('ul > li > ul > li')?.textContent)
            .toContain('inner');
        expect(host.querySelectorAll('table thead th')).toHaveLength(2);
        expect(host.querySelectorAll('table tbody td')).toHaveLength(2);
        expect(host.querySelector('table thead th:nth-child(2)')
            ?.getAttribute('align')).toBe('center');
    });

    it('mounts safe math and diagram fallbacks from parser-owned content', async () => {
        const { host } = await mount(
            '$$\na < b\n$$\n\n```mermaid\n<script>x</script>\n```\n',
        );

        expect(host.querySelector('.math-block code')?.textContent)
            .toBe('a < b\n');
        const diagram = host.querySelector('.diagram');
        expect(diagram?.getAttribute('data-language')).toBe('mermaid');
        expect(diagram?.querySelector('code')?.textContent)
            .toBe('<script>x</script>\n');
        expect(diagram?.querySelector('script')).toBeNull();
    });

    it('mounts and edits SourceOnly as exact raw source', async () => {
        const source = `${'> '.repeat(129)}text\r\n`;
        const { host, view } = await mount(source, DESKTOP_CONFIGURATION);

        expect(host.dataset.documentMode).toBe('source-only');
        expect(host.textContent).toBe(source);
        expect(host.getAttribute('contenteditable')).toBe('true');
        expect(view.getMarkdownSync()).toBe(source);

        await view.typeText(source.length, '!');
        expect(view.getMarkdownSync()).toBe(`${source}!`);
        expect(host.textContent).toBe(`${source}!`);
        await view.undo();
        expect(view.getMarkdownSync()).toBe(source);
    });

    it('mounts every Profile 1 block semantic and hides non-rendering syntax', async () => {
        const source =
            '---\ntitle: hidden\n---\n\n'
            + '# Heading\n\n'
            + '> quote\n\n'
            + '1. ordered\n2. second\n\n'
            + '- [x] complete\n- [ ] open\n\n'
            + '---\n\n'
            + '    indented <code>\n\n'
            + '<div>unsafe block</div>\n\n'
            + '[target]: https://example.test "Title"\n\n'
            + 'Reference [link][target].\n\n'
            + '[^note]: Footnote *body*.\n\n'
            + 'Use note[^note].\n';
        const { host } = await mount(source);

        expect(host.getAttribute('data-markdown-kind')).toBe('document');
        expect(host.querySelector('h1')?.textContent).toBe('Heading');
        expect(host.querySelector('blockquote p')?.textContent).toBe('quote');
        expect(host.querySelector('ol')?.getAttribute('start')).toBeNull();
        expect(host.querySelectorAll(
            'ol.document-view-list > li.document-view-list-item',
        )).toHaveLength(2);
        expect(host.querySelectorAll('li.task-list-item input')).toHaveLength(2);
        expect(
            (host.querySelector('li.task-list-item input') as HTMLInputElement)
                .checked,
        ).toBe(true);
        expect(host.querySelector('hr')).not.toBeNull();
        expect(host.querySelector('pre code')?.textContent)
            .toContain('indented <code>');
        expect(host.querySelector('.html-block code')?.textContent)
            .toBe('<div>unsafe block</div>\n');
        expect(host.querySelector('.html-block div')).toBeNull();
        expect(host.querySelector('a[href="https://example.test"]')
            ?.textContent).toBe('link');
        expect(host.querySelector('.footnote-ref a')?.textContent).toBe('1');
        expect(host.querySelector('.footnotes li em')?.textContent).toBe('body');
        expect(host.querySelector('.footnote-backref')).not.toBeNull();
        expect(host.textContent).not.toContain('title: hidden');
        expect(host.textContent).not.toContain('[target]:');
        expect(host.textContent).not.toContain('[^note]:');
    });

    it('commits a task checkbox gesture with configured cascade as one undo step', async () => {
        const source =
            '- [ ] parent\n\n'
            + '  - [ ] child1\n'
            + '  - [ ] child2\n';
        const { host, view } = await mount(source);
        view.setOptions({ autoCheckTasks: true });

        const checkboxes = [
            ...host.querySelectorAll<HTMLInputElement>(
                'input.document-view-task-list-checkbox',
            ),
        ];
        expect(checkboxes).toHaveLength(3);
        expect(checkboxes.every(checkbox => !checkbox.disabled)).toBe(true);
        view.setLocale({
            name: 'task-test',
            resource: {
                'Completed task': 'Terminée',
                'Incomplete task': 'Ouverte',
            },
        });
        expect(checkboxes.map(checkbox =>
            checkbox.getAttribute('aria-label'))).toEqual([
            'Ouverte',
            'Ouverte',
            'Ouverte',
        ]);

        checkboxes[0]?.click();
        await view.settled();

        expect(view.getMarkdownSync()).toBe(
            '- [x] parent\n\n'
            + '  - [x] child1\n'
            + '  - [x] child2\n',
        );
        expect([
            ...host.querySelectorAll<HTMLInputElement>(
                'input.document-view-task-list-checkbox',
            ),
        ].map(checkbox => checkbox.checked)).toEqual([true, true, true]);
        expect([
            ...host.querySelectorAll<HTMLInputElement>(
                'input.document-view-task-list-checkbox',
            ),
        ].map(checkbox => checkbox.getAttribute('aria-label'))).toEqual([
            'Terminée',
            'Terminée',
            'Terminée',
        ]);

        await view.undo();
        expect(view.getMarkdownSync()).toBe(source);
    });

    it('mounts every Profile 1 inline semantic with inert HTML and safe URLs', async () => {
        const { host } = await mount(
            'plain  \nnext *em* **strong** ~~strike~~ H~2~ 2^n^ '
            + '[unsafe](javascript:alert(1) "title") '
            + '![a &amp; b](image.png) '
            + '<https://example.test> <span>raw</span> '
            + '` code ` $x < y$ &amp; \\*.\n',
        );

        expect(host.querySelector('br')).not.toBeNull();
        expect(host.querySelector('[data-markdown-kind="hard-break"]'))
            .not.toBeNull();
        expect(host.querySelector('em')?.textContent).toBe('em');
        expect(host.querySelector('strong')?.textContent).toBe('strong');
        expect(host.querySelector('del')?.textContent).toBe('strike');
        expect(host.querySelector('sub')?.textContent).toBe('2');
        expect(host.querySelector('sup')?.textContent).toBe('n');
        const unsafe = host.querySelector('a[title="title"]');
        expect(unsafe?.getAttribute('href')).toBe('');
        expect(host.querySelector('img')?.getAttribute('alt')).toBe('a & b');
        expect(host.querySelector('img')?.hasAttribute('src')).toBe(false);
        expect(host.querySelector('a[href="https://example.test"]')
            ?.textContent).toBe('https://example.test');
        expect(host.querySelector('.html-inline')?.textContent)
            .toBe('<span>');
        expect(host.querySelector(
            '.html-inline span:not(.document-view-run)',
        )).toBeNull();
        expect(host.querySelector('code:not(.html-inline)')?.textContent)
            .toBe('code');
        expect(host.querySelector('.math-inline')?.textContent).toBe('x < y');
        expect(host.textContent).toContain('& *.');
    });

    it('mounts soft breaks and preserves CriticMarkup around nested semantics', async () => {
        const { host } = await mount(
            '# {++*new* and ![safe](image.png)++}\n\nsoft\nbreak\n',
        );

        expect(host.querySelector(
            '[data-markdown-kind="soft-break"]',
        )?.textContent).toBe('\n');
        expect(host.querySelector('h1 em ins')?.textContent).toBe('new');
        expect(host.querySelector('h1 ins img')?.hasAttribute('src'))
            .toBe(false);
        expect(host.textContent).not.toContain('{++');
    });

    it.each([
        {
            source: 'A \\* B\n',
            visible: '*',
            caretUnits: 1,
            expected: 'A \\*X B\n',
        },
        {
            source: 'A &amp; B\n',
            visible: '&',
            caretUnits: 1,
            expected: 'A &amp;X B\n',
        },
        {
            source: 'A &#x1D11E; B\n',
            visible: '𝄞',
            // The interior UTF-16 boundary of one decoded astral entity maps
            // to the entity's source start, exactly as the former vector did.
            caretUnits: 1,
            expected: 'A X&#x1D11E; B\n',
        },
    ])(
        'uses parser-issued offsets when rendered length differs: $source',
        async ({ source, visible, caretUnits, expected }) => {
            const { host, view } = await mount(source);
            const node = textNodeContaining(host, visible);
            placeCaret(node, node.data.indexOf(visible) + caretUnits);
            const event = new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                data: 'X',
                inputType: 'insertText',
            });

            expect(host.dispatchEvent(event)).toBe(false);
            await view.settled();
            expect(view.getMarkdownSync()).toBe(expected);
            await view.undo();
            expect(view.getMarkdownSync()).toBe(source);
        },
    );

    it('supports SourceOnly browser input, selection, redo, save, and recovery', async () => {
        const source = `${'> '.repeat(129)}text\r\n`;
        const { host, view } = await mount(source, DESKTOP_CONFIGURATION);
        const raw = textNodeContaining(host, source);
        placeCaret(raw, source.length);
        const event = new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data: '!',
            inputType: 'insertText',
        });
        expect(host.dispatchEvent(event)).toBe(false);
        await view.settled();
        expect(view.getSelection()).toEqual({
            start: source.length + 1,
            end: source.length + 1,
        });
        expect(await view.getMarkdown()).toBe(`${source}!`);
        expect(view.getReviewIndex()).toMatchObject({
            authoring: {
                canCreateAddition: false,
                canCreateDeletion: false,
                canCreateSubstitution: false,
                canCreateHighlight: false,
                canCreateComment: false,
            },
            items: [],
            commentedSpans: [],
        });
        expect(view.getTOC()).toEqual([]);

        await view.undo();
        expect(host.dataset.documentMode).toBe('source-only');
        expect(host.textContent).toBe(source);
        await view.redo();
        expect(host.textContent).toBe(`${source}!`);

        await view.deleteRange(0, 2);
        expect(host.dataset.documentMode).toBe('semantic');
        expect(view.getMarkdownSync()).toBe(`${source.slice(2)}!`);
        expect(host.textContent).not.toContain('> >');

        await view.undo();
        expect(host.dataset.documentMode).toBe('source-only');
        expect(host.textContent).toBe(`${source}!`);
    });
});
