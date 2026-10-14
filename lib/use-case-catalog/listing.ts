import type { CatalogSummary, Contact, Curation, MediaItem, Reference } from '@/lib/catalog/types'
import { THEME_LABELS } from '@/lib/catalog/vocabulary'

/**
 * Turns one catalogue row into what the use-case detail page renders.
 */

export type UseCaseState = 'installable' | 'described' | 'unlisted'

export interface UseCaseListing {
    id: string
    displayName: string
    description: string
    version: string
    publisher: string
    publisherRole: string
    license: string
    state: UseCaseState
    themes: string[]
    keywords: string[]
    curation?: Curation
    contact?: Contact
    media: MediaItem[]
    reference?: Reference
    stack: string[]
    install?: { url: string; ref: string; releaseTag: string | null; path: string }
}

export function buildUseCaseListing(summary: CatalogSummary): UseCaseListing {
    const { deploymentRef, implementation } = summary
    const reference = implementation?.reference

    return {
        id: summary.id,
        displayName: summary.displayName,
        description: summary.description,
        version: summary.version,
        publisher: summary.maintainer,
        publisherRole: deploymentRef ? 'Herausgeber' : 'Katalogeintrag gepflegt von',
        license: summary.license,
        state: deploymentRef ? 'installable' : reference ? 'described' : 'unlisted',
        themes: (summary.themes ?? []).map((theme) => THEME_LABELS[theme]),
        keywords: summary.keywords,
        curation: summary.curation,
        contact: summary.contact,
        media: summary.media ?? [],
        reference,
        stack: implementation?.stack ?? [],
        install: deploymentRef && {
            url: deploymentRef.url,
            ref: deploymentRef.ref,
            releaseTag: deploymentRef.releaseTag,
            path: deploymentRef.path,
        },
    }
}
