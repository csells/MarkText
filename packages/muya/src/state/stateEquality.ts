/**
 * Compare JSON-state data structurally without treating object property order
 * as document semantics. Arrays remain ordered and sparse arrays are distinct.
 */
export function statesEqual(left: unknown, right: unknown): boolean {
    const pending: Array<readonly [unknown, unknown]> = [[left, right]];
    while (pending.length) {
        const [currentLeft, currentRight] = pending.pop()!;
        if (Object.is(currentLeft, currentRight))
            continue;
        if (
            currentLeft === null
            || currentRight === null
            || typeof currentLeft !== 'object'
            || typeof currentRight !== 'object'
        ) {
            return false;
        }
        const leftIsArray = Array.isArray(currentLeft);
        if (leftIsArray !== Array.isArray(currentRight))
            return false;
        if (leftIsArray) {
            const leftArray = currentLeft as unknown[];
            const rightArray = currentRight as unknown[];
            if (leftArray.length !== rightArray.length)
                return false;
            for (let index = 0; index < leftArray.length; index++) {
                if ((index in leftArray) !== (index in rightArray))
                    return false;
                if (index in leftArray)
                    pending.push([leftArray[index], rightArray[index]]);
            }
            continue;
        }

        const leftRecord = currentLeft as Record<string, unknown>;
        const rightRecord = currentRight as Record<string, unknown>;
        const leftKeys = Object.keys(leftRecord);
        const rightKeys = Object.keys(rightRecord);
        if (leftKeys.length !== rightKeys.length)
            return false;
        const rightKeySet = new Set(rightKeys);
        for (const key of leftKeys) {
            if (!rightKeySet.has(key))
                return false;
            pending.push([leftRecord[key], rightRecord[key]]);
        }
    }
    return true;
}
