import { z } from 'zod'

import { NAME_PATTERN, PUBLISHER_PATTERN } from '@/lib/catalog/use-case-id'
import {
    costBandSchema,
    curationTierSchema,
    effortBandSchema,
    themeSchema,
    useCaseStatusSchema,
} from '@/lib/catalog/vocabulary'

// The single definition of the wire format of the catalogue's `index.json`.
const COMMIT_SHA = /^[0-9a-f]{40}$/i

export { useCaseSlugPattern } from '@/lib/catalog/use-case-id'

// Tight on purpose: `/use-cases/<publisher>/<name>` copies the id's two parts, so distinct ids give
// distinct addresses (lib/use-case-catalog/path). Data structure ids are the platform's: unconstrained.
const USE_CASE_ID = new RegExp(`^urn:${PUBLISHER_PATTERN}:usecase:${NAME_PATTERN}$`)

const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

const isSafeRelativePath = (value: string) =>
    value === '.' || value.split('/').every((segment) => SAFE_PATH_SEGMENT.test(segment))

const relativePathSchema = z.string().refine(isSafeRelativePath, 'must be a plain relative path')

/** `ref` must be a commit: a tag or branch moves. `releaseTag` is only the human name, never fetched. */
export const deploymentRefSchema = z.object({
    url: z.url({ protocol: /^https$/ }),
    ref: z.string().regex(COMMIT_SHA, 'must be a full 40-hex commit SHA'),
    releaseTag: z.string().nullish(),
    path: relativePathSchema.nullish(),
})

export const contactSchema = z
    .object({
        name: z.string().min(1).optional(),
        role: z.string().min(1).optional(),
        email: z.email().optional(),
        url: z.url({ protocol: /^https$/ }).optional(),
    })
    .refine((contact) => Boolean(contact.email ?? contact.url), 'needs an email or a url')

export const mediaSchema = z.object({
    src: z
        .string()
        .min(1)
        .refine(
            (src) => (/^https?:\/\//i.test(src) ? src.startsWith('https://') : isSafeRelativePath(src)),
            'must be an https URL or a plain relative path',
        ),
    alt: z.string().min(1),
    caption: z.string().min(1).optional(),
})

export const resourcesSchema = z.object({
    totalCost: costBandSchema.optional(),
    setupCost: costBandSchema.optional(),
    runningCost: costBandSchema.optional(),
    effort: effortBandSchema.optional(),
    funding: z.string().min(1).optional(),
    note: z.string().min(1).optional(),
})

export const referenceSchema = z.object({
    url: z.url({ protocol: /^https$/ }),
    source: z.string().min(1).optional(),
})


export const implementationSchema = z.object({
    status: useCaseStatusSchema.optional(),
    operator: z.string().min(1).optional(),
    parties: z
        .object({
            stakeholders: z.array(z.string().min(1)).optional(),
            serviceProviders: z.array(z.string().min(1)).optional(),
        })
        .optional(),
    stack: z.array(z.string().min(1)).optional(),
    resources: resourcesSchema.optional(),
    logicModel: z
        .object({
            input: z.string().min(1).optional(),
            output: z.string().min(1).optional(),
            impact: z.string().min(1).optional(),
            outcome: z.string().min(1).optional(),
        })
        .optional(),
    collaboration: z
        .object({ wanted: z.boolean(), seeking: z.string().min(1).optional() })
        .optional(),
    reference: referenceSchema.optional(),
})

export const curationSchema = z.object({
    tier: curationTierSchema,
    reviewedBy: z.string().min(1),
    reviewedAt: z.union([z.iso.date(), z.iso.datetime()]),
    notes: z.string().min(1).optional(),
})

const entryIdentityShape = {
    id: z.string().min(1),
    type: z.enum(['usecase', 'datastructure']),
    displayName: z.string().min(1),
    description: z.string().min(1),
    version: z.string().min(1),
    maintainer: z.string().min(1),
    license: z.string().min(1),
    keywords: z.array(z.string()),
}

const entryDescriptionShape = {
    themes: z.array(themeSchema).optional(),
    contact: contactSchema.optional(),
    curation: curationSchema.optional(),
    media: z.array(mediaSchema).optional(),
    implementation: implementationSchema.optional(),
}

export const revokedRowSchema = z.looseObject({
    ...entryIdentityShape,
    revoked: z.literal(true),
    revokedReason: z.string().min(1).optional(),
})

function requiresAddressableId<T extends z.ZodType>(schema: T): T {
    return schema.check((ctx) => {
        const row = ctx.value as { id?: unknown; type?: unknown }
        if (row.type !== 'usecase' || typeof row.id !== 'string') return
        if (!USE_CASE_ID.test(row.id)) {
            ctx.issues.push({
                code: 'custom',
                input: row.id,
                path: ['id'],
                message: 'must be urn:<publisher>:usecase:<name>, lower-case and URL-safe',
            })
        }
    })
}

export const describedRowSchema = requiresAddressableId(z.looseObject({
    ...entryIdentityShape,
    ...entryDescriptionShape,
    implementation: implementationSchema.extend({ reference: referenceSchema }),
    // Must be ABSENT: a row with a pin parses as pinned, and without this the JSON Schema would let CI pass
    // a row the runtime then rejects, dropping the whole index to last-known-good.
    deploymentRef: z.undefined().optional(),
}))

export const pinnedRowObject = z.looseObject({
    ...entryIdentityShape,
    ...entryDescriptionShape,
    deploymentRef: deploymentRefSchema,
})

export const pinnedRowSchema = requiresAddressableId(pinnedRowObject)

export const addonRowSchema = z.looseObject({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    author: z.string().min(1),
})

export const catalogSummarySchema = z.union([
    revokedRowSchema,
    describedRowSchema,
    pinnedRowSchema,
])

export const indexEnvelopeSchema = z.looseObject({
    version: z.string().min(1),
    updatedAt: z.string().min(1),
})

export const repoListIndexSchema = indexEnvelopeSchema.extend({
    addons: z.array(addonRowSchema).optional(),
    useCases: z.array(catalogSummarySchema).optional(),
    dataStructures: z.array(catalogSummarySchema).optional(),
})

export type Contact = z.infer<typeof contactSchema>
export type MediaItem = z.infer<typeof mediaSchema>
export type Resources = z.infer<typeof resourcesSchema>
export type Reference = z.infer<typeof referenceSchema>
export type Implementation = z.infer<typeof implementationSchema>
export type Curation = z.infer<typeof curationSchema>
