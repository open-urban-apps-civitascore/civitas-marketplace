import { declinedBy, declinedOn, reasonLine, reasonWords, type Decline } from '@/lib/export/declines'
import { verificationLabel } from '@/lib/export/labels'
import { draftStartedOn, type ShareDraft } from '@/lib/export/share-drafts'
import type { SharedPackageRow } from '@/lib/export/share-listing'
import { isNewerVersion, sentence, STAGES, type ShareProgress, type StageKey, type StageState } from '@/lib/export/share-stages'
import { mergeRequestRef, reviewChangeUrl } from '@/lib/export/share-state'
import type { ShareOutcome, TabRow, TurnedDown } from '@/lib/export/share-tabs'
import { newVersionHref, resumeHref } from '@/lib/export/wizard-address'

export type InProgressItem =
    | { kind: 'draft'; key: string; draft: ShareDraft; available: boolean }
    | {
          kind: 'shared'
          key: string
          row: SharedPackageRow
          progress: ShareProgress
          outcome: ShareOutcome
          /** The person's own move (`isYourMove` in share-tabs.ts). */
          mine: boolean
          /** Versions this one replaced, lowest first. */
          earlier: string[]
          declinedEarlier: TabRow['declinedEarlier']
          declined?: TabRow['declined']
          declinedChange?: TabRow['declinedChange']
      }

export { rowProgress } from '@/lib/export/share-tabs'

export interface DatasetsHere {
    has(datasetId: string): boolean
    get?(datasetId: string): string | undefined
}

/** `nobody`: an unreadable state, only the operator can help, or a "no" past its time. */
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

export function isMine(item: InProgressItem): boolean {
    return turnOf(item) === 'yours'
}

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

function newerFirst(a: number | undefined, b: number | undefined): number {
    if (a === b) return 0
    if (a === undefined) return 1
    if (b === undefined) return -1
    return b - a
}

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

/** No re-sorting while focus is in the list: the order seen, gone rows dropped, new rows last. */
export function keptOrder(seen: readonly string[], next: readonly string[]): string[] {
    const present = new Set(next)
    const kept = seen.filter((key) => present.has(key))
    const known = new Set(kept)
    return [...kept, ...next.filter((key) => !known.has(key))]
}

/** Puts a result back where the row it is about stood. */
export function withSlot(order: readonly string[], key: string, index: number): string[] {
    if (order.includes(key)) return [...order]
    const at = Math.max(0, Math.min(index, order.length))
    return [...order.slice(0, at), key, ...order.slice(at)]
}

export type InProgressGroup = 'yours' | 'others' | 'unreadable'

export const GROUP_ORDER: readonly InProgressGroup[] = ['yours', 'others', 'unreadable']

export const GROUP_TITLES: Record<InProgressGroup, string> = {
    yours: 'Du bist dran',
    others: 'Wartet auf andere',
    unreadable: 'Stand nicht lesbar',
}

/** No lead for „Stand nicht lesbar“: its rows say themselves what failed. */
export const GROUP_LEADS: Partial<Record<InProgressGroup, string>> = {
    yours: 'Hier liegt der nächste Schritt bei dir - in jeder Zeile steht, welcher.',
    // Names the operator too, so the lead is true of every row in the group.
    others: 'Hier ist gerade jemand anderes dran - meist das Katalog-Team, manchmal jemand aus deiner Instanz oder der Betrieb. In jeder Zeile steht, woran es hängt.',
}

export function groupOf(item: InProgressItem): InProgressGroup {
    if (item.kind === 'shared' && item.outcome === 'unreadable') return 'unreadable'
    return turnOf(item) === 'yours' ? 'yours' : 'others'
}

export interface Placed {
    key: string
    group: InProgressGroup
}

export function placesOf(items: readonly InProgressItem[]): Placed[] {
    return items.map((item) => ({ key: item.key, group: groupOf(item) }))
}

/** As `keptOrder`, and each row also stays in the group it was seen in. */
export function keptPlaces(seen: readonly Placed[], next: readonly Placed[]): Placed[] {
    const groups = new Map([...next, ...seen].map((place) => [place.key, place.group]))
    const keys = keptOrder(
        seen.map((place) => place.key),
        next.map((place) => place.key),
    )
    const placed = keys.map((key) => ({ key, group: groups.get(key) as InProgressGroup }))
    return GROUP_ORDER.flatMap((group) => placed.filter((place) => place.group === group))
}

