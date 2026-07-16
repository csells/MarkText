import type { MutationGateway } from './gateway';
import type {
    ILocalMutationEdit,
    TMutationRequest,
    TMutationResult,
} from './types';

/**
 * Command-side capability layered over MutationGateway.
 *
 * MutationGateway decides whether and how a mutation may run. This class owns
 * the repetitive public-command protocol: capture a command result inside the
 * gateway callback and normalize read-only rejection at the API boundary.
 */
export class MutationCommandDispatcher {
    constructor(private readonly _gateway: Pick<MutationGateway, 'run'>) {}

    run(
        request: TMutationRequest,
        command: () => void,
        localEdit?: ILocalMutationEdit | readonly ILocalMutationEdit[],
    ): TMutationResult {
        return this._run(request, command, localEdit);
    }

    runBoolean(
        request: TMutationRequest,
        command: () => boolean,
        localEdit?: ILocalMutationEdit | readonly ILocalMutationEdit[],
    ): boolean {
        let value = false;
        const result = this._run(request, () => {
            value = command();
        }, localEdit);

        return result !== 'rejected' && value;
    }

    runCount(
        request: TMutationRequest,
        command: () => number,
        localEdit?: ILocalMutationEdit | readonly ILocalMutationEdit[],
    ): number {
        let value = 0;
        const result = this._run(request, () => {
            value = command();
        }, localEdit);

        return result === 'rejected' ? 0 : value;
    }

    private _run(
        request: TMutationRequest,
        command: () => void,
        localEdit?: ILocalMutationEdit | readonly ILocalMutationEdit[],
    ) {
        return localEdit === undefined
            ? this._gateway.run(request, command)
            : this._gateway.run(request, command, localEdit);
    }
}
