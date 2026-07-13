import type { Nullable } from '../../../types';
import type { ILinkedNode } from './linkedNode';

export interface IReadonlyLinkedList<out T extends ILinkedNode> {
    readonly head: Nullable<T>;
    readonly tail: Nullable<T>;
    readonly length: number;
    iterator: () => IterableIterator<T>;
    find: (index: number) => Nullable<T>;
    forEach: (callback: (cur: T, index: number) => void) => void;
    forEachAt: (
        index: number,
        length: number,
        callback: (cur: T, index: number) => void,
    ) => void;
    map: <Result>(callback: (cur: T, index: number) => Result) => Result[];
    reduce: <Result>(
        callback: (memo: Result, cur: T, index: number) => Result,
        initialValue: Result,
    ) => Result;
}

class ReadonlyLinkedListView<T extends ILinkedNode>
implements IReadonlyLinkedList<T> {
    readonly #list: LinkedList<T>;

    constructor(list: LinkedList<T>) {
        this.#list = list;
        Object.freeze(this);
    }

    get head(): Nullable<T> {
        return this.#list.head;
    }

    get tail(): Nullable<T> {
        return this.#list.tail;
    }

    get length(): number {
        return this.#list.length;
    }

    * iterator(
        curNode: Nullable<T> = this.head,
        length: number = this.length,
    ): IterableIterator<T> {
        yield* this.#list.iterator(curNode, length);
    }

    find(index: number): Nullable<T> {
        return this.#list.find(index);
    }

    forEach(callback: (cur: T, index: number) => void): void {
        this.#list.forEach(callback);
    }

    forEachAt(
        index: number,
        length: number,
        callback: (cur: T, index: number) => void,
    ): void {
        this.#list.forEachAt(index, length, callback);
    }

    map<Result>(callback: (cur: T, index: number) => Result): Result[] {
        return this.#list.map(callback);
    }

    reduce<Result>(
        callback: (memo: Result, cur: T, index: number) => Result,
        initialValue: Result,
    ): Result {
        return this.#list.reduce(callback, initialValue);
    }
}

export class LinkedList<T extends ILinkedNode> {
    head: Nullable<T> = null;

    tail: Nullable<T> = null;

    length: number = 0;

    readonlyView(): IReadonlyLinkedList<T> {
        return new ReadonlyLinkedListView(this);
    }

    * iterator(curNode = this.head, length = this.length) {
        let count = 0;

        while (count < length && curNode) {
            yield curNode;
            count++;
            curNode = curNode.next as T;
        }
    }

    append(...nodes: T[]) {
        for (const node of nodes)
            this.insertBefore(node);
    }

    contains(node: T) {
        const it = this.iterator();
        let data = null;

        // eslint-disable-next-line no-cond-assign
        while ((data = it.next()).done !== true) {
            const { value } = data;
            if (value === node)
                return true;
        }

        return false;
    }

    insertBefore(node: T, refNode: T | null = null) {
        if (!node)
            return;
        node.next = refNode;
        if (refNode !== null) {
            node.prev = refNode.prev;
            if (refNode.prev != null)
                refNode.prev.next = node;

            refNode.prev = node;
            if (this.head === refNode)
                this.head = node;
        }
        else if (this.tail != null) {
            this.tail.next = node;
            node.prev = this.tail;
            this.tail = node;
        }
        else {
            node.prev = null;
            this.head = this.tail = node;
        }
        this.length += 1;
    }

    offset(node: T) {
        return [...this.iterator()].indexOf(node);
    }

    remove(node: T) {
    // If linkedList does not contain this node, just return
        if (!this.contains(node))
            return;
        if (node.prev)
            node.prev.next = node.next;

        if (node.next)
            node.next.prev = node.prev;

        if (this.head === node)
            this.head = node.next as T;

        if (this.tail === node)
            this.tail = node.prev as T;

        this.length -= 1;
    }

    find(index: number) {
        if (index < 0 || index >= this.length)
            return null;

        return [...this.iterator()][index];
    }

    forEach(callback: (cur: T, i: number) => void) {
        return [...this.iterator()].forEach(callback);
    }

    forEachAt(
        index: number,
        length: number = this.length,
        callback: (cur: T, i: number) => void,
    ) {
        const curNode = this.find(index);

        return [...this.iterator(curNode, length)].forEach((node, i) => {
            callback(node, i + index);
        });
    }

    map<M>(callback: (cur: T, i: number) => M): M[] {
        return this.reduce((acc: M[], node: T, i: number) => {
            return [...acc, callback(node, i)];
        }, []);
    }

    reduce<M>(callback: (memo: M, cur: T, i: number) => M, memo: M): M {
        return [...this.iterator()].reduce(callback, memo);
    }
}
