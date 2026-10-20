import { verificationLabel } from '@/lib/export/labels'
import { draftStartedOn, type ShareDraft } from '@/lib/export/share-drafts'
import type { SharedPackageRow } from '@/lib/export/share-listing'
import { STAGES, type ShareProgress, type StageKey, type StageState } from '@/lib/export/share-stages'
import { mergeRequestRef } from '@/lib/export/share-state'
import type { ShareOutcome, TabRow } from '@/lib/export/share-tabs'
import { resumeHref, WIZARD_PATH, wizardHref } from '@/lib/export/wizard-address'

/**
 * What „In Arbeit“ lists and what each row says and offers, apart from how it
 * shows it (plan of 2026-10-18, section 4). Pure, for the component and its
 * tests: the stage → action table is data here, so a test can read it row by
 * row.
 *
 * Whose move a row waits for decides its group and its words: „du bist dran“
 * only on what the person looking proposed (or what names nobody), „Ewa ist
 * dran“ on a colleague's, „wartet auf das Katalog-Team“ while the reviewers
 * have it. The tab bar's „1 bei dir“ counts the same rows (`TabRow.mine`).
 */

export type InProgressItem =
    | { kind: 'draft'; key: string; draft: ShareDraft; available: boolean }
    | {
          kind: 'shared'
          key: string
          row: SharedPackageRow
          progress: ShareProgress
          outcome: ShareOutcome
          /** The person's own move (`isYourMove` in share-tabs.ts): what „1 bei dir“ counts. */
          mine: boolean
          /** Versions this one replaced, lowest first. */
          earlier: string[]
      }

export { rowProgress } from '@/lib/export/share-tabs'

/** The datasets this person may read here, by id with their names; `get` is optional where only ids are known. */
export interface DatasetsHere {
    has(datasetId: string): boolean
    get?(datasetId: string): string | undefined
}

/**
 * Whose move a row waits for, in the order „In Arbeit“ lists them:
 * - `yours`: the person's own - a started share, or a stage of theirs on what they proposed
 * - `colleague`: a stage of the sharing side on what someone else here proposed
 * - `team`: the catalogue team decides (a review, a removal)
 * - `nobody`: nobody on the page can move it on - the state could not be read, or only the operator can help
 */
export type Turn = 'yours' | 'colleague' | 'team' | 'nobody'

const TURN_ORDER: Record<Turn, number> = { yours: 0, colleague: 1, team: 2, nobody: 3 }

export function turnOf(item: InProgressItem): Turn {
    if (item.kind === 'draft') return 'yours'
    const { row, progress } = item
    if (item.mine) return 'yours'
    if (row.problem) return 'nobody'
    if (progress.removal === 'pending' || progress.turn === 'reviewers') return 'team'
    return progress.turn === 'you' ? 'colleague' : 'nobody'
}

/** The person's own move: what the tab bar counts as „bei dir“. */
export function isMine(item: InProgressItem): boolean {
    return turnOf(item) === 'yours'
}

/** When the item last changed, as far as known: a draft's last save, else the newest date of any of its proposals. */
export function changedAt(item: InProgressItem): number | undefined {
    if (item.kind === 'draft') return timeOf(item.draft.savedAt)
    const times = (item.row.proposals ?? [])
        .flatMap((proposal) => [proposal.createdAt, proposal.mergedAt, proposal.closedAt])
        .map(timeOf)
        .filter((time): time is number => time !== undefined)
    return times.length ? Math.max(...times) : undefined
}

function timeOf(iso: string | undefined): number | undefined {
    const time = iso ? Date.parse(iso) : NaN
    return Number.isNaN(time) ? undefined : time
}

/** Newest first; what has no date after what has one. */
function newerFirst(a: number | undefined, b: number | undefined): number {
    if (a === b) return 0
    if (a === undefined) return 1
    if (b === undefined) return -1
    return b - a
}

/**
 * The started shares and the versions the tab rules put in „In Arbeit“
 * (`shareTabs(…).inProgress`): the person's own moves, then a colleague's,
 * then what waits on the catalogue team, then what nobody here can move on.
 * Within each group the newest change first; the listing's order among
 * equals. `available`: which datasets are still here.
 */