/** As `withSlot`, within the slot's group. */
export function withPlace(placed: readonly Placed[], slot: Placed, index: number): Placed[] {
    if (placed.some((place) => place.key === slot.key)) return [...placed]
    const keys = withSlot(
        placed.filter((place) => place.group === slot.group).map((place) => place.key),
        slot.key,
        index,
    )
    return GROUP_ORDER.flatMap((group) => (group === slot.group ? keys.map((key) => ({ key, group })) : placed.filter((place) => place.group === group)))
}

/** `partial`: GitLab is pending or unreadable, so counts would be too low. */
export type GroupsKnown = 'all' | 'own' | 'partial'

/** Empty groups only when all is known: „Du bist dran · 0“ would otherwise claim too much. */
export function shownGroups(placed: readonly Placed[], known: GroupsKnown): { group: InProgressGroup; keys: string[]; counted: boolean }[] {
    return GROUP_ORDER.map((group) => ({ group, keys: placed.filter((place) => place.group === group).map((place) => place.key), counted: known !== 'partial' })).filter(
        ({ group, keys }) => keys.length > 0 || (known === 'all' && group !== 'unreadable'),
    )
}

/** `yours`: the sharing side's move; `problem` also marks a "no". */
export type TrackMark = 'done' | 'yours' | 'waiting' | 'problem' | 'later'

export interface TrackStep {
    label: string
    mark: TrackMark
}

export type ActionKind = 'resume' | 'propose-entry' | 'withdraw' | 'discard' | 'new-version' | 'gitlab' | 'retry'

export interface RowAction {
    kind: ActionKind
    /** `button`: the row's move; `link`: GitLab while others have it; `quiet`: a ghost action. */
    look: 'button' | 'link' | 'quiet'
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
    text: string
    tone: 'plain' | 'neutral' | 'error' | 'removal'
    link?: { label: string; href: string }
}

export interface ReasonLine {
    text: string
    /** Screen-reader suffix, so two „Vorschlag ansehen“ in one card differ. */
    link?: { label: string; href: string; heard?: string }
}

export interface RowView {
    title: string
    version?: string
    origin?: string
    track?: TrackStep[]
    status: RowStatus
    reasons?: ReasonLine[]
    main?: RowAction
    quiet: RowAction[]
    earlier?: string
}

const MARK_OF: Record<StageState, TrackMark> = { done: 'done', current: 'yours', waiting: 'waiting', blocked: 'problem', declined: 'problem', later: 'later' }

function trackOf(states: Record<StageKey, StageState>, override: Partial<Record<StageKey, TrackMark>> = {}): TrackStep[] {
    return STAGES.map((stage) => ({ label: stage.short, mark: override[stage.key] ?? MARK_OF[states[stage.key]] }))
}

function stepName(key: StageKey): string {
    const index = STAGES.findIndex((stage) => stage.key === key)
    return `${STAGES[index].short} (${index + 1} von ${STAGES.length})`
}

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

function originOf(row: SharedPackageRow, datasets: DatasetsHere): string | undefined {
    const name = row.source?.id ? datasets.get?.(row.source.id) : undefined
    const created = timeOf(row.proposals?.find((proposal) => proposal.kind === 'bundle' && proposal.url === row.bundleMr.url)?.createdAt)
    const submitted = [created !== undefined ? `am ${DAY.format(created)}` : undefined, row.proposedBy ? `von ${row.proposedBy}` : undefined].filter(Boolean)
    const parts = [name ? `aus Datensatz „${name}“` : undefined, submitted.length ? `eingereicht ${submitted.join(' ')}` : undefined].filter(Boolean)
    return parts.length ? parts.join(' · ') : undefined
}

function newVersionOf(row: SharedPackageRow, datasets: DatasetsHere): string {
    const id = row.source?.id
    return newVersionHref({ ...(id && datasets.has(id) ? { datasetId: id } : {}), slug: row.slug, version: row.version })
}

/** Stable and URL-safe; the wizard links to it. */
export function rowAnchor(row: Pick<SharedPackageRow, 'targetKey' | 'slug' | 'version'>): string {
    // Same package name in two places: a hash of the place keeps the ids apart.
    let hash = 0x811c9dc5
    for (const char of row.targetKey) {
        hash ^= char.codePointAt(0) ?? 0
        hash = Math.imul(hash, 0x01000193) >>> 0
    }
    return `in-arbeit-${row.slug}-${row.version}-${hash.toString(36)}`
}

export const IN_PROGRESS_PATH = '/export'

