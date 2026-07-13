import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    AsyncTaskError,
    reportAsyncFailure,
    reportAsyncTask,
} from '../asyncTask';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('reportAsyncTask', () => {
    it('reports a known failure synchronously before a caller continues', () => {
        const calls: string[] = [];
        const cause = new Error('buffer write failed');
        vi.stubGlobal('reportError', (error: unknown) => {
            calls.push('reported');
            expect(error).toMatchObject({
                message: 'Buffered state persistence failed.',
                cause,
            });
        });

        reportAsyncFailure(cause, 'Buffered state persistence');
        calls.push('continued');

        expect(calls).toEqual(['reported', 'continued']);
    });

    it('reports a contextual error with the original rejection as its cause', async () => {
        const reportError = vi.fn();
        const cause = new Error('clipboard bridge failed');
        vi.stubGlobal('reportError', reportError);

        reportAsyncTask(Promise.reject(cause), 'Clipboard paste');
        await Promise.resolve();
        await Promise.resolve();

        expect(reportError).toHaveBeenCalledOnce();
        const error = reportError.mock.calls[0][0];
        expect(error).toBeInstanceOf(AsyncTaskError);
        expect(error).toMatchObject({
            message: 'Clipboard paste failed.',
            cause,
        });
    });
});
