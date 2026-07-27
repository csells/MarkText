// @vitest-environment happy-dom

import type { ParseConfiguration } from '@marktext/document-core';
import { createSourceSnapshot } from '@marktext/document-core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
    createTestDocumentCoreView as createDocumentCoreView,
    type TestClipboardSink,
} from './testDocumentCoreSession';

const PARSE_CONFIGURATION: ParseConfiguration = {
    criticMarkupProfile: 'marktext-profile-1',
    markdownProfile: 'markdown-profile-1',
    markdownOptions: {
        schema: 'markdown-options-1',
        gfm: true,
        frontMatter: true,
        math: true,
        gitLabMath: false,
        footnotes: false,
        subscriptAndSuperscript: true,
    },
    liveHtmlSafetyProfile: 'live-html-sanitized-v1',
    executionBudget: {
        limitsProfile: 'test-unbounded',
        accountingSchema: 'syntax-accounting-1',
    },
};

const THREE_BY_FOUR_TABLE = [
    '| h1 | h2 | h3 |',
    '| :--- | :---: | ---: |',
    '| a1 | b1 | c1 |',
    '| a2 | b2 | c2 |',
    '| a3 | b3 | c3 |',
    ''
].join('\n');

async function mount(
    source: string,
    clipboardWrite?: TestClipboardSink,
) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const view = await createDocumentCoreView({
        host,
        source: createSourceSnapshot(source),
        parseConfiguration: PARSE_CONFIGURATION,
        clipboardWrite,
    });
    return { host, view };
}

async function expectToolbarCommand(
    source: string,
    command: string,
    expected: string,
): Promise<void> {
    const { host, view } = await mount(source);
    const cell = [...host.querySelectorAll<HTMLElement>(
        '.document-view-table-cell',
    )].find(candidate => candidate.textContent === 'b2');
    expect(cell).not.toBeUndefined();
    cell?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await view.settled();
    const beforeSelection = view.getSelection();
    const button = document.body.querySelector<HTMLButtonElement>(
        `[data-table-command="${command}"]`,
    );
    expect(button).not.toBeNull();

    button?.click();
    await view.settled();
    expect(await view.getMarkdown()).toBe(expected);
    const afterSelection = view.getSelection();

    await view.undo();
    expect(await view.getMarkdown()).toBe(source);
    expect(view.getSelection()).toEqual(beforeSelection);

    await view.redo();
    expect(await view.getMarkdown()).toBe(expected);
    expect(view.getSelection()).toEqual(afterSelection);
    view.destroy();
    host.remove();
}

