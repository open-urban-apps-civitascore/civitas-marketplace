import { declinedBy, declinedOn, reasonLine, reasonWords, type Decline } from '@/lib/export/declines'
import { verificationLabel } from '@/lib/export/labels'
import { draftStartedOn, type ShareDraft } from '@/lib/export/share-drafts'
import type { SharedPackageRow } from '@/lib/export/share-listing'
import { isNewerVersion, STAGES, takenOutFact, type ShareProgress, type StageKey, type StageState } from '@/lib/export/share-stages'
import { mergeRequestRef, reviewChangeUrl } from '@/lib/export/share-state'
import type { ShareOutcome, TabRow } from '@/lib/export/share-tabs'
import { newVersionHref, resumeHref } from '@/lib/export/wizard-address'

/**
 * What „In Arbeit“ lists and what each row says and offers, apart from how it
 * shows it (plan of 2026-10-18, section 4). Pure, for the component and its
 * tests: the stage → action table is data here, so a test can read it row by
 * row.
 *
 * Whose move a row waits for decides its group and its words: „du bist dran“
 * only on what the person looking proposed (or what names nobody), „Ewa ist
 * dran“ on a colleague's, „wartet auf das Katalog-Team“ while the reviewers
 * have it - and a move names what to do, in the words of its button: „du bist
 * dran: Katalog-Eintrag vorschlagen“. The group „Du bist dran“ holds the
 * same rows the tab rules count as the person's own (`TabRow.mine`).
 *
 * A "no" of the catalogue team is told at the step it stopped, with the date
 * and the team's words (`reasonLine`). A close through the marketplace's
 * account is told as one, never as the team's decision.
 */

export type InProgressItem =
    | { kind: 'draft'; key: string; draft: ShareDraft; available: boolean }
    | {
          kind: 'shared'
          key: string
          row: SharedPackageRow
          progress: ShareProgress
          outcome: ShareOutcome
          /** The person's own move (`isYourMove` in share-tabs.ts): what the group „Du bist dran“ counts. */
          mine: boolean
          /** Versions this one replaced, lowest first. */
          earlier: string[]
          /** Lower versions the catalogue team turned down, lowest first. */
          declinedEarlier: string[]
          /** The "no" the row stands at, and whether it is still the sharing side's move. */
          declined?: TabRow['declined']
          /** A change to this accepted version that the catalogue team did not take. */
          declinedChange?: TabRow['declinedChange']
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
 * - `nobody`: nobody on the page can move it on - the state could not be read, only the operator can help, or a "no" is past its time
 */
export type Turn = 'yours' | 'colleague' | 'team' | 'nobody'

const TURN_ORDER: Record<Turn, number> = { yours: 0, colleague: 1, team: 2, nobody: 3 }

export function turnOf(item: InProgressItem): Turn {
    if (item.kind === 'draft') return 'yours'
    const { row, progress } = item
    if (item.mine) return 'yours'
    if (row.problem) return 'nobody'
    // A "no" to a removal past its 30 days: still told on the row, asked of nobody.
    if (item.declined && !item.declined.current) return 'nobody'
    if (progress.removal === 'pending' || progress.turn === 'reviewers') return 'team'
    return progress.turn === 'you' ? 'colleague' : 'nobody'
}

/** The person's own move: what the group „Du bist dran“ holds. */
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
 * (`shareTabs(…).inProgress`), in the order of their groups (`groupOf`):
 * the person's own moves; then a colleague's, what waits on the catalogue
 * team, and what nobody here can move on; then what could not be read.
 * Within each the newest change first; the listing's order among equals.
 * `available`: which datasets are still here.
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
                declinedEarlier: tabbed.declinedEarlier,
                ...(tabbed.declined ? { declined: tabbed.declined } : {}),
                ...(tabbed.declinedChange ? { declinedChange: tabbed.declinedChange } : {}),
            }),
        ),
    ]
    return items
        .map((item, index) => ({ item, index, group: GROUP_ORDER.indexOf(groupOf(item)), turn: TURN_ORDER[turnOf(item)], at: changedAt(item) }))
        .sort((a, b) => a.group - b.group || a.turn - b.turn || newerFirst(a.at, b.at) || a.index - b.index)
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

// ── The groups of „In Arbeit“ ───────────────────────────────────────────────

/** The groups of „In Arbeit“: the person's own moves (started shares included), anyone else's, and rows whose state could not be read. */
export type InProgressGroup = 'yours' | 'others' | 'unreadable'

export const GROUP_ORDER: readonly InProgressGroup[] = ['yours', 'others', 'unreadable']

