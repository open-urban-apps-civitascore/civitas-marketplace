import { z } from 'zod'

import {
    costBandSchema,
    curationTierSchema,
    effortBandSchema,
    themeSchema,
    useCaseStatusSchema,
} from '@/lib/catalog/vocabulary'

/**
 * The catalogue index as a schema — the single definition of the wire format
 * that `index.json` speaks.
 */
const COMMIT_SHA = /^[0-9a-f]{40}$/i

/**
 * The id of a use case: `urn:<publisher>:usecase:<name>`, with both parts
 * already URL-safe. Matches what the export writes (`SEGMENT` and `SLUG` in
 * lib/export-actions) and is deliberately tighter than "some string".
 *
 * This is what makes the readable address `/use-cases/<publisher>/<name>` safe.
 * That address is two segments of this id copied verbatim, so as long as the id
 * conforms, distinct ids give distinct addresses — uniqueness of the address
 * follows from uniqueness of the id, which the catalogue already enforces, and
 * no separate rule has to be maintained or policed.
 *
 * Without this, the address would be derived by flattening whatever the id
 * happened to contain, and `urn:x:usecase:a-b` and `urn:x:usecase:a:b` would
 * both address `/x/a-b`: two entries, one URL, and a reader shown the wrong
 * costs. See lib/use-case-catalog/path.
 *
 * Data structures are NOT constrained: their id is a CORE URN owned by the
 * platform (`urn:core:standard:…`), they have no detail route, and redefining
 * their identity is not ours to do.
 */
const PUBLISHER_PATTERN = '[a-z0-9]{2,40}'

const NAME_PATTERN = '[a-z0-9][a-z0-9-]{0,58}[a-z0-9]'

/** The `<name>` part on its own — the export validates its slug field with this. */
export const useCaseSlugPattern = new RegExp(`^${NAME_PATTERN}$`)

const USE_CASE_ID = new RegExp(`^urn:${PUBLISHER_PATTERN}:usecase:${NAME_PATTERN}$`)

const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

const isSafeRelativePath = (value: string) =>
    value === '.' || value.split('/').every((segment) => SAFE_PATH_SEGMENT.test(segment))

const relativePathSchema = z.string().refine(isSafeRelativePath, 'must be a plain relative path')

/**
 * Where the package content lives, pinned to an immutable commit.
 *
 * `ref` must be the commit itself. A tag or branch name here would resolve to
 * whatever it points at on the day of the install, laundering mutable content
 * through something that looks like a pin — `releaseTag` carries the human
 * name, and is never fetched.
 */
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

/**
 * A screenshot of the running thing - the one image nobody but the operating
 * municipality can supply, which is why it arrives through the form.
 */
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
    /**
     * Must be ABSENT, not merely optional. The parser decides the branch by
     * asking whether a pin is present, so a row carrying both a reference and
     * a pin is parsed as pinned and rejected if that pin is not a commit.
     * Without this the generated JSON Schema would accept such a row through
     * this branch, CI would pass it, and the runtime would then reject the
     * whole index into last-known-good — silently.
     */
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