export function inProgressItems(drafts: ShareDraft[], available: DatasetsHere, rows: readonly TabRow[]): InProgressItem[] {
    const items: InProgressItem[] = [
        ...drafts.map((draft): InProgressItem => ({ kind: 'draft', key: `draft:${draft.datasetId}`, draft, available: available.has(draft.datasetId) })),
        ...rows.map(
            (tabbed): InProgressItem => ({
                kind: 'shared',
                key: tabbed.row.key,
                row: tabbed.row,
                progress: tabbed.progress,
                outcome: tabbed.outcome,
                mine: tabbed.mine,
                earlier: tabbed.earlier,
            }),
        ),
    ]
    return items
        .map((item, index) => ({ item, index, group: TURN_ORDER[turnOf(item)], at: changedAt(item) }))
        .sort((a, b) => a.group - b.group || newerFirst(a.at, b.at) || a.index - b.index)
        .map(({ item }) => item)
}

/**
 * The order to show while the person is inside the list (plan, section 4:
 * rows are not re-sorted while focus is on one of them): the order they saw,
 * without what is gone, and what is new at the end in its own order.
 */
export function keptOrder(seen: readonly string[], next: readonly string[]): string[] {
    const present = new Set(next)
    const kept = seen.filter((key) => present.has(key))
    const known = new Set(kept)
    return [...kept, ...next.filter((key) => !known.has(key))]
}

/** `order` with `key` back at `index` (or last), when it is not in it: where a result stands in for the row it was about. */
export function withSlot(order: readonly string[], key: string, index: number): string[] {
    if (order.includes(key)) return [...order]
    const at = Math.max(0, Math.min(index, order.length))
    return [...order.slice(0, at), key, ...order.slice(at)]
}

// ── What one row says and offers ────────────────────────────────────────────

/**
 * One step of the progress line:
 * - `done`: filled, with a check
 * - `yours`: the sharing side's move now - a thick ring in the text colour, the label in bold
 * - `waiting`: someone else's move now - a ring with a clock
 * - `problem`: something stops it - the warn triangle, the only colour on the line
 * - `later`: not yet - a thin outline
 */
export type TrackMark = 'done' | 'yours' | 'waiting' | 'problem' | 'later'

export interface TrackStep {
    label: string
    mark: TrackMark
}

export type ActionKind = 'resume' | 'propose-entry' | 'withdraw' | 'discard' | 'new-version' | 'gitlab' | 'retry'

export interface RowAction {
    kind: ActionKind
    /**
     * - `button`: the row's move, a secondary button (several rows can offer one; the page's one primary is „Neues Paket teilen“)
     * - `link`: a stage that waits for others: where to look, at GitLab
     * - `quiet`: a way out or a way on beside the move, a ghost action
     */
    look: 'button' | 'link' | 'quiet'
    /** Where a link, or a button that is a link, leads. */
    href?: string
}

export const ACTION_LABELS: Record<ActionKind, string> = {
    resume: 'Weitermachen',
    'propose-entry': 'Katalog-Eintrag vorschlagen',
    withdraw: 'Zurückziehen',
    discard: 'Verwerfen',
    'new-version': 'Neue Version teilen',
    gitlab: 'In GitLab ansehen',
    retry: 'Erneut versuchen',
}

export interface RowStatus {
    /** The one sentence that carries the meaning; the progress line only shows it. */
    text: string
    /**
     * - `plain`: under the progress line
     * - `neutral`: a fact, on a row without a line (the dataset is gone)
     * - `error`: the state could not be read
     * - `removal`: on its way out - no line, which would suggest progress
     */
    tone: 'plain' | 'neutral' | 'error' | 'removal'
    /** A link that belongs to the sentence: „Änderung ansehen“, „Vorschlag ansehen“. */
    link?: { label: string; href: string }
}

export interface RowView {
    title: string
    version?: string
    /** „aus Datensatz „X“ · eingereicht am 12.10. von Ewa“, as far as it is known. */
    origin?: string
    /** Absent where a line would mislead: a removal, an unreadable state, a dataset that is gone. */
    track?: TrackStep[]
    status: RowStatus
    /** The row's move, or where to look while others have it. */
    main?: RowAction
    /** Quiet actions, shown before the move. */
    quiet: RowAction[]
    /** „Frühere Versionen: 1.0.0, 1.0.1“ */
    earlier?: string
}

const MARK_OF: Record<StageState, TrackMark> = { done: 'done', current: 'yours', waiting: 'waiting', blocked: 'problem', later: 'later' }

function trackOf(states: Record<StageKey, StageState>, override: Partial<Record<StageKey, TrackMark>> = {}): TrackStep[] {
    return STAGES.map((stage) => ({ label: stage.short, mark: override[stage.key] ?? MARK_OF[states[stage.key]] }))
}

