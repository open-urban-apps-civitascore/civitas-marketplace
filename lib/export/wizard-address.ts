import { useCaseSlugPattern } from '@/lib/catalog/use-case-id'

// Each wizard step has its own address, so browser back/forward, reload and links work per step.
// Written by use-wizard-address.ts via history.pushState, so a step never re-runs the page's portal reads.

export const WIZARD_PATH = '/export/new'

/** 1 „Auswählen“, 2 „Steckbrief ergänzen“, 3 „Vorschau & Teilen“. */
export type WizardStep = 1 | 2 | 3

const STEP_PARAM: Record<WizardStep, string | undefined> = { 1: undefined, 2: 'steckbrief', 3: 'vorschau' }

const DATASET = 'dataset:'

const VERSION = /^\d+\.\d+\.\d+$/

/** `slug` too: the version alone names no package once the dataset is gone. */
export interface ShareFrom {
    version: string
    slug?: string
    again?: boolean
}

export interface WizardAddress {
    datasetId?: string
    step: WizardStep
    /** Only at „Auswählen“: from the Steckbrief on a started share is always continued. */
    resume?: boolean
    from?: ShareFrom
}

interface QueryLike {
    get(name: string): string | null
}

export function parseWizardAddress(query: QueryLike): WizardAddress {
    const source = query.get('source')?.trim() ?? ''
    const datasetId = source.startsWith(DATASET) ? source.slice(DATASET.length).trim() : ''
    const asked = query.get('step')
    const step: WizardStep = asked === STEP_PARAM[2] ? 2 : asked === STEP_PARAM[3] ? 3 : 1
    return {
        ...(datasetId ? { datasetId } : {}),
        step,
        ...(query.get('resume') === '1' ? { resume: true } : {}),
        ...fromOf(query),
    }
}

function fromOf(query: QueryLike): { from?: ShareFrom } {
    const version = query.get('from')?.trim() ?? ''
    if (!VERSION.test(version)) return {}
    const slug = query.get('package')?.trim().toLowerCase() ?? ''
    return { from: { version, ...(useCaseSlugPattern.test(slug) ? { slug } : {}), ...(query.get('again') === '1' ? { again: true } : {}) } }
}

/** One fixed spelling, so two addresses of the same step compare equal. */
export function wizardSearch(address: WizardAddress): string {
    const parts: string[] = []
    if (address.datasetId) {
        parts.push(`source=${DATASET}${encodeURIComponent(address.datasetId)}`)
        const step = STEP_PARAM[address.step]
        if (step) parts.push(`step=${step}`)
        else if (address.resume) parts.push('resume=1')
    }
    const from = address.from
    if (from && VERSION.test(from.version)) {
        parts.push(`from=${from.version}`)
        if (from.slug) parts.push(`package=${encodeURIComponent(from.slug)}`)
        if (from.again) parts.push('again=1')
    }
    return parts.length ? `?${parts.join('&')}` : ''
}

export function wizardHref(address: WizardAddress): string {
    return `${WIZARD_PATH}${wizardSearch(address)}`
}

export function resumeHref(draft: { datasetId: string; step: 1 | 2 }): string {
    return wizardHref({ datasetId: draft.datasetId, step: draft.step, resume: true })
}

export interface SharedVersionRef {
    datasetId?: string
    slug: string
    version: string
}

export function newVersionHref(shared: SharedVersionRef): string {
    return wizardHref({ ...(shared.datasetId ? { datasetId: shared.datasetId } : {}), step: 1, from: { version: shared.version, slug: shared.slug } })
}

/** Offer it only where `sameVersionAgain` allows. */
export function resubmitHref(shared: SharedVersionRef): string {
    return wizardHref({ ...(shared.datasetId ? { datasetId: shared.datasetId } : {}), step: 1, from: { version: shared.version, slug: shared.slug, again: true } })
}

export interface StepFacts {
    datasetKnown: boolean
    /** A started share or a filled form exists to preview. */
    steckbrief: boolean
    /** Undefined while the content is read. */
    ownStructure?: boolean
}

export function reachableStep(asked: WizardStep, facts: StepFacts): WizardStep {
    if (!facts.datasetKnown || facts.ownStructure === false) return 1
    if (asked === 3 && !facts.steckbrief) return 2
    return asked
}

export const HISTORY_KEY = 'ouaWizard'

/** Wizard queries before this entry, oldest first; the state is the browser's, so read defensively. */
export function trailOf(state: unknown): string[] {
    if (typeof state !== 'object' || state === null) return []
    const own = (state as Record<string, unknown>)[HISTORY_KEY]
    if (typeof own !== 'object' || own === null) return []
    const trail = (own as Record<string, unknown>).trail
    return Array.isArray(trail) && trail.every((entry) => typeof entry === 'string') ? trail : []
}

/** With `history.go` the forward button keeps meaning one step forward; undefined: replace instead. */
export function stepsBack(trail: readonly string[], target: WizardAddress): number | undefined {
    for (let index = trail.length - 1; index >= 0; index--) {
        const entry = parseWizardAddress(new URLSearchParams(trail[index]))
        if (entry.datasetId === target.datasetId && entry.step === target.step) return trail.length - index
    }
    return undefined
}
