import type { Page } from '@playwright/test';
import type { bootCoreBoundary } from '../../host/coreBoundaryControl';

type CoreBoundary = ReturnType<typeof bootCoreBoundary>;

export interface IBootCoreOptions<Arg = undefined> {
    tracked?: boolean;
    options?: Parameters<typeof bootCoreBoundary>[4];
    /** `setCursor` arguments for the first content block, applied in the same page task as the boot. */
    cursor?: [begin: number, end: number, needUpdate?: boolean];
    /**
     * Page code run with `arg` after the boot and cursor, in the same page task.
     * Like a `page.evaluate` function it is sent as source, so it reads only
     * its argument and page globals.
     */
    setup?: (arg: Arg) => unknown;
    arg?: Arg;
}

/** Open `source` in a fresh Core binding over the host's Muya and expose it as `window.coreBoundary`. */
export async function bootCore<Arg = undefined>(page: Page, source: string, { tracked, options, cursor, setup, arg }: IBootCoreOptions<Arg> = {}): Promise<void> {
    await page.evaluate(async ({ source, tracked, options, cursor, setup, arg }) => {
        const modulePath = '/coreBoundaryControl.ts';
        const control = await import(/* @vite-ignore */ modulePath);
        window.coreBoundary = control.bootCoreBoundary(window.muya!, source, tracked, undefined, options);
        if (cursor)
            window.muya!.editor.scrollPage!.firstContentInDescendant()!.setCursor(...cursor);
        // Playwright sends page functions as source; `setup` runs the same way.
        if (setup !== undefined)
            await (new Function(`return (${setup})`)() as (arg: unknown) => unknown)(arg);
    }, { source, tracked, options, cursor, setup: setup?.toString(), arg });
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
