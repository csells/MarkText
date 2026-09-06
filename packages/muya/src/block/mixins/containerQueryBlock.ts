/* eslint-disable ts/no-unsafe-declaration-merging */
import type Content from '../base/content';
import type Parent from '../base/parent';
import type { TBlockPath } from '../types';

interface IContainerQueryBlock {
    find: (p: number) => Parent | Content;
}
class IContainerQueryBlock {
    queryBlock(path: TBlockPath) {
        const offset = typeof path[0] === 'string' && /children|meta|align|type|lang/.test(path[0]) ? 1 : 0;

        if (path.length === offset)
            return this;

        const p = path[offset] as number;
        const remaining = path.slice(offset + 1);
        // `find(p)` returns either a Parent (which the mixin extends with
        // `queryBlock`) or a Content leaf. Recursion only happens when more
        // path segments remain — by that point the runtime contract is
        // that the block is a Parent. Express the queryable shape directly
        // instead of casting to `any`.
        const block = this.find(p) as (Parent & { queryBlock: (p: TBlockPath) => Parent | Content | undefined }) | Content;

        return block && remaining.length && 'queryBlock' in block
            ? block.queryBlock(remaining)
            : block;
    }
}

export default IContainerQueryBlock;
