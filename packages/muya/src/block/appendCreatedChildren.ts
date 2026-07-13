/** Materialize every state-derived child before publishing any of them. */
export function createChildren<State, Child>(
    states: readonly State[],
    create: (state: State) => Child,
): Child[] {
    const children: Child[] = [];
    for (const state of states)
        children.push(create(state));
    return children;
}

/** Append a fully materialized child set without variadic argument expansion. */
export function appendCreatedChildren<State, Child>(
    states: readonly State[],
    create: (state: State) => Child,
    append: (child: Child) => void,
): void {
    for (const child of createChildren(states, create))
        append(child);
}