export const GROUP_TITLES: Record<InProgressGroup, string> = {
    yours: 'Du bist dran',
    others: 'Wartet auf andere',
    unreadable: 'Stand nicht lesbar',
}

/** One sentence under a group's heading; the rows of „Stand nicht lesbar“ say themselves what failed. */
export const GROUP_LEADS: Partial<Record<InProgressGroup, string>> = {
    yours: 'Hier liegt der nächste Schritt bei dir - in jeder Zeile steht, welcher.',
    // Names the operator too, so the lead is true of every row in the group.
    others: 'Hier ist gerade jemand anderes dran - meist das Katalog-Team, manchmal jemand aus deiner Instanz oder der Betrieb. In jeder Zeile steht, woran es hängt.',
}

export function groupOf(item: InProgressItem): InProgressGroup {
    if (item.kind === 'shared' && item.outcome === 'unreadable') return 'unreadable'
    return turnOf(item) === 'yours' ? 'yours' : 'others'
}

/** Where one row shows: its key and its group. */
export interface Placed {
    key: string
    group: InProgressGroup
}

/** Each row with its group, in the order `inProgressItems` gives, which sorts by group first. */
export function placesOf(items: readonly InProgressItem[]): Placed[] {
    return items.map((item) => ({ key: item.key, group: groupOf(item) }))
}

/**
 * Where each row shows while the person is inside the list (`keptOrder`): in
 * the group and place they saw it, even if it belongs elsewhere by now; new
 * rows at the end of their group. Once focus leaves, `next` holds again.
 */
export function keptPlaces(seen: readonly Placed[], next: readonly Placed[]): Placed[] {
    const groups = new Map([...next, ...seen].map((place) => [place.key, place.group]))
    const keys = keptOrder(
        seen.map((place) => place.key),
        next.map((place) => place.key),
    )
    const placed = keys.map((key) => ({ key, group: groups.get(key) as InProgressGroup }))
    return GROUP_ORDER.flatMap((group) => placed.filter((place) => place.group === group))
}

/** `placed` with `slot` back in its group at `index`, when it is not in it: a result where its row stood. */
export function withPlace(placed: readonly Placed[], slot: Placed, index: number): Placed[] {
    if (placed.some((place) => place.key === slot.key)) return [...placed]
    const keys = withSlot(
        placed.filter((place) => place.group === slot.group).map((place) => place.key),
        slot.key,
        index,
    )
    return GROUP_ORDER.flatMap((group) => (group === slot.group ? keys.map((key) => ({ key, group })) : placed.filter((place) => place.group === group)))
}

/**
 * How much of „In Arbeit“ the page knows, for what its groups may count:
 * - `all`: GitLab answered, and the person may see what was submitted
 * - `own`: the person may not see what was submitted, so the started shares are all there is
 * - `partial`: GitLab is still asked or could not be read - counting only the started shares would be too low
 */
export type GroupsKnown = 'all' | 'own' | 'partial'

/**
 * The groups to show, with their rows' keys and whether the heading counts
 * them (not while GitLab is asked or unreadable). Empty groups show only when
 * all is known: „Du bist dran · 0“ would otherwise claim what nobody on the
 * page knows. „Stand nicht lesbar“ only shows with rows.
 */
export function shownGroups(placed: readonly Placed[], known: GroupsKnown): { group: InProgressGroup; keys: string[]; counted: boolean }[] {
    return GROUP_ORDER.map((group) => ({ group, keys: placed.filter((place) => place.group === group).map((place) => place.key), counted: known !== 'partial' })).filter(
        ({ group, keys }) => keys.length > 0 || (known === 'all' && group !== 'unreadable'),
    )
}

// ── What one row says and offers ────────────────────────────────────────────

/**
 * One step of the progress line:
 * - `done`: filled, with a check
 * - `yours`: the sharing side's move now - a thick ring in the text colour, the label in bold
 * - `waiting`: someone else's move now - a ring with a clock
 * - `problem`: something stops it, or the catalogue team turned it down - the warn triangle, the only colour on the line
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
     * - `neutral`: a fact, on a row without a line (the dataset is gone, a removal turned down)
     * - `error`: the state could not be read
     * - `removal`: on its way out - no line, which would suggest progress
     */
    tone: 'plain' | 'neutral' | 'error' | 'removal'
    /** A link that belongs to the sentence: „Änderung ansehen“, „Vorschlag ansehen“. */
    link?: { label: string; href: string }
}

