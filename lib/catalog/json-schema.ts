import { z } from 'zod'

import { repoListIndexSchema } from '@/lib/catalog/schema'

/**
 * The catalogue index as a JSON Schema, rendered from the Zod definition.
 *
 * Intended as the catalogue repository's CI gate, so a submission that passes
 * review cannot fail in the marketplace's own parser.
 */
const JSON_SCHEMA_ID =
    'https://gitlab.com/civitascore-openurbanapps/civitas-marketplace-catalog/index.schema.json'

function buildIndexJsonSchema(): Record<string, unknown> {
    const rendered = z.toJSONSchema(repoListIndexSchema, {
        target: 'draft-7',
        io: 'input',
        unrepresentable: 'any',
    })
    return {
        $id: JSON_SCHEMA_ID,
        title: 'CIVITAS Marketplace catalogue index',
        description:
            'Generated from lib/catalog/schema.ts in civitas-marketplace — do not edit by hand.',
        ...rendered,
    }
}

export function renderIndexJsonSchema(): string {
    return `${JSON.stringify(buildIndexJsonSchema(), null, 2)}\n`
}
