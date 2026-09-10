import { expect, test } from '../fixtures/muya';

for (const level of [1, 2, 3, 4, 5, 6]) {
test(`Heading ${level} menu uses the common model selection before the next key`, async ({ page }) => {
    const source = 'a{++a++}a\n';
    await page.evaluate(async ({ source, level }) => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
        const block = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
        block.setCursor(0, 3, true);
        window.muya!.focus();
        window.muya!.updateParagraph(`heading ${level}`);
    }, { source, level });
    try {
        const heading = `${'#'.repeat(level)} a{++a++}a\n`;
        expect.soft(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: heading }, legacyCalls: [] });
        await page.keyboard.type('X');
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: `${'#'.repeat(level)} X\n` }, legacyCalls: [] });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: heading } });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source } });
        await page.evaluate(() => window.coreBoundary.history('redo'));
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: heading });
    }
    finally {
        await page.evaluate(() => window.coreBoundary.dispose());
    }
});

}

test('records existing standalone cross-block Heading menu behavior', async ({ page }) => {
    const result = await page.evaluate(() => {
        const muya = window.muya!;
        muya.setContent('alpha\n\nbravo\n');
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        const last = first.nextContentInContext()!;
        first.setCursor(0, 0, true);
        muya.editor.selection.setSelection({ block: first, path: first.path, offset: 0 }, { block: last, path: last.path, offset: 5 });
        muya.updateParagraph('heading 2');
        const selected = muya.editor.selection.getSelection();
        return { source: muya.getMarkdown(), anchor: selected?.anchor.offset, focus: selected?.focus.offset, anchorText: selected?.anchor.block.text, focusText: selected?.focus.block.text };
    });
    expect(result).toEqual({ source: '## alpha\n\nbravo\n', anchor: 3, focus: 8, anchorText: '## alpha', focusText: '## alpha' });
});

test('heading conversion preserves the actual cross-block selection for the next key', async ({ page }) => {
    const source = 'a{++a++}a\n\nbravo\n';
    await page.evaluate(async (source) => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
        const muya = window.muya!;
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        const last = first.nextContentInContext()!;
        first.setCursor(0, 0, true);
        muya.editor.selection.setSelection({ block: first, path: first.path, offset: 0 }, { block: last, path: last.path, offset: 5 });
        muya.focus();
        muya.updateParagraph('heading 2');
    }, source);
    try {
        const heading = '## a{++a++}a\n\nbravo\n';
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: heading }, legacyCalls: [] });
        expect(await page.evaluate(() => window.getSelection()?.toString())).toContain('bravo');
        await page.keyboard.type('X');
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: '## X\n' }, legacyCalls: [] });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: heading } });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source });
    }
    finally {
        await page.evaluate(() => window.coreBoundary.dispose());
    }
});

test('tracked heading conversion retains the selected payload for immediate tracked typing', async ({ page }) => {
    const source = 'a{++a++}a\n';
    await page.evaluate(async (source) => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        window.coreBoundary = control.bootCoreBoundary(window.muya!, source, true);
        const block = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
        block.setCursor(0, 3, true);
        window.muya!.focus();
        window.muya!.updateParagraph('heading 1');
    }, source);
    try {
        const heading = '{++# ++}a{++a++}a\n';
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: heading }, legacyCalls: [] });
        expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('aaa');
        await page.keyboard.type('X');
        const result = await page.evaluate(() => window.coreBoundary.read());
        expect(result).toMatchObject({ source: { source: '{++# ++}{~~a{++a++}a~>X~~}\n' }, legacyCalls: [] });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: heading } });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source });
    }
    finally {
        await page.evaluate(() => window.coreBoundary.dispose());
    }
});

test('empty document heading menu leaves a usable caret for actual typing', async ({ page }) => {
    await page.evaluate(async () => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        window.coreBoundary = control.bootCoreBoundary(window.muya!, '\n');
        window.muya!.focus();
        window.muya!.updateParagraph('heading 2');
    });
    try {
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: '## \n' }, legacyCalls: [] });
        await page.keyboard.type('X');
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: '## X\n' }, legacyCalls: [] });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: '## \n' } });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: '\n' });
    }
    finally {
        await page.evaluate(() => window.coreBoundary.dispose());
    }
});