/** „Katalog-Eintrag (3 von 4)“ */
function stepName(key: StageKey): string {
    const index = STAGES.findIndex((stage) => stage.key === key)
    return `${STAGES[index].short} (${index + 1} von ${STAGES.length})`
}

/** Who has the next move, as the status sentence ends: „du bist dran“, „Ewa ist dran“, „wartet auf das Katalog-Team“. */
export function whoseMove(item: InProgressItem): string | undefined {
    switch (turnOf(item)) {
        case 'yours':
            return 'du bist dran'
        case 'colleague':
            return item.kind === 'shared' && item.row.proposedBy ? `${item.row.proposedBy} ist dran` : undefined
        case 'team':
            return 'wartet auf das Katalog-Team'
        default:
            return undefined
    }
}

const DAY = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin' })

/** „aus Datensatz „X“ · eingereicht am 12.10. von Ewa“, from what the row and this instance tell; undefined when nothing. */
function originOf(row: SharedPackageRow, datasets: DatasetsHere): string | undefined {
    const name = row.source?.id ? datasets.get?.(row.source.id) : undefined
    // The row's own package proposal: the open one, else the accepted one.
    const created = timeOf(row.proposals?.find((proposal) => proposal.kind === 'bundle' && proposal.url === row.bundleMr.url)?.createdAt)
    const submitted = [created !== undefined ? `am ${DAY.format(created)}` : undefined, row.proposedBy ? `von ${row.proposedBy}` : undefined].filter(Boolean)
    const parts = [name ? `aus Datensatz „${name}“` : undefined, submitted.length ? `eingereicht ${submitted.join(' ')}` : undefined].filter(Boolean)
    return parts.length ? parts.join(' · ') : undefined
}

/** The wizard with the dataset chosen, where it is still here; else the wizard, to choose (prefill is rc.7). */
function newVersionHref(row: SharedPackageRow, datasets: DatasetsHere): string {
    const id = row.source?.id
    return id && datasets.has(id) ? wizardHref({ datasetId: id, step: 1 }) : WIZARD_PATH
}

const withRef = (sentence: string, url: string | undefined) => {
    const ref = mergeRequestRef(url)
    return ref ? `${sentence} · Vorschlag ${ref}` : sentence
}

/** „Paket-Prüfung (2 von 4) - wartet auf das Katalog-Team“: a stage, then who has it. */
const dash = (stage: string, who: string | undefined) => (who ? `${stage} - ${who}` : stage)

/** „Paket angenommen, danach bei GitLab geändert - bitte ansehen · du bist dran“: a sentence that has its dash already. */
const dot = (sentence: string, who: string | undefined) => (who ? `${sentence} · ${who}` : sentence)

/**
 * What one row of „In Arbeit“ says and offers, by its stage (plan, section 4,
 * „Stage → action“): the person's own moves get a button, a stage that waits
 * for others a link to GitLab, where the reviewers ask their questions.
 */
