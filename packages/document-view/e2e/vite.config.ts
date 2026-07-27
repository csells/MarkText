import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
    root: resolve(import.meta.dirname, 'host'),
    resolve: {
        alias: {
            '@marktext/document-view': resolve(
                import.meta.dirname,
                '../src/index.ts',
            ),
        },
    },
    server: {
        host: '127.0.0.1',
        port: 5174,
        strictPort: true,
    },
});