/** The catalogue team's words to a "no", under the status sentence, with the proposal where the rest is. */
export interface ReasonLine {
    text: string
    /** `heard`: read out after the label only, so two „Vorschlag ansehen“ links in one card are told apart. */
    link?: { label: string; href: string; heard?: string }
}

export interface RowView {
    title: string
    version?: string
    /** „aus Datensatz „X“ · eingereicht am 12.10. von Ewa“, as far as it is known. */
    origin?: string
    /** Absent where a line would mislead: a removal, an unreadable state, a dataset that is gone. */
    track?: TrackStep[]
    status: RowStatus
    /** The "no" the row stands at, and one to a change of its accepted version: at most both. */
    reasons?: ReasonLine[]
    /** The row's move, or where to look while others have it. */
    main?: RowAction
    /** Quiet actions, shown before the move. */
    quiet: RowAction[]
    /** „Frühere Versionen: 1.0.0 · 1.0.1 nicht angenommen“ */
    earlier?: string
}

const MARK_OF: Record<StageState, TrackMark> = { done: 'done', current: 'yours', waiting: 'waiting', blocked: 'problem', declined: 'problem', later: 'later' }

function trackOf(states: Record<StageKey, StageState>, override: Partial<Record<StageKey, TrackMark>> = {}): TrackStep[] {
    return STAGES.map((stage) => ({ label: stage.short, mark: override[stage.key] ?? MARK_OF[states[stage.key]] }))
}

/** „Katalog-Eintrag (3 von 4)“ */
function stepName(key: StageKey): string {
    const index = STAGES.findIndex((stage) => stage.key === key)
    return `${STAGES[index].short} (${index + 1} von ${STAGES.length})`
}

/**
 * Who has the next move, as the status sentence ends: „du bist dran“, „Ewa ist
 * dran“, „wartet auf das Katalog-Team“. `move` says what to do when it is the
 * sharing side's: „du bist dran: Vorschlag zurückziehen“.
 */
