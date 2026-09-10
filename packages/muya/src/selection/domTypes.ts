/** An exact browser boundary: element offsets count children, text offsets UTF-16. */
export interface IDOMPoint {
    readonly node: Node;
    readonly offset: number;
}

export interface IDOMSelection {
    readonly anchor: IDOMPoint;
    readonly focus: IDOMPoint;
}

export interface ITextPoint {
    readonly path: readonly (string | number)[];
    readonly offset: number;
}
