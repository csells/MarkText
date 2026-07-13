/**
 * Synchronous capability shared only by the mutation gateway and JSON state.
 * Low-level block/state writers may assert it, but only the gateway can enter
 * the scope, so forgetting a policy boundary fails before state can diverge.
 */
export interface IMutationAuthority {
    readonly active: boolean;
    run: <T>(mutate: () => T) => T;
    suspend: <T>(observe: () => T) => T;
    assertActive: (operation: string) => void;
}

export function createMutationAuthority(): IMutationAuthority {
    let depth = 0;

    return {
        get active() {
            return depth > 0;
        },
        run<T>(mutate: () => T): T {
            depth++;
            try {
                return mutate();
            }
            finally {
                depth--;
            }
        },
        suspend<T>(observe: () => T): T {
            const activeDepth = depth;
            depth = 0;
            try {
                return observe();
            }
            finally {
                depth = activeDepth;
            }
        },
        assertActive(operation: string): void {
            if (depth === 0) {
                throw new TypeError(
                    `${operation} must run through the mutation gateway.`,
                );
            }
        },
    };
}
