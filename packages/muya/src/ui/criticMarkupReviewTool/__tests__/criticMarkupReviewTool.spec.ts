// @vitest-environment happy-dom

import type { ICriticMarkupItem } from '../../../criticMarkup/commands';
import type { Muya } from '../../../muya';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CriticMarkupReviewTool } from '..';
import EventCenter from '../../../event';
import { Muya as RealMuya } from '../../../muya';

const tools: CriticMarkupReviewTool[] = [];
const editors: RealMuya[] = [];
const eventCenters: EventCenter[] = [];

afterEach(() => {
    while (tools.length)
        tools.pop()!.destroy();
    while (editors.length)
        editors.pop()!.destroy();
    while (eventCenters.length) {
        const eventCenter = eventCenters.pop()!;
        eventCenter.detachAllDomEvents();
        eventCenter.unsubscribeAll();
    }
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

function reviewItem(
    type: ICriticMarkupItem['type'],
    id = `critic-${type}`,
): ICriticMarkupItem {
    const common = {
        id,
        type,
        path: [0, 'text'],
        start: 0,
        end: 9,
        sourceStart: 0,
        sourceEnd: 9,
        raw: type === 'substitution' ? '{~~old~>new~~}' : `{++value++}`,
        fragments: [],
    };

    return type === 'substitution'
        ? { ...common, oldContent: 'old', newContent: 'new' }
        : { ...common, content: type === 'comment' ? 'note' : 'value' };
}

function reference(): HTMLElement {
    const element = document.createElement('span');
    element.getBoundingClientRect = () => ({
        top: 0,
        left: 0,
        right: 10,
        bottom: 10,
        width: 10,
        height: 10,
        x: 0,
        y: 0,
        toJSON: () => '',
    }) as DOMRect;
    document.body.appendChild(element);
    return element;
}

function fakeMuya(item: ICriticMarkupItem) {
    const eventCenter = new EventCenter();
    eventCenters.push(eventCenter);
    const domNode = document.createElement('div');
    const anchorDomNode = document.createElement('span');
    domNode.appendChild(anchorDomNode);
    document.body.appendChild(domNode);
    const resolveCriticMarkup = vi.fn(() => true);
    const getCurrentCriticMarkupItem = vi.fn(() => item);
    const muya = {
        domNode,
        eventCenter,
        options: { criticMarkupProjection: 'marked' },
        i18n: { t: (key: string) => key },
        editor: {
            selection: {
                anchorBlock: { domNode: anchorDomNode },
            },
        },
        getCurrentCriticMarkupItem,
        resolveCriticMarkup,
    } as unknown as Muya;

    return {
        anchorDomNode,
        eventCenter,
        getCurrentCriticMarkupItem,
        muya,
        resolveCriticMarkup,
    };
}

async function settleFloat() {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    await new Promise(resolve => setTimeout(resolve, 0));
}

describe('criticMarkupReviewTool', () => {
    it('exposes a stable plugin name', () => {
        expect(CriticMarkupReviewTool.pluginName).toBe('criticMarkupReviewTool');
    });

    it.each(['addition', 'deletion', 'substitution'] as const)(
        'renders Accept and Reject for a %s',
        async (type) => {
            const item = reviewItem(type);
            const { eventCenter, muya } = fakeMuya(item);
            const tool = new CriticMarkupReviewTool(muya);
            tools.push(tool);

            eventCenter.emit('muya-critic-markup-tool', {
                item,
                reference: reference(),
            });
            await settleFloat();

            expect([...tool.container!.querySelectorAll('button')]
                .map(button => button.textContent)).toEqual(['Accept', 'Reject']);
            expect(tool.status).toBe(true);
        },
    );

    it.each(['highlight', 'comment'] as const)(
        'renders one Remove action for a %s',
        async (type) => {
            const item = reviewItem(type);
            const { eventCenter, muya } = fakeMuya(item);
            const tool = new CriticMarkupReviewTool(muya);
            tools.push(tool);

            eventCenter.emit('muya-critic-markup-tool', {
                item,
                reference: reference(),
            });
            await settleFloat();

            expect([...tool.container!.querySelectorAll('button')]
                .map(button => button.textContent)).toEqual(['Remove']);
        },
    );

    it.each([
        ['accept', 'accept'],
        ['reject', 'reject'],
    ] as const)('routes the %s button through current-item native resolution', async (label, decision) => {
        const item = reviewItem('addition');
        const { eventCenter, muya, resolveCriticMarkup } = fakeMuya(item);
        const tool = new CriticMarkupReviewTool(muya);
        tools.push(tool);
        eventCenter.emit('muya-critic-markup-tool', {
            item,
            reference: reference(),
        });
        await settleFloat();

        const button = tool.container!.querySelector(`button.${label}`) as HTMLButtonElement;
        button.click();

        expect(resolveCriticMarkup).toHaveBeenCalledWith(decision);
        expect(tool.status).toBe(false);
    });

    it('uses accept to remove a comment annotation', async () => {
        const item = reviewItem('comment');
        const { eventCenter, muya, resolveCriticMarkup } = fakeMuya(item);
        const tool = new CriticMarkupReviewTool(muya);
        tools.push(tool);
        eventCenter.emit('muya-critic-markup-tool', {
            item,
            reference: reference(),
        });
        await settleFloat();

        (tool.container!.querySelector('button.remove') as HTMLButtonElement).click();

        expect(resolveCriticMarkup).toHaveBeenCalledWith('accept');
    });

    it('opens from a parser-native current item after an editor click', async () => {
        const item = reviewItem('deletion');
        const { getCurrentCriticMarkupItem, muya } = fakeMuya(item);
        const tool = new CriticMarkupReviewTool(muya);
        tools.push(tool);

        muya.domNode.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await settleFloat();

        expect(getCurrentCriticMarkupItem).toHaveBeenCalled();
        expect(tool.status).toBe(true);
    });

    it('hides when the selection or document changes', async () => {
        const item = reviewItem('addition');
        const { eventCenter, muya } = fakeMuya(item);
        const tool = new CriticMarkupReviewTool(muya);
        tools.push(tool);
        eventCenter.emit('muya-critic-markup-tool', {
            item,
            reference: reference(),
        });
        await settleFloat();
        expect(tool.status).toBe(true);

        eventCenter.emit('selection-change', {});
        expect(tool.status).toBe(false);

        eventCenter.emit('muya-critic-markup-tool', {
            item,
            reference: reference(),
        });
        await settleFloat();
        eventCenter.emit('json-change', {});
        expect(tool.status).toBe(false);
    });

    it('does not open outside the canonical marked projection', async () => {
        const item = reviewItem('addition');
        const { eventCenter, muya } = fakeMuya(item);
        muya.options.criticMarkupProjection = 'revised';
        const tool = new CriticMarkupReviewTool(muya);
        tools.push(tool);

        eventCenter.emit('muya-critic-markup-tool', {
            item,
            reference: reference(),
        });
        await settleFloat();

        expect(tool.status).toBe(false);
    });

    it('exposes labeled group semantics on the floating container', async () => {
        const item = reviewItem('addition');
        const { eventCenter, muya } = fakeMuya(item);
        const tool = new CriticMarkupReviewTool(muya);
        tools.push(tool);

        eventCenter.emit('muya-critic-markup-tool', {
            item,
            reference: reference(),
        });
        await settleFloat();

        const container = tool.container!;
        expect(container.getAttribute('role')).toBe('group');
        // The i18n fallback returns the key itself, so the accessible name is
        // present for every locale even before a translation lands.
        expect(container.getAttribute('aria-label')).toBe('Review changes');
    });

    it.each(['addition', 'comment'] as const)(
        'labels every %s action button and nests no interactive semantics',
        async (type) => {
            const item = reviewItem(type);
            const { eventCenter, muya } = fakeMuya(item);
            const tool = new CriticMarkupReviewTool(muya);
            tools.push(tool);

            eventCenter.emit('muya-critic-markup-tool', {
                item,
                reference: reference(),
            });
            await settleFloat();

            const buttons = [...tool.container!.querySelectorAll('button')];
            expect(buttons.length).toBeGreaterThan(0);
            for (const button of buttons) {
                expect(button.getAttribute('type')).toBe('button');
                expect(button.getAttribute('aria-label')).toBe(
                    button.textContent,
                );
                expect(button.getAttribute('aria-label')).not.toBe('');
                expect(button.querySelector(
                    'button, a[href], input, select, textarea, [tabindex], [contenteditable]',
                )).toBeNull();
            }
            expect(tool.container!.querySelector('[tabindex]')).toBeNull();
        },
    );

    it('returns focus to the editor block after a keyboard-driven resolution', async () => {
        const item = reviewItem('addition');
        const { anchorDomNode, eventCenter, muya, resolveCriticMarkup }
            = fakeMuya(item);
        const tool = new CriticMarkupReviewTool(muya);
        tools.push(tool);
        eventCenter.emit('muya-critic-markup-tool', {
            item,
            reference: reference(),
        });
        await settleFloat();

        const button = tool.container!.querySelector(
            'button.accept',
        ) as HTMLButtonElement;
        button.focus();
        expect(document.activeElement).toBe(button);

        // Native buttons dispatch `click` for keyboard activation (Enter or
        // Space), so `click()` on the focused button is the keyboard path.
        button.click();

        expect(resolveCriticMarkup).toHaveBeenCalledWith('accept');
        expect(document.activeElement).toBe(anchorDomNode);
        // No phantom tab stop survives on the hidden float.
        expect(tool.container!.querySelector('button')).toBeNull();
    });

    it('leaves DOM focus alone when the tool never held it', async () => {
        const item = reviewItem('addition');
        const { eventCenter, muya } = fakeMuya(item);
        const tool = new CriticMarkupReviewTool(muya);
        tools.push(tool);
        eventCenter.emit('muya-critic-markup-tool', {
            item,
            reference: reference(),
        });
        await settleFloat();

        const before = document.activeElement;
        (tool.container!.querySelector(
            'button.accept',
        ) as HTMLButtonElement).click();

        expect(document.activeElement).toBe(before);
    });

    it('drops its buttons from the tab order while hidden', async () => {
        const item = reviewItem('addition');
        const { eventCenter, muya } = fakeMuya(item);
        const tool = new CriticMarkupReviewTool(muya);
        tools.push(tool);
        eventCenter.emit('muya-critic-markup-tool', {
            item,
            reference: reference(),
        });
        await settleFloat();
        expect(tool.container!.querySelectorAll('button').length)
            .toBeGreaterThan(0);

        eventCenter.emit('selection-change', {});

        expect(tool.status).toBe(false);
        expect(tool.container!.querySelectorAll('button')).toHaveLength(0);
    });
});

describe('criticMarkupReviewTool integration', () => {
    function boot(markdown: string) {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const muya = new RealMuya(host, { markdown });
        muya.init();
        editors.push(muya);
        const tool = new CriticMarkupReviewTool(muya);
        tools.push(tool);
        return { muya, tool };
    }

    it('opens after native focus and resolves one item through the tool', async () => {
        const { muya, tool } = boot('before {++new++} after\n');
        const [item] = muya.getCriticMarkupItems();

        expect(muya.focusCriticMarkup(item)).not.toBeNull();
        await settleFloat();
        expect(tool.status).toBe(true);

        (tool.container!.querySelector('button.accept') as HTMLButtonElement).click();
        expect(muya.getMarkdown()).toBe('before new after\n');
    });

    it('hands DOM focus back to the resolved editor block after a tool action', async () => {
        const { muya, tool } = boot('before {++new++} after\n');
        const [item] = muya.getCriticMarkupItems();

        expect(muya.focusCriticMarkup(item)).not.toBeNull();
        await settleFloat();

        const accept = tool.container!.querySelector(
            'button.accept',
        ) as HTMLButtonElement;
        accept.focus();
        expect(document.activeElement).toBe(accept);
        accept.click();

        expect(muya.getMarkdown()).toBe('before new after\n');
        // The resolve path reseated the caret; DOM focus follows it into the
        // editor instead of staying trapped on the hidden float.
        const active = document.activeElement;
        expect(active).toBeInstanceOf(HTMLElement);
        expect(muya.domNode.contains(active)).toBe(true);
        expect(tool.floatBox!.contains(active)).toBe(false);
        const anchorDomNode = muya.editor.selection.anchorBlock?.domNode;
        expect(anchorDomNode).toBeTruthy();
        expect(muya.domNode.contains(anchorDomNode!)).toBe(true);
    });

    it('makes the visible comment indicator focus the native comment item', async () => {
        const { muya, tool } = boot('{>>review note<<}\n');
        const indicator = muya.domNode.querySelector(
            '.mu-critic-comment-indicator',
        ) as HTMLElement;

        indicator.click();
        await settleFloat();

        expect(muya.getCurrentCriticMarkupItem()?.type).toBe('comment');
        expect(tool.status).toBe(true);
        expect(tool.container!.querySelector('button.remove')).not.toBeNull();
    });

    it.each([
        {
            decision: 'accept' as const,
            expected: [
                '- parent',
                '{--  - A',
                '--}  - KEEP-1',
                '  - KEEP-2',
                '- tail',
                '',
            ].join('\n'),
        },
        {
            decision: 'reject' as const,
            expected: [
                '- parent',
                '{--  - A',
                '--}  - KEEP-1',
                '  - B',
                '  - KEEP-2',
                '- tail',
                '',
            ].join('\n'),
        },
    ])('$decision resolves the clicked native structural list item', async ({
        decision,
        expected,
    }) => {
        const source = [
            '- parent',
            '{--  - A',
            '--}  - KEEP-1',
            '{--  - B',
            '--}  - KEEP-2',
            '- tail',
            '',
        ].join('\n');
        const { muya, tool } = boot(source);
        const items = muya.getCriticMarkupItems();
        const structuralNodes = [...muya.domNode.querySelectorAll<HTMLElement>(
            '[data-critic-structural-id]',
        )];
        const target = structuralNodes[1];
        const targetId = target?.getAttribute('data-critic-structural-id');
        const focusCriticMarkup = vi.spyOn(muya, 'focusCriticMarkup');

        expect(items).toHaveLength(2);
        expect(structuralNodes).toHaveLength(2);
        expect(target?.tagName).toBe('LI');
        expect(targetId).toBe(items[1].id);

        target.click();
        await settleFloat();

        expect(focusCriticMarkup).toHaveBeenCalledWith(targetId);
        expect(muya.getCurrentCriticMarkupItem()?.id).toBe(items[1].id);
        expect(tool.status).toBe(true);

        (tool.container!.querySelector(
            `button.${decision}`,
        ) as HTMLButtonElement).click();

        expect(muya.getMarkdown()).toBe(expected);
        expect(muya.getCriticMarkupItems()).toMatchObject([{
            raw: '{--  - A\n--}',
        }]);
    });

    it('focuses one block-spanning item and exposes one contextual tool', async () => {
        const { muya, tool } = boot('{++first\n\n# second++}\n');
        const [item] = muya.getCriticMarkupItems();

        expect(muya.focusCriticMarkup(item)).not.toBeNull();
        await settleFloat();

        expect(item.fragments.length).toBeGreaterThan(1);
        expect(tool.status).toBe(true);
        expect(tool.container!.querySelectorAll('button')).toHaveLength(2);
    });

    it('chooses the deepest item on a shared structural block while explicit focus reaches its parent', async () => {
        const source = [
            '{--{++# NESTED',
            '++}--}',
            '# tail',
            '',
        ].join('\n');
        const { muya, tool } = boot(source);
        const [outer, inner] = muya.getCriticMarkupItems();
        const outerNode = muya.domNode.querySelector<HTMLElement>(
            `[data-critic-id~="${outer.id}"]`,
        );
        const innerNode = muya.domNode.querySelector<HTMLElement>(
            `[data-critic-id~="${inner.id}"]`,
        );
        const focusCriticMarkup = vi.spyOn(muya, 'focusCriticMarkup');

        expect([outer.type, inner.type]).toEqual(['deletion', 'addition']);
        expect(outerNode).not.toBeNull();
        expect(innerNode).toBe(outerNode);

        outerNode!.click();
        await settleFloat();

        expect(focusCriticMarkup).toHaveBeenCalledWith(inner.id);
        expect(muya.getCurrentCriticMarkupItem()?.id).toBe(inner.id);
        expect(tool.status).toBe(true);

        expect(muya.focusCriticMarkup(outer.id)?.id).toBe(outer.id);
        await settleFloat();
        expect(muya.getCurrentCriticMarkupItem()?.id).toBe(outer.id);
        expect(tool.status).toBe(true);

        (tool.container!.querySelector(
            'button.reject',
        ) as HTMLButtonElement).click();
        expect(muya.getMarkdown()).toBe([
            '{++# NESTED',
            '++}',
            '# tail',
            '',
        ].join('\n'));
        expect(muya.getCriticMarkupItems().map(item => item.type))
            .toEqual(['addition']);
    });
});
