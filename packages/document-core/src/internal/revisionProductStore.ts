export interface RevisionProductStoreRecorder {
  readonly recordStrongAcquire: () => void
  readonly recordStrongRelease: () => void
}

/**
 * Owns the only strong parse-product reference for one revision. Demoted
 * historical reads rehydrate for one callback. The facade may explicitly
 * retain a rehydrated product only after proving this store still belongs to
 * the current revision.
 */
export interface RevisionProductStore<Product> {
  /**
   * Runs with the retained or ephemerally rehydrated product. Callers on an
   * historical store must return detached data: never return Product itself
   * or any product-backed object or closure.
   */
  readonly withProduct: <Result>(
    use: (product: Product) => Result,
    retain?: boolean
  ) => Result
  readonly demoteStrong: <Result>(
    select: (product: Product) => Result
  ) => Result | undefined
  readonly releaseStrong: () => void
}

export function createRevisionProductStore<Product>(
  initial: Product | undefined,
  rehydrate: () => Product,
  recorder: RevisionProductStoreRecorder
): RevisionProductStore<Product> {
  let strong = initial
  let mayRetain = true
  if (strong !== undefined) recorder.recordStrongAcquire()

  const withProduct = <Result>(
    use: (product: Product) => Result,
    retain: boolean = false
  ): Result => {
    if (strong !== undefined) return use(strong)
    const product = rehydrate()
    if (retain) mayRetain = true
    if (mayRetain) {
      strong = product
      recorder.recordStrongAcquire()
    }
    return use(product)
  }
  const releaseStrong = (): void => {
    demoteStrong(() => undefined)
  }
  const demoteStrong = <Result>(
    select: (product: Product) => Result
  ): Result | undefined => {
    mayRetain = false
    if (strong === undefined) return
    try {
      return select(strong)
    } finally {
      strong = undefined
      recorder.recordStrongRelease()
    }
  }
  return Object.freeze({
    withProduct: Object.freeze(withProduct),
    demoteStrong: Object.freeze(demoteStrong),
    releaseStrong: Object.freeze(releaseStrong)
  })
}
