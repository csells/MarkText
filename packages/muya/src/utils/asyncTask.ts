/** A contextual failure surfaced from intentionally fire-and-forget work. */
export class AsyncTaskError extends Error {
    override readonly cause: unknown;

    constructor(context: string, cause: unknown) {
        super(`${context} failed.`);
        this.name = 'AsyncTaskError';
        this.cause = cause;
    }
}

type TGlobalErrorReporter = typeof globalThis & {
    reportError?: (error: unknown) => void;
};

/**
 * Add task context to a known asynchronous failure and surface it through the
 * host error boundary before returning to a best-effort continuation.
 */
export function reportAsyncFailure(cause: unknown, context: string): void {
    const error = new AsyncTaskError(context, cause);
    const reporter = (globalThis as TGlobalErrorReporter).reportError;
    if (typeof reporter === 'function') {
        reporter(error);
        return;
    }
    setTimeout(() => {
        throw error;
    });
}

/**
 * Observe a promise launched from a synchronous DOM/bus callback and report
 * failures through the host's global error boundary. The fallback throws on a
 * later task instead of swallowing the failure when `reportError` is absent.
 */
export function reportAsyncTask(
    task: PromiseLike<unknown>,
    context: string,
): void {
    void Promise.resolve(task).catch((cause: unknown) => {
        reportAsyncFailure(cause, context);
    });
}