export function inProgressHref(row: Pick<SharedPackageRow, 'targetKey' | 'slug' | 'version'>): string {
    return `${IN_PROGRESS_PATH}#${rowAnchor(row)}`
}

/** At a "no" it says what was not accepted: read as progress, it would mislead. */
export function inProgressLinkText(version: string, declined?: TurnedDown): string {
    if (declined === 'entry') return `Katalog-Eintrag für ${version} nicht angenommen`
    return declined === 'package' ? `Version ${version} nicht angenommen` : `Version ${version} ist in Arbeit`
}

const withRef = (sentence: string, url: string | undefined) => {
    const ref = mergeRequestRef(url)
    return ref ? `${sentence} · Vorschlag ${ref}` : sentence
}

const dash = (stage: string, who: string | undefined) => (who ? `${stage} - ${who}` : stage)

const dot = (sentence: string, who: string | undefined) => (who ? `${sentence} · ${who}` : sentence)

const proposalLink = (decline: Decline): NonNullable<ReasonLine['link']> => ({ label: 'Vorschlag ansehen', href: decline.mrUrl, heard: ` (!${decline.iid})` })

const reasonOf = (decline: Decline): ReasonLine => ({ text: reasonLine(decline), link: proposalLink(decline) })

export const changeNoteOf = (version: string, change: Decline): ReasonLine => ({
    text: `Die Änderung an Version ${version} (Vorschlag !${change.iid}) ${declinedBy(change)}. ${reasonWords(change)}`,
    link: proposalLink(change),
})

const afterNo = (decline: Decline | undefined, then: string) => (decline?.reason.kind === 'none' ? then : `Grund lesen und ${then}`)

const EARLIER_NO: Record<TurnedDown, string> = { package: 'nicht angenommen', entry: 'Katalog-Eintrag nicht angenommen' }

function earlierLine(replaced: readonly string[], declined: TabRow['declinedEarlier']): string | undefined {
    const versions = [...replaced.map((version) => ({ version, no: undefined })), ...declined.map(({ version, kind }) => ({ version, no: kind }))].sort((a, b) =>
        isNewerVersion(a.version, b.version) ? 1 : isNewerVersion(b.version, a.version) ? -1 : 0,
    )
    return versions.length ? `Frühere Versionen: ${versions.map(({ version, no }) => (no ? `${version} ${EARLIER_NO[no]}` : version)).join(' · ')}` : undefined
}

/** The server refuses an entry already turned down for this version; `stageNotice` must agree. */
export function mayProposeEntry(row: SharedPackageRow): boolean {
    const verification = row.bundle?.verification
    return row.catalog?.state !== 'unconfigured' && row.catalog?.state !== 'declined' && (!verification || verification.state === 'verified')
}

/** The server refuses a removal the team already turned down. */
function mayWithdraw(row: SharedPackageRow): boolean {
    return !row.bundle?.removal?.declined
}

