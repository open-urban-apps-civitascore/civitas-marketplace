import type { CatalogSummary, Contact, Curation, MediaItem, Reference } from '@/lib/catalog/types'
import {
    COST_BAND_LABELS,
    COST_BAND_SHORT,
    EFFORT_BAND_LABELS,
    EFFORT_BAND_SHORT,
    FIELD_LABELS,
    LOGIC_MODEL_STEPS,
    THEME_LABELS,
    USE_CASE_STATUS_HINTS,
    USE_CASE_STATUS_LABELS,
} from '@/lib/catalog/vocabulary'

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

export interface Fact {
    label: string
    values: string[]
    badge?: string
    hint?: string
}

export type FactGroupKey = 'classification' | 'people' | 'costs'

export interface FactGroup {
    key: FactGroupKey
    label: string
    facts: Fact[]
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

export function factGroups(summary: CatalogSummary): FactGroup[] {
    const implementation = summary.implementation
    const resources = implementation?.resources
    const status = implementation?.status

    const classification: Fact[] = []
    if (status) {
        classification.push({
            label: FIELD_LABELS.status,
            values: [USE_CASE_STATUS_LABELS[status]],
            hint: USE_CASE_STATUS_HINTS[status],
        })
    }

    const people: Fact[] = []
    if (implementation?.operator) {
        people.push({ label: FIELD_LABELS.operator, values: [implementation.operator] })
    }
    pushList(people, FIELD_LABELS.stakeholders, implementation?.parties?.stakeholders)
    pushList(people, FIELD_LABELS.serviceProviders, implementation?.parties?.serviceProviders)

    const costs: Fact[] = []

    if (resources?.totalCost) {
        costs.push({
            label: FIELD_LABELS.totalCost,
            values: [COST_BAND_LABELS[resources.totalCost]],
            badge: COST_BAND_SHORT[resources.totalCost],
        })
    }
    if (resources?.setupCost) {
        costs.push({
            label: FIELD_LABELS.setupCost,
            values: [COST_BAND_LABELS[resources.setupCost]],
            badge: COST_BAND_SHORT[resources.setupCost],
        })
    }
    if (resources?.runningCost) {
        costs.push({
            label: FIELD_LABELS.runningCost,
            values: [COST_BAND_LABELS[resources.runningCost]],
            badge: COST_BAND_SHORT[resources.runningCost],
        })
    }
    if (resources?.effort) {
        costs.push({
            label: FIELD_LABELS.effort,
            values: [EFFORT_BAND_LABELS[resources.effort]],
            badge: EFFORT_BAND_SHORT[resources.effort],
        })
    }
    if (resources?.funding) {
        costs.push({ label: FIELD_LABELS.funding, values: [resources.funding] })
    }
    
    if (resources?.note) {
        costs.push({ label: FIELD_LABELS.note, values: [resources.note] })
    }

    const groups: FactGroup[] = [
        { key: 'classification', label: 'Einordnung', facts: classification },
        { key: 'people', label: 'Wer dahintersteht', facts: people },
        { key: 'costs', label: 'Kosten und Aufwand', facts: costs },
    ]
    return groups.filter((group) => group.facts.length > 0)
}

export function logicModelSteps(summary: CatalogSummary) {
    const logicModel = summary.implementation?.logicModel
    if (!logicModel) return []
    return LOGIC_MODEL_STEPS.map((step) => ({ ...step, text: logicModel[step.key] })).filter(
        (step): step is (typeof LOGIC_MODEL_STEPS)[number] & { text: string } =>
            typeof step.text === 'string',
    )
}

export function collaborationInvite(summary: CatalogSummary): { seeking?: string } | undefined {
    const collaboration = summary.implementation?.collaboration
    return collaboration?.wanted ? { seeking: collaboration.seeking } : undefined
}

function pushList(facts: Fact[], label: string, items: string[] | undefined): void {
    if (items && items.length > 0) facts.push({ label, values: items })
}
