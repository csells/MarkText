import type { Page } from '@playwright/test';
import { editor } from './selectors';

async function cellCenter(page: Page, row: number, column: number) {
    const cell = page.locator(editor.table).first().locator('tr').nth(row).locator('td').nth(column);
    const box = await cell.boundingBox();
    if (!box)
        throw new Error(`cell (${row}, ${column}) has no bounding box`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function dragSelect(
    page: Page,
    from: { row: number; column: number },
    to: { row: number; column: number },
): Promise<void> {
    const start = await cellCenter(page, from.row, from.column);
    const end = await cellCenter(page, to.row, to.column);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 4 });
    await page.mouse.move(end.x, end.y, { steps: 4 });
    await page.mouse.up();
}

export function selectedCount(page: Page) {
    return page.locator(`${editor.table} td.mu-table-cell-selected`).count();
}
