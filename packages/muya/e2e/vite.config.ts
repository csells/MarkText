import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
    root: 'host',
    resolve: { alias: { '@': fileURLToPath(new URL('../../desktop/src/renderer/src', import.meta.url)) } },
    server: {
        port: 5174,
        strictPort: true,
    },
    optimizeDeps: {
        exclude: ['intl-segmenter-polyfill'],
    },
});
