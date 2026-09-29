import { writeFileSync } from 'node:fs'
import path from 'node:path'

import { renderIndexJsonSchema } from '@/lib/catalog/json-schema'

/**
 * Writes `data/index.schema.json` from the Zod schema.
 *
 * Run `pnpm generate-schema` after changing lib/catalog/schema.ts.
 *
 */
const outputPath = path.resolve(import.meta.dirname, '../data/index.schema.json')
writeFileSync(outputPath, renderIndexJsonSchema())
console.log(`Wrote ${outputPath}`)
console.log('Commit it here. The catalogue CI fetches it live (D7) — never copy it across.')
