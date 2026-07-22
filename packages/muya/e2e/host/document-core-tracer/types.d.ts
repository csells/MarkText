interface DocumentCoreTracerGeneration {
    readonly revision: string;
    readonly text: string;
}

interface Window {
    /** Test-only controller for the isolated document-core walking tracer. */
    documentCoreTracer?: {
        undo: () => Promise<void>;
        redo: () => Promise<void>;
        save: () => Promise<'released' | 'already-terminal'>;
        generations: () => readonly DocumentCoreTracerGeneration[];
    };

    /** Playwright-owned byte sink installed before the tracer page loads. */
    persistDocumentCoreSnapshot?: (chunks: readonly string[]) => Promise<void>;
}
