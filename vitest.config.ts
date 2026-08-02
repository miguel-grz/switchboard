import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Las pruebas comparten una sola base; en paralelo se pisan entre sí.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
})
