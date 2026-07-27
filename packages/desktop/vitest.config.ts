import { defineConfig } from 'vitest/config'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import vue from '@vitejs/plugin-vue'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export default defineConfig({
  plugins: [vue()],
  test: {
    allowOnly: false,
    environment: 'jsdom',
    include: ['test/unit/specs/**/*.spec.ts'],
    setupFiles: ['./test/unit/setup.ts'],
    // Verification runs under macOS background task policy by design. Leave
    // enough headroom for first-import transforms without weakening assertions.
    testTimeout: 15_000,
    globals: true
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      common: resolve(__dirname, 'src/common'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@marktext/document-view': resolve(
        __dirname,
        '../document-view/src/index.ts'
      ),
      main_renderer: resolve(__dirname, 'src/main')
    },
    extensions: ['.mjs', '.ts', '.js', '.json']
  }
})
