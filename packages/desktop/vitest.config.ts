import { defineConfig, type ViteUserConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import svgLoader from 'vite-svg-loader'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export default defineConfig({
  // Real-mount component specs (test-infrastructure.md) import .vue SFCs;
  // the svg loader mirrors the app build so icon imports mount unstubbed.
  // Cast: vitest@4 bundles vite@8 (rolldown) plugin types while
  // @vitejs/plugin-vue / vite-svg-loader resolve vite@7's Plugin type — the
  // two are structurally identical at runtime but nominally distinct, so the
  // plugin array is asserted to the type vitest's own config expects.
  plugins: [vue(), svgLoader()] as ViteUserConfig['plugins'],
  test: {
    environment: 'jsdom',
    include: ['test/unit/specs/**/*.spec.ts'],
    setupFiles: ['test/unit/setup.ts'],
    globals: true
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      common: resolve(__dirname, 'src/common'),
      '@shared': resolve(__dirname, 'src/shared'),
      main_renderer: resolve(__dirname, 'src/main')
    },
    extensions: ['.mjs', '.ts', '.js', '.json']
  }
})
