import type { Page } from '@playwright/test';

/**
 * Upstream History joins every change made within one second of the step it
 * opened. Specs that check each action's own undo entry space their actions
 * past that window, as a user pausing between them would.
 */
export async function separateUndoSteps(page: Page): Promise<void> {
    await page.evaluate(() => {
        const clock = window as Window & { undoStepsHeld?: boolean };
        let now = Date.now();
        Date.now = () => (clock.undoStepsHeld ? now : (now += 1_001));
    });
}

/**
 * Pause past the window once more, then stop spacing: the actions that follow
 * share one undo step, like fast typing.
 */
export async function holdUndoSteps(page: Page): Promise<void> {
    await page.evaluate(() => {
        Date.now();
        (window as Window & { undoStepsHeld?: boolean }).undoStepsHeld = true;
    });
}

/** Move the page's clock past upstream's one-second undo window. */
export async function pauseUndoWindow(page: Page): Promise<void> {
    await page.evaluate(() => {
        const clock = window as Window & { undoWindowOffset?: number };
        if (clock.undoWindowOffset === undefined) {
            const now = Date.now.bind(Date);
            clock.undoWindowOffset = 0;
            Date.now = () => now() + clock.undoWindowOffset!;
        }
        clock.undoWindowOffset += 1_001;
    });
}
