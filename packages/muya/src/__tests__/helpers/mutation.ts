import type { Muya } from '../../muya';

/**
 * Exercise an internal editor primitive through the same policy/transaction
 * boundary used by a real UI command. Tests that deliberately prove the
 * low-level guard must call the primitive directly instead.
 */
export function runUserCommand(
    muya: Muya,
    mutate: () => void,
): void {
    const result = muya.editor.mutationGateway.run(
        { kind: 'user-command' },
        mutate,
    );
    if (result !== 'untracked') {
        throw new TypeError(
            `Expected a writable Marked-view test command, received ${result}.`,
        );
    }
}

/** Run a command boundary while preserving the primitive's return value. */
export function runUserCommandResult<Result>(
    muya: Muya,
    mutate: () => Result,
): Result {
    let completed = false;
    let result!: Result;
    runUserCommand(muya, () => {
        result = mutate();
        completed = true;
    });
    if (!completed)
        throw new TypeError('The user command did not execute.');
    return result;
}

/** Run an input/composition primitive through the real user-edit boundary. */
export function runUserEdit(
    muya: Muya,
    mutate: () => void,
): void {
    const result = muya.editor.mutationGateway.run(
        { kind: 'user-edit' },
        mutate,
    );
    if (result !== 'untracked') {
        throw new TypeError(
            `Expected a writable Marked-view test edit, received ${result}.`,
        );
    }
}

/**
 * Exercise JSONState's authorized deferred-operation queue. Review/history
 * transactions own their higher-level commit protocol, so the gateway permits
 * their low-level operations without wrapping them in the ordinary direct-user
 * capture. This helper is for queue/flush tests only.
 */
export function runDeferredDirectMutation(
    muya: Muya,
    mutate: () => void,
): void {
    const result = muya.editor.mutationGateway.run(
        { kind: 'review-command' },
        mutate,
    );
    if (result !== 'untracked') {
        throw new TypeError(
            `Expected an authorized deferred test mutation, received ${result}.`,
        );
    }
}
