import path from 'node:path'

import { defineConfig } from 'vitest/config'

export default defineConfig({
    resolve: {
        // Mirror tsconfig's '@/*' path alias.
        alias: { '@': path.resolve(import.meta.dirname) },
    },
    test: {
        environment: 'node',
        include: ['lib/**/__tests__/**/*.test.ts'],
    },
})
