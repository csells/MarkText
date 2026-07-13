import type {
    TMutationRequest,
    TMutationResult,
} from '../types';

import { describe, expect, it, vi } from 'vitest';
import { MutationCommandDispatcher } from '../commandDispatcher';

interface IGatewayLike {
    run: (intent: TMutationRequest, command: () => void) => TMutationResult;
}

describe('mutationCommandDispatcher', () => {
    it('owns the gateway ceremony for void, boolean, and count commands', () => {
        const run = vi.fn((_: TMutationRequest, command: () => void) => {
            command();
            return 'untracked' as const;
        });
        const dispatcher = new MutationCommandDispatcher({ run } as IGatewayLike);
        const voidCommand = vi.fn();

        dispatcher.run({ kind: 'user-command' }, voidCommand);
        expect(voidCommand).toHaveBeenCalledOnce();

        expect(dispatcher.runBoolean(
            { kind: 'review-command' },
            () => true,
        )).toBe(true);
        expect(dispatcher.runCount(
            { kind: 'review-command' },
            () => 3,
        )).toBe(3);
        expect(run).toHaveBeenCalledTimes(3);
    });

    it('normalizes a rejected mutation without every public command duplicating that policy', () => {
        const dispatcher = new MutationCommandDispatcher({
            run: () => 'rejected' as const,
        } as IGatewayLike);

        expect(dispatcher.runBoolean(
            { kind: 'review-command' },
            () => true,
        )).toBe(false);
        expect(dispatcher.runCount(
            { kind: 'review-command' },
            () => 12,
        )).toBe(0);
    });
});