export function whoseMove(item: InProgressItem, move?: string): string | undefined {
    const what = move ? `: ${move}` : ''
    switch (turnOf(item)) {
        case 'yours':
            return `du bist dran${what}`
        case 'colleague':
            return item.kind === 'shared' && item.row.proposedBy ? `${item.row.proposedBy} ist dran${what}` : undefined
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

/** „Neue Version teilen“: the wizard with the dataset chosen where it is still here, and the Steckbrief filled from this version. */
function newVersionOf(row: SharedPackageRow, datasets: DatasetsHere): string {
    const id = row.source?.id
    return newVersionHref({ ...(id && datasets.has(id) ? { datasetId: id } : {}), slug: row.slug, version: row.version })
}

/** The id of a shared version's card in „In Arbeit“, stable across readings and valid in an address: the wizard links there. */
export function rowAnchor(row: Pick<SharedPackageRow, 'targetKey' | 'slug' | 'version'>): string {
    // Two places may hold a package of the same name: a short tag of the place keeps their rows apart.
    let hash = 0x811c9dc5
    for (const char of row.targetKey) {
        hash ^= char.codePointAt(0) ?? 0
        hash = Math.imul(hash, 0x01000193) >>> 0
    }
    return `in-arbeit-${row.slug}-${row.version}-${hash.toString(36)}`
}

/** Where „In Arbeit“ is: the first tab of "Teilen", where its menu item leads. */
export const IN_PROGRESS_PATH = '/export'

/** The page „In Arbeit“, at the row of `row`. */
export function inProgressHref(row: Pick<SharedPackageRow, 'targetKey' | 'slug' | 'version'>): string {
    return `${IN_PROGRESS_PATH}#${rowAnchor(row)}`
}

const withRef = (sentence: string, url: string | undefined) => {
    const ref = mergeRequestRef(url)
    return ref ? `${sentence} · Vorschlag ${ref}` : sentence
}

/** „Paket-Prüfung (2 von 4) - wartet auf das Katalog-Team“: a stage, then who has it. */
const dash = (stage: string, who: string | undefined) => (who ? `${stage} - ${who}` : stage)

/** „Paket angenommen, danach aber direkt in GitLab geändert - … · du bist dran: …“: a sentence that has its dash already. */
const dot = (sentence: string, who: string | undefined) => (who ? `${sentence} · ${who}` : sentence)

/** „Vorschlag ansehen“ for a proposal turned down, heard with its number. */
const proposalLink = (decline: Decline): NonNullable<ReasonLine['link']> => ({ label: 'Vorschlag ansehen', href: decline.mrUrl, heard: ` (!${decline.iid})` })

/** A "no" in the team's words, with the proposal they turned down. */
const reasonOf = (decline: Decline): ReasonLine => ({ text: reasonLine(decline), link: proposalLink(decline) })

/** A change the catalogue team did not take: said beside whatever the row says, as the version stays accepted. */
const changeNoteOf = (version: string, change: Decline): ReasonLine => ({
    text: `Die Änderung an Version ${version} (Vorschlag !${change.iid}) ${declinedBy(change)}. ${reasonWords(change)}`,
    link: proposalLink(change),
})

/** The move after a "no": reading why, where they said why - with no reason, „Grund lesen“ would be no move at all. */
const afterNo = (decline: Decline | undefined, then: string) => (decline?.reason.kind === 'none' ? then : `Grund lesen und ${then}`)

/** „Frühere Versionen: 1.1.3 · 1.1.4 nicht angenommen“, lowest first, or nothing. */
function earlierLine(replaced: readonly string[], declined: readonly string[]): string | undefined {
    const versions = [...replaced.map((version) => ({ version, no: false })), ...declined.map((version) => ({ version, no: true }))].sort((a, b) =>
        isNewerVersion(a.version, b.version) ? 1 : isNewerVersion(b.version, a.version) ? -1 : 0,
    )
    return versions.length ? `Frühere Versionen: ${versions.map(({ version, no }) => (no ? `${version} nicht angenommen` : version)).join(' · ')}` : undefined
}

/**
 * Proposing the entry from a row that is not at that step: only where the
 * catalogue is set up, the package is the one reviewed, and the entry was not
 * turned down for this version already, which the server would refuse.
 */
function mayProposeEntry(row: SharedPackageRow): boolean {
    const verification = row.bundle?.verification
    return row.catalog?.state !== 'unconfigured' && row.catalog?.state !== 'declined' && (!verification || verification.state === 'verified')
}

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
            status: { text: `Angefangen am ${draftStartedOn(draft)} - noch nicht eingereicht · ${whoseMove(item, 'weitermachen und zur Prüfung einreichen')}`, tone: 'plain' },
            main: { kind: 'resume', look: 'button', href: resumeHref(draft) },
            quiet: [discard],
        }
    }

    const { row, progress } = item
    const who = whoseMove(item)
    const earlier = earlierLine(item.earlier, item.declinedEarlier)
    const change = item.declinedChange ? [changeNoteOf(row.version, item.declinedChange)] : []
    const base = {
        title: row.displayName,
        version: row.version,
        origin: originOf(row, datasets),
        ...(earlier ? { earlier } : {}),
        ...(change.length ? { reasons: change } : {}),
    }
    const track = trackOf(progress.states)
    const gitlab = (href: string | undefined): RowAction => ({ kind: 'gitlab', look: 'link', href: href ?? row.bundleMr.url })
    const withdraw: RowAction = { kind: 'withdraw', look: 'quiet' }
    const newVersion: RowAction = { kind: 'new-version', look: 'quiet', href: newVersionOf(row, datasets) }
    const plain = (text: string, link?: RowStatus['link']): RowStatus => ({ text, tone: 'plain', ...(link ? { link } : {}) })
    const decline = item.declined?.decline
    const told = decline ? { reasons: [reasonOf(decline), ...change] } : {}
    const on = decline ? declinedOn(decline) : ''

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
        case 'accepted': {
            // The catalogue team changed the package while taking it: worth a look before the entry, or before a new
            // version, which would write over it. Their commits are on the proposal they merged.
            const verification = row.bundle?.verification
            const changed = verification?.changedInReview
            const merged = verification?.mergedMrUrl ?? row.bundleMr.url
            // „Zurückziehen“ proposes taking the accepted package out again; the dialog says so.
            return {
                ...base,
                track,
                status: plain(
                    dot(`${stepName('catalog')} - Paket angenommen${changed ? ', das Katalog-Team hat dabei etwas geändert' : ''}`, whoseMove(item, 'Katalog-Eintrag vorschlagen')),
                    changed ? { label: 'Änderung ansehen', href: reviewChangeUrl(merged) } : undefined,
                ),
                main: { kind: 'propose-entry', look: 'button' },
                quiet: [newVersion, withdraw],
            }
        }
        case 'needs-look': {
            const verification = row.bundle?.verification
            const changed = verification?.state === 'changed-after-merge'
            const text = changed
                ? 'Paket angenommen, danach aber direkt in GitLab geändert - es ist nicht mehr der geprüfte Stand, deshalb lässt sich der Katalog-Eintrag nicht vorschlagen'
                : `Paket angenommen, lässt sich aber nicht bestätigen (${verification ? verificationLabel(verification) : 'nicht prüfbar'})`
            const where = row.folderUrl ?? verification?.mergedMrUrl ?? row.bundleMr.url
            const atChange = changed && Boolean(row.folderUrl)
            // A new version goes through the package check again; then the catalogue entry can follow.
            const move = `${atChange ? 'Änderung ansehen' : 'in GitLab ansehen'} und eine neue Version teilen, die wieder geprüft wird`
            return {
                ...base,
                track,
                status: plain(dot(text, whoseMove(item, move)), { label: atChange ? 'Änderung ansehen' : 'In GitLab ansehen', href: where }),
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
            // Withdrawing it is the move: it would bring back what the catalogue team took out. Said as the dialog says it.
            return {
                ...base,
                track,
                status: plain(
                    dot(
                        `${stepName('listing')} - das Katalog-Team hat diese Version aus dem Katalog genommen, der offene Vorschlag würde sie zurückbringen`,
                        whoseMove(item, 'Vorschlag zurückziehen'),
                    ),
                    row.catalog?.mrUrl ? { label: 'Vorschlag ansehen', href: row.catalog.mrUrl } : undefined,
                ),
                main: { kind: 'withdraw', look: 'button' },
                quiet: [],
            }
        case 'declined':
            // The package turned down: used up for this version, so the way on is a new one. Nothing is open to withdraw.
            return {
                ...base,
                ...told,
                track,
                status: plain(dot(`${stepName('review')} - nicht angenommen${on}`, whoseMove(item, afterNo(decline, 'eine neue Version teilen')))),
                main: { ...newVersion, look: 'button' },
                quiet: [],
            }
        case 'entry-declined':
            // The entry turned down: the package stays accepted, and the entry is not proposed again for this version.
            // „Zurückziehen“ proposes taking the package out.
            return {
                ...base,
                ...told,
                track,
                status: plain(dot(`${stepName('listing')} - nicht angenommen${on}`, whoseMove(item, afterNo(decline, 'bei Bedarf eine neue Version teilen')))),
                main: { ...newVersion, look: 'button' },
                quiet: [withdraw],
            }
        case 'removal-declined': {
            // The removal turned down: the package stays accepted and may still get its entry. No progress line while it is
            // news, as the row is about the removal; afterwards the line as it stands, and the team's words only in „Beendet“.
            const entry = mayProposeEntry(row)
            const proposeEntry: RowAction[] = entry ? [{ kind: 'propose-entry', look: 'quiet' }] : []
            if (item.declined?.current) {
                // With no reason there is nothing to read: the move is what the row offers.
                const move = decline?.reason.kind === 'none' ? (entry ? 'Katalog-Eintrag vorschlagen oder eine neue Version teilen' : 'eine neue Version teilen') : 'Grund lesen'
                return {
                    ...base,
                    ...told,
                    status: { text: dot(`Entfernen${on} nicht angenommen - das Paket bleibt angenommen, im Katalog steht es nicht`, whoseMove(item, move)), tone: 'neutral' },
                    quiet: [...proposeEntry, newVersion],
                }
            }
            // Where the entry cannot follow any more (turned down too, or not set up), the way on is a new version.
            return {
                ...base,
                track: trackOf(progress.states, { catalog: 'later' }),
                status: plain(decline ? `Paket angenommen, nicht im Katalog - das Entfernen ${declinedBy(decline)}` : progress.summary),
                quiet: entry ? proposeEntry : [newVersion],
            }
        }
        case 'entry-revoked': {
            // The whole entry taken out at an earlier version: nobody here can bring this one in. The way out of the list is
            // proposing to take the package out as well.
            const takenOut = row.catalog?.takenOut
            return {
                ...base,
                ...(takenOut ? { reasons: [{ text: takenOutFact(takenOut) }, ...change] } : {}),
                track,
                // Who can move it on, without a contact, as `takenOutBlocker` says it in the wizard.
                status: plain(`${stepName('catalog')} - der ganze Eintrag ist aus dem Katalog genommen · weiter geht es erst, wenn das Katalog-Team ihn wieder freigibt`),
                main: gitlab(row.bundleMr.url),
                quiet: [withdraw],
            }
        }
        default:
            // Not listed in „In Arbeit“ (`TAB_OF`); said as the stages say it, should a row get here.
            return { ...base, track, status: plain(dot(progress.summary, who)), main: gitlab(row.bundleMr.url), quiet: [] }
    }
}
