import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Test-only UTF-8/no-BOM persistence target; not the production FileSnapshot contract. */
export class TemporaryUtf8FileSnapshot {
    readonly #path: string;

    constructor(path: string) {
        this.#path = path;
    }

    async replace(chunks: readonly string[]): Promise<void> {
        await mkdir(dirname(this.#path), { recursive: true });
        await writeFile(this.#path, Buffer.from(chunks.join(''), 'utf8'));
    }

    readBytes(): Promise<Buffer> {
        return readFile(this.#path);
    }
}