export function rowView(item: InProgressItem, datasets: DatasetsHere): RowView {
    if (item.kind === 'draft') {
        const { draft } = item
        const title = draft.basics.displayName?.trim() || draft.datasetName
        const version = draft.basics.version?.trim() || undefined
        const discard: RowAction = { kind: 'discard', look: 'quiet' }
        if (!item.available) {
            return { title, version, status: { text: `Der Datensatz „${draft.datasetName}“ ist auf dieser Instanz nicht mehr da.`, tone: 'neutral' }, quiet: [discard] }
        }
        return {
            title,
            version,
            origin: `aus Datensatz „${draft.datasetName}“`,
            track: trackOf({ propose: 'current', review: 'later', catalog: 'later', listing: 'later' }),
            // The day it was started, as „Auswählen“ names it too: the last save would give two dates for one share.
            status: { text: `Angefangen am ${draftStartedOn(draft)} - noch nicht eingereicht · du bist dran`, tone: 'plain' },
            main: { kind: 'resume', look: 'button', href: resumeHref(draft) },
            quiet: [discard],
        }
    }

    const { row, progress } = item
    const who = whoseMove(item)
    const base = {
        title: row.displayName,
        version: row.version,
        origin: originOf(row, datasets),
        ...(item.earlier.length ? { earlier: `Frühere Versionen: ${item.earlier.join(', ')}` } : {}),
    }
    const track = trackOf(progress.states)
    const gitlab = (href: string | undefined): RowAction => ({ kind: 'gitlab', look: 'link', href: href ?? row.bundleMr.url })
    const withdraw: RowAction = { kind: 'withdraw', look: 'quiet' }
    const newVersion: RowAction = { kind: 'new-version', look: 'quiet', href: newVersionHref(row, datasets) }
    const plain = (text: string, link?: RowStatus['link']): RowStatus => ({ text, tone: 'plain', ...(link ? { link } : {}) })

    switch (item.outcome) {
        case 'unreadable':
            // No „Zurückziehen“: what it would mean depends on the stage, and the stage is what could not be read.
            return {
                ...base,
                status: { text: row.problem ? `Der Stand ließ sich nicht lesen: ${row.problem}` : 'Der Stand ließ sich nicht lesen.', tone: 'error' },
                main: { kind: 'retry', look: 'button' },
                quiet: [],
            }
        case 'in-review':
            return { ...base, track, status: plain(withRef(dash(stepName('review'), who), row.bundleMr.url)), main: gitlab(row.bundleMr.url), quiet: [withdraw] }
        case 'change-in-review':
            // „Zurückziehen“ withdraws only the change: the dialog says so, from a fresh look at GitLab.
            return { ...base, track, status: plain(withRef(dash('Änderung am angenommenen Paket', who), row.bundleMr.url)), main: gitlab(row.bundleMr.url), quiet: [withdraw] }
        case 'removal-pending':
            return {
                ...base,
                status: { text: dash('Entfernen vorgeschlagen', who), tone: 'removal' },
                main: gitlab(row.bundle?.removal?.mrUrl),
                quiet: [],
            }
        case 'accepted':
            // „Zurückziehen“ proposes taking the accepted package out again; the dialog says so.
            return { ...base, track, status: plain(dash(stepName('catalog'), who)), main: { kind: 'propose-entry', look: 'button' }, quiet: [newVersion, withdraw] }
        case 'needs-look': {
            const verification = row.bundle?.verification
            const changed = verification?.state === 'changed-after-merge'
            const text = changed
                ? 'Paket angenommen, danach bei GitLab geändert - bitte ansehen'
                : `Paket angenommen, lässt sich aber nicht bestätigen (${verification ? verificationLabel(verification) : 'nicht prüfbar'}) - bitte ansehen`
            const where = row.folderUrl ?? verification?.mergedMrUrl ?? row.bundleMr.url
            return {
                ...base,
                track,
                status: plain(dot(text, who), { label: changed && row.folderUrl ? 'Änderung ansehen' : 'In GitLab ansehen', href: where }),
                main: { ...newVersion, look: 'button' },
                quiet: [withdraw],
            }
        }
        case 'broken':
            // Only the operator, or someone at GitLab, can help: said once, asked of nobody here.
            return { ...base, track, status: plain(`Paket angenommen. ${progress.blockedBy ?? 'Der Ablageort lässt sich gerade nicht lesen.'}`), main: gitlab(row.bundleMr.url), quiet: [withdraw] }
        case 'no-catalogue':
            // Neutral, not a problem: the page says once that the catalogue is not set up, and who sets it up.
            return {
                ...base,
                track: trackOf(progress.states, { catalog: 'waiting' }),
                status: plain(`${stepName('catalog')} - wartet auf den Betrieb`),
                quiet: [newVersion, withdraw],
            }
        case 'entry-in-review':
            // „Zurückziehen“ withdraws only the entry; the package stays accepted unless the person chooses otherwise.
            return { ...base, track, status: plain(withRef(dash(stepName('listing'), who), row.catalog?.mrUrl)), main: gitlab(row.catalog?.mrUrl), quiet: [withdraw] }
        case 'brings-back':
            // Withdrawing it is the move: it would bring back what the catalogue team took out.
            return {
                ...base,
                track,
                status: plain(
                    dot(`${stepName('listing')} - bringt einen herausgenommenen Eintrag zurück`, who),
                    row.catalog?.mrUrl ? { label: 'Vorschlag ansehen', href: row.catalog.mrUrl } : undefined,
                ),
                main: { kind: 'withdraw', look: 'button' },
                quiet: [],
            }
        default:
            // Not a stage „In Arbeit“ lists (the tab rules keep it out); said as the stages say it, with where to look.
            return { ...base, track, status: plain(dot(progress.summary, who)), main: gitlab(row.bundleMr.url), quiet: [] }
    }
}
