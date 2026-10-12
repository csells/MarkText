import type { Page } from '@playwright/test';
import type { bootCoreBoundary } from '../../host/coreBoundaryControl';

type CoreBoundary = ReturnType<typeof bootCoreBoundary>;

export interface IBootCoreOptions {
    tracked?: boolean;
    options?: Parameters<typeof bootCoreBoundary>[4];
    /** `setCursor` arguments for the first content block, applied in the same page task as the boot. */
    cursor?: [begin: number, end: number, needUpdate?: boolean];
}

/** Open `source` in a fresh Core binding over the host's Muya and expose it as `window.coreBoundary`. */
export async function bootCore(page: Page, source: string, { tracked, options, cursor }: IBootCoreOptions = {}): Promise<void> {
    await page.evaluate(async ({ source, tracked, options, cursor }) => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        window.coreBoundary = control.bootCoreBoundary(window.muya!, source, tracked, undefined, options);
        if (cursor)
            window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(...cursor);
    }, { source, tracked, options, cursor });
}

export async function readCore(page: Page): Promise<ReturnType<CoreBoundary['read']>> {
    return page.evaluate(() => window.coreBoundary.read());
}

export async function reopenCore(page: Page): Promise<ReturnType<CoreBoundary['reopen']>> {
    return page.evaluate(() => window.coreBoundary.reopen());
}

export async function coreHistory(page: Page, kind: 'undo' | 'redo'): Promise<Awaited<ReturnType<CoreBoundary['history']>>> {
    return page.evaluate(kind => window.coreBoundary.history(kind), kind);
}

export async function disposeCore(page: Page): Promise<void> {
    await page.evaluate(() => window.coreBoundary.dispose());
}

/** The acknowledged Core source; `settle` first flushes Muya and waits for pending edits to reach Core. */
export async function coreSource(page: Page, { settle = false } = {}): Promise<string> {
    return page.evaluate(async (settle) => {
        if (settle) {
            window.muya!.flush();
            await window.coreBoundary.settle();
        }
        const source = window.coreBoundary.read().source;
        if (source.type !== 'source')
            throw new Error('Source is unavailable');
        return source.source;
    }, settle);
}
