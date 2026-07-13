/**
 * Replace one array range without turning input cardinality into call arguments.
 * Replacement values are fully materialized before the target is changed.
 */
export function replaceArrayRange<T>(
    target: T[],
    start: number,
    deleteCount: number,
    replacements: Iterable<T>,
): void {
    if (!Number.isInteger(start) || start < 0 || start > target.length) {
        throw new RangeError(
            'Array replacement start must be inside the target.',
        );
    }
    if (
        !Number.isInteger(deleteCount)
        || deleteCount < 0
        || start + deleteCount > target.length
    ) {
        throw new RangeError(
            'Array replacement delete count must stay inside the target.',
        );
    }

    const replacementValues: T[] = [];
    for (const replacement of replacements)
        replacementValues.push(replacement);

    const result = target.slice(0, start);
    for (const replacement of replacementValues)
        result.push(replacement);
    for (let index = start + deleteCount; index < target.length; index++)
        result.push(target[index]);

    target.length = result.length;
    for (let index = 0; index < result.length; index++)
        target[index] = result[index];
}
