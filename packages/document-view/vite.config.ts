import { resolve } from 'node:path';
import dts from 'vite-plugin-dts';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    build: {
        target: 'chrome120',
        outDir: 'lib',
        lib: {
            entry: resolve(import.meta.dirname, 'src/index.ts'),
            name: 'MarkTextDocumentView',
            fileName: format => `${format}/index.js`,
            formats: ['es', 'cjs'],
        },
    },
    test: {
        allowOnly: false,
        css: true,
        include: ['src/documentCore/__tests__/**/*.{spec,test}.ts'],
    },
    plugins: [
        dts({
            entryRoot: 'src',
            outDirs: 'lib/types',
        }),
    ],
});
