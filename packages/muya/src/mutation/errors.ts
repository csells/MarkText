import { CollectedError } from '../utils/collectedError';

/** The document committed; one or more observers failed afterward. */
export class PostCommitNotificationError extends CollectedError {
    constructor(errors: unknown[]) {
        super(errors, 'The editor committed, but post-commit notification failed.');
        this.name = 'PostCommitNotificationError';
    }
}

/** A prepared replacement could not restore its required target selection. */
export class PreparedSelectionError extends TypeError {
    constructor() {
        super('Prepared replacement selection does not resolve in the rebuilt tree.');
        this.name = 'PreparedSelectionError';
    }
}
