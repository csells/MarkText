import type { Token, Tokens } from './Tokens.ts';

interface IDataPropertyDescriptorSnapshot {
  readonly kind: 'data';
  readonly configurable: boolean;
  readonly enumerable: boolean;
  readonly value: unknown;
  readonly writable: boolean;
}

interface IAccessorPropertyDescriptorSnapshot {
  readonly kind: 'accessor';
  readonly configurable: boolean;
  readonly enumerable: boolean;
  readonly get: (() => unknown) | undefined;
  readonly set: ((value: unknown) => void) | undefined;
}

type TPropertyDescriptorSnapshot
  = IDataPropertyDescriptorSnapshot | IAccessorPropertyDescriptorSnapshot;

interface IPropertySnapshot {
  readonly key: PropertyKey;
  readonly descriptor: TPropertyDescriptorSnapshot;
}

interface IObjectSnapshot {
  readonly target: object;
  readonly prototype: object | null;
  readonly extensible: boolean;
  readonly properties: readonly IPropertySnapshot[];
}

export interface IMarkedTokenGraphSnapshot {}

export interface IMarkedSemanticTokenGraphSnapshot {}

interface ITokenGraphAuthority {
  readonly snapshots: readonly IObjectSnapshot[];
  readonly reachable: WeakSet<object>;
}

const GRAPH_SNAPSHOTS = new WeakMap<
  IMarkedTokenGraphSnapshot,
  ITokenGraphAuthority
>();

const SEMANTIC_GRAPH_SNAPSHOTS = new WeakMap<
  IMarkedSemanticTokenGraphSnapshot,
  WeakSet<object>
>();

// Token graphs are untrusted after lexing. Capture reflection operations as
// intrinsics so validation never dispatches through graph-controlled methods.
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const isExtensible = Object.isExtensible;
const ownKeys = Reflect.ownKeys;

function changed(): never {
  throw new TypeError('Marked parser token graph changed after lexing.');
}

function snapshotDescriptor(
  descriptor: PropertyDescriptor,
): TPropertyDescriptorSnapshot {
  return 'value' in descriptor
    ? Object.freeze({
        kind: 'data' as const,
        configurable: descriptor.configurable ?? false,
        enumerable: descriptor.enumerable ?? false,
        value: descriptor.value,
        writable: descriptor.writable ?? false,
      })
    : Object.freeze({
        kind: 'accessor' as const,
        configurable: descriptor.configurable ?? false,
        enumerable: descriptor.enumerable ?? false,
        get: descriptor.get,
        set: descriptor.set,
      });
}

function snapshotObject(target: object): IObjectSnapshot {
  const keys = ownKeys(target);
  const properties: IPropertySnapshot[] = [];
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index];
    const descriptor = getOwnPropertyDescriptor(target, key);
    if (!descriptor)
      changed();
    properties.push(Object.freeze({
      key,
      descriptor: snapshotDescriptor(descriptor),
    }));
  }
  return Object.freeze({
    target,
    prototype: getPrototypeOf(target),
    extensible: isExtensible(target),
    properties: Object.freeze(properties),
  });
}

function assertDescriptorUnchanged(
  actual: PropertyDescriptor,
  expected: TPropertyDescriptorSnapshot,
): void {
  if (
    (actual.configurable ?? false) !== expected.configurable
    || (actual.enumerable ?? false) !== expected.enumerable
  ) {
    changed();
  }
  if (expected.kind === 'data') {
    if (
      !('value' in actual)
      || !Object.is(actual.value, expected.value)
      || (actual.writable ?? false) !== expected.writable
    ) {
      changed();
    }
  } else if (
    'value' in actual
    || actual.get !== expected.get
    || actual.set !== expected.set
  ) {
    changed();
  }
}

function assertObjectUnchanged(expected: IObjectSnapshot): void {
  if (
    getPrototypeOf(expected.target) !== expected.prototype
    || isExtensible(expected.target) !== expected.extensible
  ) {
    changed();
  }
  const keys = ownKeys(expected.target);
  if (keys.length !== expected.properties.length)
    changed();
  for (let index = 0; index < keys.length; index++) {
    const property = expected.properties[index];
    if (keys[index] !== property.key)
      changed();
    const descriptor = getOwnPropertyDescriptor(
      expected.target,
      property.key,
    );
    if (!descriptor)
      changed();
    assertDescriptorUnchanged(descriptor, property.descriptor);
  }
}

/**
 * Capture every own data descriptor reachable from the final token root plus
 * every prototype descriptor on which later parser traversal can dispatch.
 */