for (const sample of [
    { command: 'upgrade heading', source: 'a{++a++}a\n', expected: '###### a{++a++}a\n' },
    { command: 'upgrade heading', source: '### a{++a++}a\n', expected: '## a{++a++}a\n' },
    { command: 'degrade heading', source: '###### a{++a++}a\n', expected: 'a{++a++}a\n' },
    { command: 'paragraph', source: 'a{++a++}a\n---\n', expected: 'a{++a++}a\n' },
]) {
    test(`${sample.command} on ${JSON.stringify(sample.source)} uses the common heading operation`, async ({ page }) => {
        await page.evaluate(async ({ source, command }) => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
            const block = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
            const start = block.text.indexOf('a');
            block.setCursor(start, start + 3, true);
            window.muya!.focus();
            window.muya!.updateParagraph(command);
        }, sample);
        try {
            expect.soft(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: sample.expected }, legacyCalls: [] });
            await page.keyboard.type('X');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: sample.expected.replace('a{++a++}a', 'X') }, legacyCalls: [] });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: sample.expected } });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: sample.source });
        }
        finally {
            await page.evaluate(() => window.coreBoundary.dispose());
        }
    });
}

test('reversed cross-block heading reset preserves the selected payload for the next key', async ({ page }) => {
    const source = '## a{++a++}a\n\nbravo\n';
    await page.evaluate(async (source) => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        const muya = window.muya!;
        window.coreBoundary = control.bootCoreBoundary(muya, source);
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        const last = first.nextContentInContext()!;
        first.setCursor(3, 3, true);
        muya.editor.selection.setSelection({ block: last, path: last.path, offset: 5 }, { block: first, path: first.path, offset: 3 });
        muya.focus();
        muya.updateParagraph('reset-to-paragraph');
    }, source);
    try {
        const paragraph = 'a{++a++}a\n\nbravo\n';
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: paragraph }, legacyCalls: [] });
        expect(await page.evaluate(() => {
            const selected = window.muya!.getSelection();
            return { anchor: selected?.anchor.offset, focus: selected?.focus.offset, anchorText: selected?.anchor.block.text, focusText: selected?.focus.block.text };
        })).toEqual({ anchor: 5, focus: 0, anchorText: 'bravo', focusText: 'aaa' });
        await page.keyboard.type('X');
        expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: 'X\n' }, legacyCalls: [] });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: paragraph });
        expect(await page.evaluate(() => {
            const selected = window.muya!.getSelection();
            return { anchor: selected?.anchor.offset, focus: selected?.focus.offset, anchorText: selected?.anchor.block.text, focusText: selected?.focus.block.text };
        })).toEqual({ anchor: 5, focus: 0, anchorText: 'bravo', focusText: 'aaa' });
        await page.evaluate(() => window.coreBoundary.history('undo'));
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source });
        expect(await page.evaluate(() => {
            const selected = window.muya!.getSelection();
            return { anchor: selected?.anchor.offset, focus: selected?.focus.offset, anchorText: selected?.anchor.block.text, focusText: selected?.focus.block.text };
        })).toEqual({ anchor: 5, focus: 3, anchorText: 'bravo', focusText: '## aaa' });
        await page.evaluate(() => window.coreBoundary.history('redo'));
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: paragraph });
        await page.evaluate(() => window.coreBoundary.history('redo'));
        expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: 'X\n' });
    }
    finally {
        await page.evaluate(() => window.coreBoundary.dispose());
    }
});

for (const tail of ['', ' tail']) {
    test(`heading formats shared inline substitution arms with usable selection${tail}`, async ({ page }) => {
        const source = `{~~old~>new~~}${tail}\n`;
        await page.evaluate(async source => {
            const modulePath = '/coreBoundaryControl.ts';
            const control = await import(/* @vite-ignore */ modulePath);
            window.coreBoundary = control.bootCoreBoundary(window.muya!, source);
            const first = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
            first.setCursor(0, 0, true);
            window.muya!.focus();
            window.muya!.updateParagraph('heading 1');
        }, source);
        try {
            const heading = `# {~~old~>new~~}${tail}\n`;
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: heading }, anchor: 2, caret: 2, legacyCalls: [] });
            await page.keyboard.type('X');
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: `# {~~Xold~>new~~}${tail}\n` }, anchor: 3, caret: 3, legacyCalls: [] });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: heading }, anchor: 2, caret: 2 });
            await page.evaluate(() => window.coreBoundary.history('undo'));
            expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source }, anchor: 0, caret: 0 });
            await page.evaluate(() => window.coreBoundary.history('redo'));
            expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: heading });
        }
        finally { await page.evaluate(() => window.coreBoundary.dispose()); }
    });
}
