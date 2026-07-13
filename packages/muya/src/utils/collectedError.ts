/** Error that preserves every failure from one best-effort boundary. */
export class CollectedError extends Error {
    readonly errors: readonly unknown[];

    constructor(errors: readonly unknown[], message: string) {
        super(message);
        this.name = 'CollectedError';
        this.errors = Object.freeze([...errors]);
    }
}
