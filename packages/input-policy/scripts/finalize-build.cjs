const { renameSync, writeFileSync } = require('node:fs')
renameSync('dist/cjs/index.js', 'dist/cjs/index.cjs')
// Keep compiler-emitted sibling .js modules in the advertised CommonJS scope.
writeFileSync('dist/cjs/package.json', JSON.stringify({ type: 'commonjs' }) + '\n')
