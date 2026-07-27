import type {
  DocumentSessionJournalCommit,
  DocumentSessionJournalStorage,
  DocumentSessionJournalValue
} from '@marktext/document-core'
import {
  Worker,
  type WorkerOptions
} from 'node:worker_threads'
import path from 'node:path'
import type {
  DocumentCoreWorkerCommand,
  DocumentCoreWorkerCommandResponse,
  DocumentCoreWorkerStorageRequest,
  DocumentCoreWorkerToMainMessage
} from './documentSessionWorkerProtocol'
import {
  DOCUMENT_CORE_ACTIVE_EXECUTION_INDEX,
  DOCUMENT_CORE_CANCEL_OBSERVED_INDEX,
  DOCUMENT_CORE_CANCEL_REQUESTED_INDEX,
  DOCUMENT_CORE_EXECUTION_CHECKPOINT_INDEX,
  DOCUMENT_CORE_EXECUTION_CONTROL_WORDS,
  type DocumentCoreWorkerData
} from './documentSessionWorkerProtocol'

interface PendingCommand {
  readonly resolve: (value: unknown) => void
  readonly reject: (reason: unknown) => void
}

export class DocumentSessionWorkerExitError extends Error {
  readonly exitCode: number

  constructor(exitCode: number) {
    super(`Document session worker exited with code ${exitCode}`)
    this.name = 'DocumentSessionWorkerExitError'
    this.exitCode = exitCode
  }
}

function workerOptions(
  executionControl: SharedArrayBuffer
): Readonly<{
    entry: URL | string
    options: WorkerOptions
  }> {
  const workerData: DocumentCoreWorkerData = Object.freeze({
    executionControl
  })
  if (process.env.VITEST === 'true') {
    return Object.freeze({
      entry: path.resolve(
        process.cwd(),
        'src/main/documentCore/documentSessionWorker.ts'
      ),
      options: Object.freeze({
        execArgv: ['--import', 'tsx'],
        workerData
      })
    })
  }
  return Object.freeze({
    entry: path.join(__dirname, 'documentSessionWorker.js'),
    options: Object.freeze({ workerData })
  })
}

function revivedError(record: Readonly<{
  name: string
  message: string
  stack?: string
}>): Error {
  const error = new Error(record.message)
  error.name = record.name
  if (record.stack !== undefined) error.stack = record.stack
  return error
}

function rehomeWorkerBytesForTest(value: unknown): unknown {
  if (
    process.env.VITEST !== 'true' ||
    value === null ||
    typeof value !== 'object' ||
    !('envelope' in value) ||
    value.envelope === null ||
    typeof value.envelope !== 'object' ||
    !('members' in value.envelope) ||
    !Array.isArray(value.envelope.members)
  ) {
    return value
  }
  return {
    ...value,
    envelope: {
      ...value.envelope,
      members: value.envelope.members.map((member: unknown) => {
        if (
          member === null ||
          typeof member !== 'object' ||
          !('chunks' in member) ||
          !Array.isArray(member.chunks)
        ) {
          return member
        }
        return {
          ...member,
          chunks: member.chunks.map((chunk: unknown) => {
            if (
              chunk === null ||
              typeof chunk !== 'object' ||
              !('bytes' in chunk)
            ) {
              return chunk
            }
            return {
              ...chunk,
              bytes: new Uint8Array(chunk.bytes as ArrayLike<number>)
            }
          })
        }
      })
    }
  }
}

/**
 * Main-side proxy for exactly one worker-thread-owned DocumentSession.
 *
 * The proxy authenticates no renderer input; its caller does that before a
 * command crosses this seam. It only transports commands and services the
 * worker's durable journal requests.
 */
export class IsolatedDocumentSession {
  readonly executionThreadId: number
  readonly #worker: Worker
  readonly #storage: DocumentSessionJournalStorage
  readonly #executionControl: Int32Array
  readonly #pending = new Map<number, PendingCommand>()
  readonly #storageOperations = new Set<Promise<void>>()
  #nextRequestId = 0
  #nextExecutionGeneration = 0
  #closed = false
  #intentionalTermination = false

