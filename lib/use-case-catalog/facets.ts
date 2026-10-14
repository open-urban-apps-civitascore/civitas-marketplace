import type { FacetDef } from '@/lib/catalog/facets'
import { searchText } from '@/lib/catalog/search'
import type { CatalogSummary } from '@/lib/catalog/types'
import {
    collaborationLabel,
    COST_BAND_LABELS,
    costBandSchema,
    CURATION_TIER_LABELS,
    EFFORT_BAND_LABELS,
    effortBandSchema,
    THEME_LABELS,
    THEME_ORDER,
    USE_CASE_STATUS_LABELS,
    useCaseStatusSchema,
    type CostBand,
    type CurationTier,
    type EffortBand,
    type Theme,
    type UseCaseStatus,
} from '@/lib/catalog/vocabulary'

/**
 * The filters of the use-case catalogue, the clickdummy's set (its
 * lib/catalog-facet-defs.ts) cut to the fields this catalogue has. Not here,
 * because no entry carries the data yet: CivitasCore-Version and Nachnutzer.
 * Added, because the catalogue has it: Gesamtkosten.
 *
 * The mode follows the data (design system §3): a category an entry may carry
 * several of is `multi`; a cost or effort band is `ordinal`, because its label
 * says "unter 10.000 €" and an entry under 1.000 € has to match it.
 *
 * A facet's `id` is also its URL parameter, so `/use-cases?kategorie=umwelt-klima`
 * opens the catalogue filtered.
 */

/** The seal a row has, or that it has none: absent means not reviewed (D11). */
export const NO_SEAL = 'ohne'

const SEAL_ORDER = ['experimental', 'community', 'verified', NO_SEAL] as const

const COST_ORDER = costBandSchema.options
const EFFORT_ORDER = effortBandSchema.options

/** Installable through the portal, or only described (a pin is the one test, see CatalogSummary). */
export const INSTALL_PATH_LABELS = {
    portal: 'Über das Portal',
    beschrieben: 'Nur beschrieben, nicht installierbar',
} as const

const installPath = (row: CatalogSummary): keyof typeof INSTALL_PATH_LABELS =>
    row.deploymentRef ? 'portal' : 'beschrieben'

const band = <T extends string>(value: T | undefined): T[] => (value ? [value] : [])

export const USE_CASE_FACETS: FacetDef<CatalogSummary>[] = [
    {
        id: 'kategorie',
        label: 'Themengebiet',
        mode: 'multi',
        valuesOf: (row) => row.themes ?? [],
        options: THEME_ORDER,
        labelOf: (value) => THEME_LABELS[value as Theme] ?? value,
    },
    {
        id: 'siegel',
        label: 'Siegel',
        mode: 'multi',
        valuesOf: (row) => [row.curation?.tier ?? NO_SEAL],
        options: SEAL_ORDER,
        labelOf: (value) => (value === NO_SEAL ? 'Noch ohne Siegel' : CURATION_TIER_LABELS[value as CurationTier]),
    },
    {
        id: 'status',
        label: 'Use Case Status',
        mode: 'multi',
        valuesOf: (row) => band(row.implementation?.status),
        options: useCaseStatusSchema.options,
        // The whole scale, Idee and In Konzeption included while nothing sits
        // there yet: it says the catalogue takes ideas, not only finished
        // solutions (clickdummy, 2026-10-12).
        showAllOptions: true,
        labelOf: (value) => USE_CASE_STATUS_LABELS[value as UseCaseStatus],
    },
    {
        id: 'gesamtkosten',
        label: 'Gesamtkosten (36 Monate)',
        mode: 'ordinal',
        valuesOf: (row) => band(row.implementation?.resources?.totalCost),
        options: COST_ORDER,
        labelOf: (value) => COST_BAND_LABELS[value as CostBand],
        group: 'more',
    },
    {
        id: 'aufbaukosten',
        label: 'Aufbaukosten',
        mode: 'ordinal',
        valuesOf: (row) => band(row.implementation?.resources?.setupCost),
        options: COST_ORDER,
        labelOf: (value) => COST_BAND_LABELS[value as CostBand],
        group: 'more',
    },
    {
        id: 'betriebskosten',
        label: 'Laufende Kosten (jährlich)',
        mode: 'ordinal',
        valuesOf: (row) => band(row.implementation?.resources?.runningCost),
        options: COST_ORDER,
        labelOf: (value) => COST_BAND_LABELS[value as CostBand],
        group: 'more',
    },
    {
        id: 'aufwand',
        label: 'Ressourceneinsatz',
        mode: 'ordinal',
        valuesOf: (row) => band(row.implementation?.resources?.effort),
        options: EFFORT_ORDER,
        labelOf: (value) => EFFORT_BAND_LABELS[value as EffortBand],
        group: 'more',
    },
    {
        id: 'herausgeber',
        label: 'Herausgeber',
        mode: 'multi',
        valuesOf: (row) => [row.maintainer],
        group: 'more',
    },
    {
        id: 'installation',
        label: 'Installationsweg',
        mode: 'multi',
        valuesOf: (row) => [installPath(row)],
        options: ['portal', 'beschrieben'] as const,
        labelOf: (value) => INSTALL_PATH_LABELS[value as keyof typeof INSTALL_PATH_LABELS],
        group: 'more',
    },
    {
        id: 'kooperation',
        label: 'Kooperationsbedarf',
        mode: 'multi',
        // Every entry lands in exactly one of the two: one that says nothing
        // about partners has not sought any explicitly either.
        valuesOf: (row) => [row.implementation?.collaboration?.wanted ? 'gesucht' : 'nicht-gesucht'],
        options: ['gesucht', 'nicht-gesucht'] as const,
        labelOf: (value) => collaborationLabel(value === 'gesucht'),
        group: 'more',
    },
]

/**
 * The searchable text of a use case: its properties, enumerated. Not
 * `JSON.stringify(row)`, which drags in commit SHAs and URLs, so a search for
 * "2" or "https" would match every row. URLs and the pin stay out; the
 * catalogue id stays in, because people paste it.
 */
export function useCaseSearchText(row: CatalogSummary): string {
    const implementation = row.implementation
    const resources = implementation?.resources
    return searchText(
        row.displayName,
        row.description,
        row.maintainer,
        row.id,
        row.license,
        row.keywords.join(' '),
        (row.themes ?? []).map((theme) => THEME_LABELS[theme]).join(' '),
        row.curation ? CURATION_TIER_LABELS[row.curation.tier] : undefined,
        row.curation?.reviewedBy,
        row.curation?.notes,
        row.contact?.name,
        row.contact?.role,
        INSTALL_PATH_LABELS[installPath(row)],
        implementation?.operator,
        implementation?.status ? USE_CASE_STATUS_LABELS[implementation.status] : undefined,
        implementation?.parties?.stakeholders?.join(' '),
        implementation?.parties?.serviceProviders?.join(' '),
        implementation?.stack?.join(' '),
        resources?.totalCost ? COST_BAND_LABELS[resources.totalCost] : undefined,
        resources?.setupCost ? COST_BAND_LABELS[resources.setupCost] : undefined,
        resources?.runningCost ? COST_BAND_LABELS[resources.runningCost] : undefined,
        resources?.effort ? EFFORT_BAND_LABELS[resources.effort] : undefined,
        resources?.funding,
        resources?.note,
        implementation?.logicModel?.input,
        implementation?.logicModel?.output,
        implementation?.logicModel?.outcome,
        implementation?.logicModel?.impact,
        implementation?.collaboration?.wanted ? implementation.collaboration.seeking : undefined,
        implementation?.reference?.source,
    )
}
