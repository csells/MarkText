interface ISuffixAutomatonState {
    readonly length: number;
    readonly edges: Map<string, number>;
    link: number;
    occurrences: number;
}

function appendUnit(
    states: ISuffixAutomatonState[],
    previous: number,
    unit: string,
): number {
    const current = states.length;
    states.push({
        length: states[previous].length + 1,
        edges: new Map(),
        link: 0,
        occurrences: 1,
    });

    let parent = previous;
    while (parent >= 0 && !states[parent].edges.has(unit)) {
        states[parent].edges.set(unit, current);
        parent = states[parent].link;
    }
    if (parent < 0)
        return current;

    const existing = states[parent].edges.get(unit)!;
    if (states[parent].length + 1 === states[existing].length) {
        states[current].link = existing;
        return current;
    }

    const clone = states.length;
    states.push({
        length: states[parent].length + 1,
        edges: new Map(states[existing].edges),
        link: states[existing].link,
        occurrences: 0,
    });
    while (
        parent >= 0
        && states[parent].edges.get(unit) === existing
    ) {
        states[parent].edges.set(unit, clone);
        parent = states[parent].link;
    }
    states[existing].link = clone;
    states[current].link = clone;
    return current;
}

function propagateOccurrences(
    states: ISuffixAutomatonState[],
    maximumLength: number,
): void {
    const lengthCounts = new Uint32Array(maximumLength + 1);
    for (const state of states)
        lengthCounts[state.length]++;
    for (let length = 1; length < lengthCounts.length; length++)
        lengthCounts[length] += lengthCounts[length - 1];

    const orderedStates = new Uint32Array(states.length);
    for (let state = states.length - 1; state >= 0; state--) {
        const length = states[state].length;
        orderedStates[--lengthCounts[length]] = state;
    }
    for (let index = orderedStates.length - 1; index > 0; index--) {
        const state = orderedStates[index];
        const suffix = states[state].link;
        states[suffix].occurrences += states[state].occurrences;
    }
}

function buildSuffixAutomaton(text: string): readonly ISuffixAutomatonState[] {
    const states: ISuffixAutomatonState[] = [{
        length: 0,
        edges: new Map(),
        link: -1,
        occurrences: 0,
    }];
    let previous = 0;
    for (let index = 0; index < text.length; index++)
        previous = appendUnit(states, previous, text[index]);
    propagateOccurrences(states, text.length);
    return states;
}

function exactPatternCount(
    states: readonly ISuffixAutomatonState[],
    pattern: string,
): number {
    let state = 0;
    for (let index = 0; index < pattern.length; index++) {
        const next = states[state].edges.get(pattern[index]);
        if (next === undefined)
            return 0;
        state = next;
    }
    return states[state].occurrences;
}

/**
 * Compare exact, overlap-aware pattern multiplicities in two UTF-16 strings.
 * A suffix automaton scans each string once, then all distinct patterns are
 * queried in their total length rather than rescanning either source.
 */
export function haveEqualExactPatternMultiplicities(
    before: string,
    after: string,
    patterns: readonly string[],
): boolean {
    const distinctPatterns = [...new Set(patterns)];
    if (!distinctPatterns.length)
        return true;
    if (distinctPatterns.some(pattern => !pattern.length))
        throw new TypeError('An exact-match pattern cannot be empty.');

    const beforeAutomaton = buildSuffixAutomaton(before);
    const afterAutomaton = buildSuffixAutomaton(after);
    return distinctPatterns.every(pattern =>
        exactPatternCount(beforeAutomaton, pattern)
        === exactPatternCount(afterAutomaton, pattern));
}