export function rowView(item: InProgressItem, datasets: DatasetsHere): RowView {
    if (item.kind === 'draft') {
        const { draft } = item
        const title = draft.basics.displayName?.trim() || draft.datasetName
        const version = draft.basics.version?.trim() || undefined
        const discard: RowAction = { kind: 'discard', look: 'quiet' }
        if (!item.available) {
            return {
                title,
                version,
                status: { text: `Der Datensatz „${draft.datasetName}“ ist auf dieser Instanz nicht mehr da · ${whoseMove(item, 'Zwischenstand verwerfen')}`, tone: 'neutral' },
                quiet: [discard],
            }
        }
        return {
            title,
            version,
            origin: `aus Datensatz „${draft.datasetName}“`,
            track: trackOf({ propose: 'current', review: 'later', catalog: 'later', listing: 'later' }),
            // The start date, as „Auswählen“ shows it: the last save would give one share two dates.
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
            // No „Zurückziehen“: its meaning depends on the stage, which could not be read.
            return {
                ...base,
                status: { text: row.problem ? `Der Stand ließ sich nicht lesen: ${row.problem}` : 'Der Stand ließ sich nicht lesen.', tone: 'error' },
                main: { kind: 'retry', look: 'button' },
                quiet: [],
            }
        case 'in-review':
            return { ...base, track, status: plain(withRef(dash(stepName('review'), who), row.bundleMr.url)), main: gitlab(row.bundleMr.url), quiet: [withdraw] }
        case 'change-in-review':
            return { ...base, track, status: plain(withRef(dash('Änderung am angenommenen Paket', who), row.bundleMr.url)), main: gitlab(row.bundleMr.url), quiet: [withdraw] }
        case 'removal-pending':
            return {
                ...base,
                status: { text: dash('Entfernen vorgeschlagen', who), tone: 'removal' },
                main: gitlab(row.bundle?.removal?.mrUrl),
                quiet: [],
            }
        case 'accepted': {
            // The team's review commits are on the proposal they merged.
            const verification = row.bundle?.verification
            const changed = verification?.changedInReview
            const merged = verification?.mergedMrUrl ?? row.bundleMr.url
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
            // No whose-move: only the operator or someone at GitLab can help.
            return { ...base, track, status: plain(`Paket angenommen. ${progress.blockedBy ?? 'Der Ablageort lässt sich gerade nicht lesen.'}`), main: gitlab(row.bundleMr.url), quiet: [withdraw] }
        case 'no-catalogue':
            // Waiting, not a problem: the page says once who sets up the catalogue.
            return {
                ...base,
                track: trackOf(progress.states, { catalog: 'waiting' }),
                status: plain(`${stepName('catalog')} - wartet auf den Betrieb`),
                quiet: [newVersion, withdraw],
            }
        case 'entry-in-review':
            return { ...base, track, status: plain(withRef(dash(stepName('listing'), who), row.catalog?.mrUrl)), main: gitlab(row.catalog?.mrUrl), quiet: [withdraw] }
        case 'brings-back':
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
            // A turned-down version is used up: the way on is a new one.
            return {
                ...base,
                ...told,
                track,
                status: plain(dot(`${stepName('review')} - nicht angenommen${on}`, whoseMove(item, afterNo(decline, 'eine neue Version teilen')))),
                main: { ...newVersion, look: 'button' },
                quiet: [],
            }
        case 'entry-declined':
            // The package stays accepted; the entry is not proposed again for this version.
            return {
                ...base,
                ...told,
                track,
                status: plain(dot(`${stepName('listing')} - nicht angenommen${on}`, whoseMove(item, afterNo(decline, 'bei Bedarf eine neue Version teilen')))),
                main: { ...newVersion, look: 'button' },
                quiet: mayWithdraw(row) ? [withdraw] : [],
            }
        case 'removal-declined': {
            // No progress line while the "no" is news; later the team's words show only in „Beendet“.
            const entry = mayProposeEntry(row)
            const proposeEntry: RowAction[] = entry ? [{ kind: 'propose-entry', look: 'quiet' }] : []
            if (item.declined?.current) {
                const move = decline?.reason.kind === 'none' ? (entry ? 'Katalog-Eintrag vorschlagen oder eine neue Version teilen' : 'eine neue Version teilen') : 'Grund lesen'
                return {
                    ...base,
                    ...told,
                    status: { text: dot(`Entfernen${on} nicht angenommen - das Paket bleibt angenommen, im Katalog steht es nicht`, whoseMove(item, move)), tone: 'neutral' },
                    quiet: [...proposeEntry, newVersion],
                }
            }
            // Nobody's move now: the status names what it still offers, as „Auswählen“ does.
            const offers = entry ? 'den Katalog-Eintrag kannst du weiterhin vorschlagen oder eine neue Version teilen' : 'eine neue Version kannst du jederzeit teilen'
            return {
                ...base,
                track: trackOf(progress.states, { catalog: 'later' }),
                status: plain(dot(decline ? `Paket angenommen, nicht im Katalog - das Entfernen ${declinedBy(decline)}` : progress.summary, offers)),
                quiet: [...proposeEntry, newVersion],
            }
        }
        case 'entry-revoked': {
            const takenOut = row.catalog?.takenOut
            const reason = takenOut?.reason ? ` Grund: ${sentence(takenOut.reason)}` : ''
            return {
                ...base,
                ...(takenOut ? { reasons: [{ text: `Zuletzt stand Version ${takenOut.version} im Katalog.${reason}` }, ...change] } : {}),
                track,
                // Worded as `takenOutBlocker` in the wizard.
                status: plain(`${stepName('catalog')} - der ganze Eintrag ist aus dem Katalog genommen · weiter geht es erst, wenn das Katalog-Team ihn wieder freigibt`),
                main: gitlab(row.bundleMr.url),
                quiet: mayWithdraw(row) ? [withdraw] : [],
            }
        }
        default:
            // Not listed in „In Arbeit“ (`TAB_OF`): a fallback.
            return { ...base, track, status: plain(dot(progress.summary, who)), main: gitlab(row.bundleMr.url), quiet: [] }
    }
}