export function snapshotMarkedTokenGraph(
  root: object,
): IMarkedTokenGraphSnapshot {
  const pending: object[] = [root];
  const reachable = new WeakSet<object>();
  const captured = new WeakMap<object, IObjectSnapshot>();
  const snapshots: IObjectSnapshot[] = [];
  const capture = (target: object): IObjectSnapshot => {
    const existing = captured.get(target);
    if (existing)
      return existing;
    const snapshot = snapshotObject(target);
    captured.set(target, snapshot);
    snapshots.push(snapshot);
    return snapshot;
  };

  while (pending.length) {
    const target = pending.pop()!;
    if (reachable.has(target))
      continue;
    reachable.add(target);
    const snapshot = capture(target);
    for (let index = 0; index < snapshot.properties.length; index++) {
      const descriptor = snapshot.properties[index].descriptor;
      if (descriptor.kind === 'accessor') {
        throw new TypeError(
          'Marked parser token graphs require own data properties.',
        );
      }
      const { value } = descriptor;
      if (
        value !== null
        && (typeof value === 'object' || typeof value === 'function')
      ) {
        pending.push(value as object);
      }
    }

    let prototype = snapshot.prototype;
    const prototypeChain = new WeakSet<object>();
    while (prototype) {
      if (prototypeChain.has(prototype)) {
        throw new TypeError(
          'Marked parser token graph contains a cyclic prototype chain.',
        );
      }
      prototypeChain.add(prototype);
      capture(prototype);
      prototype = getPrototypeOf(prototype);
    }
  }

  const proof = Object.freeze({});
  GRAPH_SNAPSHOTS.set(proof, {
    snapshots: Object.freeze(snapshots),
    reachable,
  });
  return proof;
}

export function markedTokenGraphContains(
  proof: IMarkedTokenGraphSnapshot,
  target: object,
): boolean {
  const authority = GRAPH_SNAPSHOTS.get(proof);
  if (!authority)
    changed();
  return authority.reachable.has(target);
}

export function assertMarkedTokenGraphUnchanged(
  proof: IMarkedTokenGraphSnapshot,
): void {
  const authority = GRAPH_SNAPSHOTS.get(proof);
  if (!authority)
    changed();
  for (let index = 0; index < authority.snapshots.length; index++)
    assertObjectUnchanged(authority.snapshots[index]);
}

function isToken(value: unknown): value is Token {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as Partial<Token>).type === 'string'
    && typeof (value as Partial<Token>).raw === 'string',
  );
}

/**
 * Capture only arrays and tokens that Marked traverses as semantic AST
 * children. Arbitrary metadata stays outside this proof even when it points at
 * a token-shaped object.
 */
export function snapshotMarkedSemanticTokenGraph(
  root: readonly Token[],
  extensionChildren: Readonly<Record<string, readonly string[]>> = {},
): IMarkedSemanticTokenGraphSnapshot {
  const reachable = new WeakSet<object>();
  const pending: unknown[] = [root];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object' || reachable.has(value))
      continue;
    if (Array.isArray(value)) {
      reachable.add(value);
      for (let index = value.length - 1; index >= 0; index--) {
        const child = value[index];
        if (Array.isArray(child) || isToken(child))
          pending.push(child);
      }
      continue;
    }
    if (!isToken(value))
      continue;
    reachable.add(value);

    if (value.type === 'table') {
      const table = value as Tokens.Table;
      for (let index = table.header.length - 1; index >= 0; index--)
        pending.push(table.header[index].tokens);
      for (let row = table.rows.length - 1; row >= 0; row--) {
        for (let cell = table.rows[row].length - 1; cell >= 0; cell--)
          pending.push(table.rows[row][cell].tokens);
      }
      continue;
    }
    if (value.type === 'list') {
      pending.push((value as Tokens.List).items);
      continue;
    }
    if (
      value.type === 'critic_addition'
      || value.type === 'critic_deletion'
      || value.type === 'critic_substitution'
      || value.type === 'critic_highlight'
      || value.type === 'critic_comment'
    ) {
      pending.push((value as Tokens.CriticMarkupFragment).tokens);
      continue;
    }

    const generic = value as Tokens.Generic;
    const childProperties = extensionChildren[generic.type];
    if (childProperties) {
      for (let index = childProperties.length - 1; index >= 0; index--)
        pending.push(generic[childProperties[index]]);
    } else if (Array.isArray(generic.tokens)) {
      pending.push(generic.tokens);
    }
  }

  const proof = Object.freeze({});
  SEMANTIC_GRAPH_SNAPSHOTS.set(proof, reachable);
  return proof;
}

export function markedSemanticTokenGraphContains(
  proof: IMarkedSemanticTokenGraphSnapshot,
  target: object,
): boolean {
  const reachable = SEMANTIC_GRAPH_SNAPSHOTS.get(proof);
  if (!reachable)
    changed();
  return reachable.has(target);
}