  constructor(
    storage: DocumentSessionJournalStorage,
    onUnexpectedExit?: (error: DocumentSessionWorkerExitError) => void
  ) {
    this.#storage = storage
    const executionControl = new SharedArrayBuffer(
      DOCUMENT_CORE_EXECUTION_CONTROL_WORDS * Int32Array.BYTES_PER_ELEMENT
    )
    this.#executionControl = new Int32Array(executionControl)
    const resolved = workerOptions(executionControl)
    this.#worker = new Worker(resolved.entry, resolved.options)
    this.#worker.unref()
    this.executionThreadId = this.#worker.threadId
    this.#worker.on('message', (message: DocumentCoreWorkerToMainMessage) => {
      this.#receive(message)
    })
    this.#worker.on('error', (error) => {
      this.#failAll(error)
    })
    this.#worker.on('exit', (code) => {
      const unexpected = !this.#intentionalTermination
      this.#closed = true
      const error = new DocumentSessionWorkerExitError(code)
      this.#failAll(error)
      if (unexpected) onUnexpectedExit?.(error)
    })
  }

  get isAlive(): boolean {
    return !this.#closed
  }

  get activeExecutionGeneration(): number {
    return Atomics.load(
      this.#executionControl,
      DOCUMENT_CORE_ACTIVE_EXECUTION_INDEX
    )
  }

  nextExecutionGeneration(): number {
    this.#nextExecutionGeneration += 1
    if (this.#nextExecutionGeneration > 0x7fff_ffff) {
      this.#nextExecutionGeneration = 1
    }
    return this.#nextExecutionGeneration
  }

  async requestExecutionCancellation(
    executionGeneration: number,
    timeoutMs: number
  ): Promise<boolean> {
    if (
      !Number.isInteger(executionGeneration) ||
      executionGeneration <= 0
    ) {
      throw new RangeError('Cancellation execution generation is invalid')
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new RangeError('Cancellation observation timeout is invalid')
    }
    Atomics.store(
      this.#executionControl,
      DOCUMENT_CORE_CANCEL_REQUESTED_INDEX,
      executionGeneration
    )
    Atomics.notify(
      this.#executionControl,
      DOCUMENT_CORE_CANCEL_REQUESTED_INDEX
    )
    const deadline = performance.now() + timeoutMs
    while (
      Atomics.load(
        this.#executionControl,
        DOCUMENT_CORE_CANCEL_OBSERVED_INDEX
      ) !== executionGeneration
    ) {
      if (performance.now() >= deadline) return false
      await new Promise<void>((resolve) => setTimeout(resolve, 1))
    }
    return true
  }

  async waitForExecutionCheckpoint(
    executionGeneration: number,
    timeoutMs: number
  ): Promise<boolean> {
    if (
      !Number.isInteger(executionGeneration) ||
      executionGeneration <= 0 ||
      !Number.isFinite(timeoutMs) ||
      timeoutMs < 0
    ) {
      throw new RangeError('Execution checkpoint wait is invalid')
    }
    const deadline = performance.now() + timeoutMs
    while (
      Atomics.load(
        this.#executionControl,
        DOCUMENT_CORE_EXECUTION_CHECKPOINT_INDEX
      ) !== executionGeneration
    ) {
      if (performance.now() >= deadline) return false
      await new Promise<void>((resolve) => setTimeout(resolve, 1))
    }
    return true
  }

  async waitForStorageIdle(): Promise<void> {
    while (this.#storageOperations.size > 0) {
      await Promise.allSettled([...this.#storageOperations])
    }
  }

  command<Result>(command: DocumentCoreWorkerCommand): Promise<Result> {
    if (this.#closed) {
      return Promise.reject(new Error('Document session worker is closed'))
    }
    this.#nextRequestId += 1
    const requestId = this.#nextRequestId
    return new Promise<Result>((resolve, reject) => {
      this.#pending.set(requestId, {
        resolve: (value) => resolve(value as Result),
        reject
      })
      this.#worker.postMessage(Object.freeze({
        kind: 'command',
        requestId,
        command
      }))
    })
  }

  async terminate(): Promise<void> {
    if (this.#closed) return
    this.#intentionalTermination = true
    this.#closed = true
    this.#failAll(new Error('Document session worker was terminated'))
    await this.#worker.terminate()
  }

  async close(): Promise<void> {
    if (this.#closed) return
    await this.command<void>(Object.freeze({ kind: 'close' }))
    this.#intentionalTermination = true
    this.#closed = true
    await this.#worker.terminate()
  }

  #receive(message: DocumentCoreWorkerToMainMessage): void {
    if (message.kind === 'ready') {
      if (message.executionThreadId !== this.executionThreadId) {
        this.#failAll(
          new Error('Document session worker reported a false thread identity')
        )
      }
      return
    }
    if (message.kind === 'storage-request') {
      const operation = this.#serviceStorage(message)
      this.#storageOperations.add(operation)
      operation.then(
        () => this.#storageOperations.delete(operation),
        (error: unknown) => {
          this.#storageOperations.delete(operation)
          this.#failAll(
            error instanceof Error ? error : new Error(String(error))
          )
        }
      )
      return
    }
    this.#completeCommand(message)
  }

  #completeCommand(message: DocumentCoreWorkerCommandResponse): void {
    const pending = this.#pending.get(message.requestId)
    if (pending === undefined) return
    this.#pending.delete(message.requestId)
    if (message.error === undefined) {
      pending.resolve(rehomeWorkerBytesForTest(message.result))
    } else {
      pending.reject(revivedError(message.error))
    }
  }

  async #serviceStorage(
    request: DocumentCoreWorkerStorageRequest
  ): Promise<void> {
    try {
      let result:
        | DocumentSessionJournalValue
        | DocumentSessionJournalCommit
        | null
      if (request.operation.kind === 'read') {
        result = await this.#storage.read(request.operation.key)
      } else {
        result = await this.#storage.compareExchange(
          request.operation.key,
          request.operation.expectedRevision,
          request.operation.mutation
        )
      }
      if (this.#closed) return
      this.#worker.postMessage(Object.freeze({
        kind: 'storage-response',
        requestId: request.requestId,
        result
      }))
    } catch (error) {
      if (this.#closed) return
      const normalized =
        error instanceof Error ? error : new Error(String(error))
      this.#worker.postMessage(Object.freeze({
        kind: 'storage-response',
        requestId: request.requestId,
        error: Object.freeze({
          name: normalized.name,
          message: normalized.message,
          ...(normalized.stack === undefined
            ? {}
            : { stack: normalized.stack })
        })
      }))
    }
  }

  #failAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      pending.reject(error)
    }
    this.#pending.clear()
  }
}