describe('live table tools', () => {
    beforeEach(() => {
        document.body.replaceChildren();
    });

    it('routes every typed row command through the parser-owned selection', async () => {
        const source = [
            '| a | b |',
            '| --- | --- |',
            '| one | two |',
            '| three | four |',
            '',
        ].join('\n');
        const { view } = await mount(source);
        view.setSelection(source.indexOf('one'), source.indexOf('one'));

        await view.executeCommand({
            kind: 'remove-table-row',
        });

        expect(await view.getMarkdown()).toBe([
            '| a | b |',
            '| --- | --- |',
            '| three | four |',
            '',
        ].join('\n'));
    });

    it('mounts a localized toolbar for a clicked cell and tears it down', async () => {
        const source = [
            '| a | b |',
            '| --- | --- |',
            '| one | two |',
            ''
        ].join('\n');
        const { host, view } = await mount(source);
        const cell = host.querySelector('tbody td');
        expect(cell).not.toBeNull();

        cell?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        const tools = document.body.querySelector(
            '.document-view-table-tools',
        );
        expect(tools?.getAttribute('role')).toBe('toolbar');
        expect(tools?.querySelector(
            '[data-table-command="insert-row-after"]',
        )?.getAttribute('aria-label')).toBe('Insert Row Below');

        view.dismissTransientTools();
        expect(document.body.querySelector(
            '.document-view-table-tools',
        )).toBeNull();
    });

    it('preserves native caret placement on a table-cell pointerdown', async () => {
        const source = [
            '| a |',
            '| --- |',
            '| one |',
            '',
        ].join('\n');
        const { host } = await mount(source);
        const cell = host.querySelector('tbody td');
        expect(cell).not.toBeNull();
        const pointerdown = new MouseEvent('pointerdown', {
            bubbles: true,
            buttons: 1,
            cancelable: true,
        });

        cell?.dispatchEvent(pointerdown);

        expect(pointerdown.defaultPrevented).toBe(false);
    });

    it('updates a mounted toolbar from the host locale resource', async () => {
        const source = [
            '| a |',
            '| --- |',
            ''
        ].join('\n');
        const { host, view } = await mount(source);
        host.querySelector('thead th')?.dispatchEvent(
            new MouseEvent('click', { bubbles: true }),
        );

        view.setLocale({
            name: 'test',
            resource: {
                'Insert Row Below': 'Add row underneath',
            },
        });

        const button = document.body.querySelector(
            '[data-table-command="insert-row-after"]',
        );
        expect(button?.textContent).toBe('Add row underneath');
        expect(button?.getAttribute('aria-label')).toBe('Add row underneath');
    });

    it('executes a toolbar button click as one real structural command', async () => {
        const source = [
            '| a | b |',
            '| --- | --- |',
            '| one | two |',
            ''
        ].join('\n');
        const { host, view } = await mount(source);
        host.querySelector('tbody td')?.dispatchEvent(
            new MouseEvent('click', { bubbles: true }),
        );
        const button = document.body.querySelector<HTMLButtonElement>(
            '[data-table-command="insert-row-after"]',
        );
        expect(button).not.toBeNull();

        button?.click();
        await view.settled();

        expect(await view.getMarkdown()).toBe([
            '| a | b |',
            '| --- | --- |',
            '| one | two |',
            '|   |   |',
            ''
        ].join('\n'));
    });

    it('deletes a pointer-selected rectangle through the live toolbar', async () => {
        const source = [
            '| a | b | c |',
            '| --- | --- | --- |',
            '| one | two | three |',
            '| four | five | six |',
            ''
        ].join('\n');
        const { host, view } = await mount(source);
        const cells = host.querySelectorAll<HTMLElement>('tbody td');
        const anchor = cells[1];
        const focus = cells[5];
        expect(anchor?.textContent).toBe('two');
        expect(focus?.textContent).toBe('six');

        anchor?.dispatchEvent(new MouseEvent('pointerdown', {
            bubbles: true,
            buttons: 1,
        }));
        focus?.dispatchEvent(new MouseEvent('pointerover', {
            bubbles: true,
            buttons: 1,
        }));
        focus?.dispatchEvent(new MouseEvent('pointerup', {
            bubbles: true,
        }));
        await view.settled();

        expect(host.querySelectorAll(
            '.document-view-table-cell[data-table-selected="true"]',
        )).toHaveLength(4);
        const beforeSelection = view.getSelection();

        document.body.querySelector<HTMLButtonElement>(
            '[data-table-command="delete-cell-contents"]',
        )?.click();
        await view.settled();

        const expected = [
            '| a | b | c |',
            '| --- | --- | --- |',
            '| one |   |   |',
            '| four |   |   |',
            ''
        ].join('\n');
        expect(await view.getMarkdown()).toBe(expected);
        const afterSelection = view.getSelection();

        await view.undo();
        expect(await view.getMarkdown()).toBe(source);
        expect(view.getSelection()).toEqual(beforeSelection);
        await view.redo();
        expect(await view.getMarkdown()).toBe(expected);
        expect(view.getSelection()).toEqual(afterSelection);
    });

    it('cuts a pointer-selected rectangle to TSV before deleting it', async () => {
        const source = [
            '| a | b | c |',
            '| --- | --- | --- |',
            '| one | two | three |',
            '| four | five | six |',
            ''
        ].join('\n');
        const writes: unknown[] = [];
        const payloads: unknown[] = [];
        const { host, view } = await mount(source, async (request, payload) => {
            writes.push(request);
            payloads.push(payload);
        });
        const cells = host.querySelectorAll<HTMLElement>('tbody td');
        cells[1]?.dispatchEvent(new MouseEvent('pointerdown', {
            bubbles: true,
            buttons: 1,
        }));
        cells[5]?.dispatchEvent(new MouseEvent('pointerover', {
            bubbles: true,
            buttons: 1,
        }));
        cells[5]?.dispatchEvent(new MouseEvent('pointerup', {
            bubbles: true,
        }));
        await view.settled();
        const beforeSelection = view.getSelection();

        document.body.querySelector<HTMLButtonElement>(
            '[data-table-command="cut-cells"]',
        )?.click();
        await view.settled();

        expect(writes).toEqual([{
            consumer: 'cut-table',
            view: 'markup',
            selection: beforeSelection,
        }]);
        expect(payloads).toEqual([{
            kind: 'clipboard-bundle',
            plainText: 'two\tthree\nfive\tsix',
        }]);
        const expected = [
            '| a | b | c |',
            '| --- | --- | --- |',
            '| one |   |   |',
            '| four |   |   |',
            ''
        ].join('\n');
        expect(await view.getMarkdown()).toBe(expected);
        const afterSelection = view.getSelection();

        await view.undo();
        expect(await view.getMarkdown()).toBe(source);
        expect(view.getSelection()).toEqual(beforeSelection);
        await view.redo();
        expect(await view.getMarkdown()).toBe(expected);
        expect(view.getSelection()).toEqual(afterSelection);
    });

    it('handles the native cut event for the active rectangle', async () => {
        const source = [
            '| a | b |',
            '| --- | --- |',
            '| one | two |',
            ''
        ].join('\n');
        const writes: unknown[] = [];
        const { host, view } = await mount(source, async request => {
            writes.push(request);
        });
        const cells = host.querySelectorAll<HTMLElement>('tbody td');
        cells[0]?.dispatchEvent(new MouseEvent('pointerdown', {
            bubbles: true,
            buttons: 1,
        }));
        cells[1]?.dispatchEvent(new MouseEvent('pointerover', {
            bubbles: true,
            buttons: 1,
        }));
        cells[1]?.dispatchEvent(new MouseEvent('pointerup', {
            bubbles: true,
        }));
        await view.settled();
        const beforeSelection = view.getSelection();
        const clipboard = new DataTransfer();
        const cut = new Event('cut', { bubbles: true, cancelable: true });
        Object.defineProperty(cut, 'clipboardData', { value: clipboard });

        host.dispatchEvent(cut);
        await view.settled();

        expect(cut.defaultPrevented).toBe(true);
        expect(clipboard.getData('text/plain')).toBe('');
        expect(writes).toEqual([{
            consumer: 'cut-table',
            view: 'markup',
            selection: beforeSelection,
        }]);
        expect(await view.getMarkdown()).toBe([
            '| a | b |',
            '| --- | --- |',
            '|   |   |',
            ''
        ].join('\n'));
    });

    it('leaves a selected rectangle unchanged when the clipboard sink fails', async () => {
        const source = [
            '| a | b |',
            '| --- | --- |',
            '| one | two |',
            ''
        ].join('\n');
        const { host, view } = await mount(source, async () => {
            throw new Error('clipboard unavailable');
        });
        const cells = host.querySelectorAll<HTMLElement>('tbody td');
        cells[0]?.dispatchEvent(new MouseEvent('pointerdown', {
            bubbles: true,
            buttons: 1,
        }));
        cells[1]?.dispatchEvent(new MouseEvent('pointerover', {
            bubbles: true,
            buttons: 1,
        }));
        cells[1]?.dispatchEvent(new MouseEvent('pointerup', {
            bubbles: true,
        }));
        await view.settled();

        document.body.querySelector<HTMLButtonElement>(
            '[data-table-command="cut-cells"]',
        )?.click();
        await expect(view.settled()).rejects.toThrow('clipboard unavailable');

        expect(await view.getMarkdown()).toBe(source);
        expect(
            [...host.querySelectorAll<HTMLElement>('tbody td')]
                .map(cell => cell.textContent),
        ).toEqual(['one', 'two']);
    });

    it('executes every advertised row operation through real button events', async () => {
        const cases = [
            {
                command: 'insert-row-before',
                expected: [
                    '| h1 | h2 | h3 |',
                    '| :--- | :---: | ---: |',
                    '| a1 | b1 | c1 |',
                    '|   |   |   |',
                    '| a2 | b2 | c2 |',
                    '| a3 | b3 | c3 |',
                    ''
                ].join('\n'),
            },
            {
                command: 'insert-row-after',
                expected: [
                    '| h1 | h2 | h3 |',
                    '| :--- | :---: | ---: |',
                    '| a1 | b1 | c1 |',
                    '| a2 | b2 | c2 |',
                    '|   |   |   |',
                    '| a3 | b3 | c3 |',
                    ''
                ].join('\n'),
            },
            {
                command: 'remove-row',
                expected: [
                    '| h1 | h2 | h3 |',
                    '| :--- | :---: | ---: |',
                    '| a1 | b1 | c1 |',
                    '| a3 | b3 | c3 |',
                    ''
                ].join('\n'),
            },
            {
                command: 'move-row-up',
                expected: [
                    '| h1 | h2 | h3 |',
                    '| :--- | :---: | ---: |',
                    '| a2 | b2 | c2 |',
                    '| a1 | b1 | c1 |',
                    '| a3 | b3 | c3 |',
                    ''
                ].join('\n'),
            },
            {
                command: 'move-row-down',
                expected: [
                    '| h1 | h2 | h3 |',
                    '| :--- | :---: | ---: |',
                    '| a1 | b1 | c1 |',
                    '| a3 | b3 | c3 |',
                    '| a2 | b2 | c2 |',
                    ''
                ].join('\n'),
            },
        ] as const;
        for (const row of cases) {
            await expectToolbarCommand(
                THREE_BY_FOUR_TABLE,
                row.command,
                row.expected,
            );
        }
    });

    it('executes every advertised column operation through real button events', async () => {
        const cases = [
            {
                command: 'insert-column-left',
                source: THREE_BY_FOUR_TABLE,
                expected: [
                    '| h1 |   | h2 | h3 |',
                    '| :--- | --- | :---: | ---: |',
                    '| a1 |   | b1 | c1 |',
                    '| a2 |   | b2 | c2 |',
                    '| a3 |   | b3 | c3 |',
                    ''
                ].join('\n'),
            },
            {
                command: 'insert-column-right',
                source: THREE_BY_FOUR_TABLE,
                expected: [
                    '| h1 | h2 |   | h3 |',
                    '| :--- | :---: | --- | ---: |',
                    '| a1 | b1 |   | c1 |',
                    '| a2 | b2 |   | c2 |',
                    '| a3 | b3 |   | c3 |',
                    ''
                ].join('\n'),
            },
            {
                command: 'remove-column',
                source: THREE_BY_FOUR_TABLE,
                expected: [
                    '| h1 | h3 |',
                    '| :--- | ---: |',
                    '| a1 | c1 |',
                    '| a2 | c2 |',
                    '| a3 | c3 |',
                    ''
                ].join('\n'),
            },
            {
                command: 'move-column-left',
                source: THREE_BY_FOUR_TABLE,
                expected: [
                    '| h2 | h1 | h3 |',
                    '| :---: | :--- | ---: |',
                    '| b1 | a1 | c1 |',
                    '| b2 | a2 | c2 |',
                    '| b3 | a3 | c3 |',
                    ''
                ].join('\n'),
            },
            {
                command: 'move-column-right',
                source: THREE_BY_FOUR_TABLE,
                expected: [
                    '| h1 | h3 | h2 |',
                    '| :--- | ---: | :---: |',
                    '| a1 | c1 | b1 |',
                    '| a2 | c2 | b2 |',
                    '| a3 | c3 | b3 |',
                    ''
                ].join('\n'),
            },
            {
                command: 'align-left',
                source: THREE_BY_FOUR_TABLE,
                expected: THREE_BY_FOUR_TABLE.replace(':---:', ':---'),
            },
            {
                command: 'align-center',
                source: THREE_BY_FOUR_TABLE.replace(':---:', '---'),
                expected: THREE_BY_FOUR_TABLE,
            },
            {
                command: 'align-right',
                source: THREE_BY_FOUR_TABLE,
                expected: THREE_BY_FOUR_TABLE.replace(':---:', '---:'),
            },
            {
                command: 'align-none',
                source: THREE_BY_FOUR_TABLE,
                expected: THREE_BY_FOUR_TABLE.replace(':---:', '---'),
            },
        ] as const;
        for (const column of cases) {
            await expectToolbarCommand(
                column.source,
                column.command,
                column.expected,
            );
        }
    });

    it('does not mount or execute semantic table tools in SourceOnly mode', async () => {
        const source = `${'> '.repeat(129)}text\r\n`;
        const host = document.createElement('div');
        document.body.appendChild(host);
        const view = await createDocumentCoreView({
            host,
            source: createSourceSnapshot(source),
            parseConfiguration: {
                ...PARSE_CONFIGURATION,
                executionBudget: {
                    limitsProfile: 'desktop-v1',
                    accountingSchema: 'syntax-accounting-1',
                },
            },
        });

        host.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(document.body.querySelector(
            '.document-view-table-tools',
        )).toBeNull();
        await expect(view.executeCommand({
            kind: 'remove-table-row',
        })).rejects.toThrow('unavailable in SourceOnly mode');
        expect(await view.getMarkdown()).toBe(source);
    });
});
