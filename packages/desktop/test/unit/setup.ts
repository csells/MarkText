// Node 26 exposes a configurable localStorage getter that returns undefined
// unless the process receives --localstorage-file. It shadows jsdom's Storage
// object, so install a fresh standards-shaped in-memory store in each worker.
class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(String(key)) ?? null
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(String(key))
  }

  setItem(key: string, value: string): void {
    this.values.set(String(key), String(value))
  }
}

const storage = new MemoryStorage()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  enumerable: true,
  value: storage,
  writable: false
})
