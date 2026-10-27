import { useCaseSlugPattern } from '@/lib/catalog/use-case-id'

/**
 * Where the wizard of "Teilen" stands, as an address (plan of 2026-10-18,
 * decision "Browser back in the wizard"). Each step has its own, as the
 * catalogue pages do, so browser back goes one step back, forward one step
 * forward, a reload stays on the step and a step can be sent as a link:
 *
 *   /export/new                                   „Auswählen“, nothing chosen
 *   /export/new?source=dataset:<id>               „Auswählen“ with the dataset chosen
 *   /export/new?source=dataset:<id>&resume=1      … and its started share continued instead of asked about
 *   /export/new?source=dataset:<id>&step=steckbrief
 *   /export/new?source=dataset:<id>&step=vorschau
 *
 * And from the lists, on any of these:
 *
 *   …&from=<version>&package=<slug>           „Neue Version teilen“: the Steckbrief filled from that shared version
 *   …&from=<version>&package=<slug>&again=1   „Erneut einreichen“: the same version once more
 *
 * `from` stays on every step, so a reload fills the Steckbrief the same way;
 * without a dataset it waits for the person's choice.
 *
 * Pure, for the wizard and its tests. The page writes these addresses with
 * `history.pushState` / `replaceState` (components/export/use-wizard-address.ts),
 * which Next 16 keeps in step with `useSearchParams` without asking the
 * server again, so a step never re-runs the page's reads of the portal.
 */

export const WIZARD_PATH = '/export/new'

/** 1 „Auswählen“, 2 „Steckbrief ergänzen“, 3 „Vorschau & Teilen“. */
export type WizardStep = 1 | 2 | 3

/** The `step` parameter of each step; „Auswählen“ goes without one. */
const STEP_PARAM: Record<WizardStep, string | undefined> = { 1: undefined, 2: 'steckbrief', 3: 'vorschau' }

/** The kind of source in `source=<kind>:<id>`; data structures get their own kind later (plan, section 9). */
const DATASET = 'dataset:'

const VERSION = /^\d+\.\d+\.\d+$/

/**
 * The shared version a new one starts from (`from=`), with its package's
 * short name: the version alone names no package once the dataset is gone.
 * `again`: the same version once more („Erneut einreichen“).
 */
export interface ShareFrom {
    version: string
    slug?: string
    again?: boolean
}

export interface WizardAddress {
    /** The dataset `source=dataset:<id>` names; absent without one, or for a kind this wizard does not know. */
    datasetId?: string
    /** The step asked for; an unknown or missing `step` asks for „Auswählen“. */
    step: WizardStep
    /**
     * `resume=1`: at „Auswählen“, continue the dataset's started share rather
     * than ask „Weitermachen“ or „Neu beginnen“. Set once the person chose to
     * go on, so coming back to the step does not ask again. From the
     * Steckbrief on, a started share is always continued, so it is dropped there.
     */
    resume?: boolean
    /** What the Steckbrief is filled from (`from=`, `package=`, `again=`). */
    from?: ShareFrom
}

/** Just what is read of the query: `URLSearchParams` and Next's `useSearchParams()` both have it. */
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

/** Read defensively: a version that is no x.y.z, or a short name the catalogue would refuse, is dropped. */
function fromOf(query: QueryLike): { from?: ShareFrom } {
    const version = query.get('from')?.trim() ?? ''
    if (!VERSION.test(version)) return {}
    const slug = query.get('package')?.trim().toLowerCase() ?? ''
    return { from: { version, ...(useCaseSlugPattern.test(slug) ? { slug } : {}), ...(query.get('again') === '1' ? { again: true } : {}) } }
}

/**
 * The query of an address, always in one spelling, so two addresses of the
 * same step compare equal: source, then step, then resume (only at
 * „Auswählen“, and only with a dataset), then from, package and again (also
 * without a dataset). The colon stays readable, as the plan writes it; the
 * id is encoded.
 */
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

/** Where „Weitermachen“ on a started share leads: back to the step it was saved at, continued. */
export function resumeHref(draft: { datasetId: string; step: 1 | 2 }): string {
    return wizardHref({ datasetId: draft.datasetId, step: draft.step, resume: true })
}

/** A shared version, for links into the wizard; without `datasetId` (the dataset is gone) the person chooses one. */
export interface SharedVersionRef {
    datasetId?: string
    slug: string
    version: string
}

/** Where „Neue Version teilen“ leads: the wizard with the dataset chosen and the Steckbrief filled from this version. */
export function newVersionHref(shared: SharedVersionRef): string {
    return wizardHref({ ...(shared.datasetId ? { datasetId: shared.datasetId } : {}), step: 1, from: { version: shared.version, slug: shared.slug } })
}

/** Where „Erneut einreichen“ leads: the same version once more, offered only where `sameVersionAgain` allows it. */
export function resubmitHref(shared: SharedVersionRef): string {
    return wizardHref({ ...(shared.datasetId ? { datasetId: shared.datasetId } : {}), step: 1, from: { version: shared.version, slug: shared.slug, again: true } })
}

/** What decides how far an address may lead. */
export interface StepFacts {
    /** The address names a dataset this person may share from here. */
    datasetKnown: boolean
    /** There is a Steckbrief to preview: a started share saved in this browser, or the form filled in on this page. */
    steckbrief: boolean
    /** Whether the dataset has a data structure of its own (the package check needs one); undefined while its content is read. */
    ownStructure?: boolean
}

/**
 * The step an address opens: the one asked for, or the furthest the person
 * may be on yet, without an error (plan, decision of 18.10.). Without a known
 * dataset that is „Auswählen“; without a data structure of its own too, where
 * the content block says why; the preview needs a Steckbrief.
 */
export function reachableStep(asked: WizardStep, facts: StepFacts): WizardStep {
    if (!facts.datasetKnown || facts.ownStructure === false) return 1
    if (asked === 3 && !facts.steckbrief) return 2
    return asked
}

/** The key under which the wizard keeps its own part of a history entry's state. */
export const HISTORY_KEY = 'ouaWizard'

/**
 * The wizard steps before a history entry, as their queries, oldest first,
 * from the entry's state; empty for an entry the wizard did not write (the
 * first one, a link from elsewhere, a reload in a new tab). Read
 * defensively: the state is the browser's, and anything may have put a value
 * there.
 */
export function trailOf(state: unknown): string[] {
    if (typeof state !== 'object' || state === null) return []
    const own = (state as Record<string, unknown>)[HISTORY_KEY]
    if (typeof own !== 'object' || own === null) return []
    const trail = (own as Record<string, unknown>).trail
    return Array.isArray(trail) && trail.every((entry) => typeof entry === 'string') ? trail : []
}

/**
 * How many history entries back the step `target` is, when it is one of the
 * entries this one came from: going back there with `history.go` keeps the
 * browser's forward button meaning "one step forward". Undefined when it is
 * not (the wizard was entered at a later step): the caller replaces the
 * address then.
 */
export function stepsBack(trail: readonly string[], target: WizardAddress): number | undefined {
    for (let index = trail.length - 1; index >= 0; index--) {
        const entry = parseWizardAddress(new URLSearchParams(trail[index]))
        if (entry.datasetId === target.datasetId && entry.step === target.step) return trail.length - index
    }
    return undefined
}
