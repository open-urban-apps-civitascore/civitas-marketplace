'use client'

import { useEffect, useId, useState, type ReactNode } from 'react'
import { Trash2, X } from 'lucide-react'

import { Button, ExternalAnchor } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Notice, Pending, type NoticeTone } from '@/components/ui/notice'
import { deleteShare, planShareDeletion, type SharedPackageRow } from '@/lib/export-actions'
import type { InProgressItem } from '@/lib/export/in-progress-items'
import { fileCount, type DeletionPlan } from '@/lib/export/share-deletion'
import { draftTime, type ShareDraft } from '@/lib/export/share-drafts'

/** What a deletion tells the list it came from. */
export interface DeletionDone {
    detail: string
    mrUrl?: string
    /** Something changed at GitLab, so the list reads it again. */
    remote: boolean
}

/**
 * "Löschen" for one row of "In Arbeit", confirmed in a dialog that says what
 * deleting means at the row's stage - which the server decides, from a fresh
 * look at GitLab (see `share-deletion.ts`), not the list from minutes ago.
 * What happens and what stays are named apart, and the button names the
 * deed ("Zurückziehen", "Entfernen vorschlagen"), not "OK".
 */
export function DeleteShareDialog({
    item,
    title,
    onCancel,
    onDiscardDraft,
    onDone,
}: {
    item: InProgressItem
    /** The name the row shows, with the version for a shared one. */
    title: string
    /** `reload`: a failed deletion had already changed something at GitLab. */
    onCancel: (reload: boolean) => void
    onDiscardDraft: (datasetId: string) => void
    onDone: (done: DeletionDone) => void
}) {
    return item.kind === 'draft' ? (
        <DraftDeletion draft={item.draft} title={title} onCancel={() => onCancel(false)} onDiscard={onDiscardDraft} onDone={onDone} />
    ) : (
        <SharedDeletion row={item.row} title={title} onCancel={onCancel} onDone={onDone} />
    )
}

function Frame({
    title,
    busy,
    onClose,
    cancelLabel = 'Abbrechen',
    confirm,
    children,
}: {
    title: string
    busy: boolean
    onClose: () => void
    cancelLabel?: string
    confirm?: ReactNode
    children: ReactNode
}) {
    const titleId = useId()
    // While GitLab is being changed the dialog stays: closing it would hide how it ended.
    const close = busy ? () => {} : onClose
    return (
        <Modal open onClose={close} labelledBy={titleId} className="max-w-lg">
            <div className="flex items-start justify-between gap-3 border-b p-5">
                <h2 id={titleId} className="text-lg font-semibold text-foreground">
                    „{title}“ löschen?
                </h2>
                <button
                    type="button"
                    onClick={close}
                    disabled={busy}
                    aria-label="Schließen"
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                    <X className="size-5" />
                </button>
            </div>
            <div className="flex flex-col gap-4 overflow-y-auto p-5 text-sm">{children}</div>
            <div className="flex flex-wrap justify-end gap-2 border-t p-4">
                <Button onClick={close} disabled={busy}>
                    {cancelLabel}
                </Button>
                {confirm}
            </div>
        </Modal>
    )
}

/** "Das passiert" and "Das bleibt": two short lists, so the consequence and the reassurance do not blur. */
function Consequences({ happens, stays }: { happens: ReactNode[]; stays: ReactNode[] }) {
    return (
        <>
            {happens.length > 0 && (
                <div className="flex flex-col gap-1.5">
                    <p className="text-xs text-muted-foreground">Das passiert</p>
                    <ul className="flex list-disc flex-col gap-1 pl-5 text-foreground">
                        {happens.map((line, index) => (
                            <li key={index}>{line}</li>
                        ))}
                    </ul>
                </div>
            )}
            <div className="flex flex-col gap-1.5">
                <p className="text-xs text-muted-foreground">Das bleibt</p>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-foreground">
                    {stays.map((line, index) => (
                        <li key={index}>{line}</li>
                    ))}
                </ul>
            </div>
        </>
    )
}

/** Said in every case: "Löschen" next to a use case's name could be read as deleting the use case itself. */
const USE_CASE_STAYS = 'Dein Use Case auf dieser Instanz - er wird nicht angefasst.'

function DraftDeletion({
    draft,
    title,
    onCancel,
    onDiscard,
    onDone,
}: {
    draft: ShareDraft
    title: string
    onCancel: () => void
    onDiscard: (datasetId: string) => void
    onDone: (done: DeletionDone) => void
}) {
    return (
        <Frame
            title={title}
            busy={false}
            onClose={onCancel}
            confirm={
                <Button
                    variant="danger"
                    icon={Trash2}
                    onClick={() => {
                        onDiscard(draft.datasetId)
                        onDone({ detail: `Der Entwurf für „${title}“ ist gelöscht.`, remote: false })
                    }}
                >
                    Entwurf löschen
                </Button>
            }
        >
            <p className="text-foreground">Noch ist nichts geteilt: Der Entwurf liegt nur in diesem Browser, bei GitLab gibt es dazu nichts.</p>
            <Consequences happens={[`Der Entwurf vom ${draftTime(draft.savedAt)} wird gelöscht, mit allem, was du eingetragen hast.`]} stays={[USE_CASE_STAYS]} />
        </Frame>
    )
}

/** A merge request by its number, as a link. */
function MrLink({ close }: { close: { ref: string; url: string } }) {
    return <ExternalAnchor href={close.url}>{close.ref}</ExternalAnchor>
}

/** One line per merge request the deletion closes, the package's first. */
function closeLines(plan: DeletionPlan): ReactNode[] {
    return plan.closes.map((close) =>
        close.what === 'bundle' ? (
            <>
                Merge Request <MrLink close={close} /> wird geschlossen. Die Prüfenden sehen dort, dass du ihn zurückgezogen hast.
            </>
        ) : (
            <>
                Der Katalog-Vorschlag <MrLink close={close} /> wird geschlossen.
            </>
        ),
    )
}

/** The dialog's words for one plan. Undefined `confirm`: nothing to delete, the dialog only explains. */
function planWords(plan: DeletionPlan): { lead: ReactNode; happens: ReactNode[]; stays: ReactNode[]; confirm?: string } {
    switch (plan.kind) {
        case 'withdraw':
            if (plan.listed) {
                return {
                    lead: 'Diese Version steht schon im Katalog. Offen ist nur noch ein Vorschlag dazu - Löschen zieht ihn zurück.',
                    happens: closeLines(plan),
                    stays: [USE_CASE_STAYS, 'Die Version im Katalog, so wie sie ist. Herausnehmen kann sie nur die Katalog-Pflege.'],
                    confirm: 'Zurückziehen',
                }
            }
            return {
                lead: 'Das Paket wartet noch auf die Prüfung. Löschen zieht den Vorschlag zurück.',
                happens: closeLines(plan),
                stays: [
                    USE_CASE_STAYS,
                    'Der geschlossene Merge Request, als Protokoll bei GitLab. „Geteilte Pakete“ zeigt die Version als „Zurückgezogen“, und neu teilen kannst du jederzeit.',
                ],
                confirm: 'Zurückziehen',
            }
        case 'remove': {
            const removal = plan.removal
            const change = removal?.previous
                ? `den Ordner ${removal.folder} auf ${removal.restores ? `Version ${removal.restores}` : 'den Stand'} zurückzusetzen, wie er vor dem Merge war (${fileCount(removal.files)})`
                : `den Ordner ${removal?.folder ?? ''} zu entfernen (${fileCount(removal?.files ?? 0)})`
            return {
                lead: 'Das Paket ist schon geprüft und liegt im Repository. Darüber, ob es wieder herauskommt, entscheiden die Prüfenden - wie beim Aufnehmen. Löschen schlägt es ihnen vor.',
                happens: [...closeLines(plan), `Ein neuer Merge Request schlägt vor, ${change}.`],
                stays: [
                    USE_CASE_STAYS,
                    'Bis die Prüfenden entscheiden, steht die Version hier als „Entfernen wartet auf Prüfung“. Lehnen sie ab, bleibt das Paket, wie es ist.',
                ],
                confirm: plan.closes.length ? 'Zurückziehen und Entfernen vorschlagen' : 'Entfernen vorschlagen',
            }
        }
        default:
            return {
                lead: (
                    <>
                        {plan.reason}
                        {plan.mrUrl && (
                            <>
                                {' '}
                                <ExternalAnchor href={plan.mrUrl}>Merge Request ansehen</ExternalAnchor>
                            </>
                        )}
                    </>
                ),
                happens: [],
                stays: [USE_CASE_STAYS],
            }
    }
}

/** What deleting means for one plan, as the dialog says it: the situation, whose share it is, what happens, what stays. */
export function DeletionSummary({ plan }: { plan: DeletionPlan }) {
    const words = planWords(plan)
    return (
        <>
            {/* In Arbeit lists everything this marketplace shared, so a colleague's share can be deleted here too. */}
            {plan.byOther && plan.proposedBy && plan.kind !== 'none' && (
                <Notice tone="neutral" title={`Das hat ${plan.proposedBy} geteilt, nicht du.`}>
                    Löschen geht trotzdem - sag {plan.proposedBy} am besten vorher Bescheid.
                </Notice>
            )}
            <p className="text-foreground">{words.lead}</p>
            <Consequences happens={words.happens} stays={words.stays} />
        </>
    )
}

function SharedDeletion({
    row,
    title,
    onCancel,
    onDone,
}: {
    row: SharedPackageRow
    title: string
    onCancel: (reload: boolean) => void
    onDone: (done: DeletionDone) => void
}) {
    const [plan, setPlan] = useState<DeletionPlan>()
    const [loadError, setLoadError] = useState<string>()
    const [attempt, setAttempt] = useState(0)
    const [running, setRunning] = useState(false)
    const [notice, setNotice] = useState<{ tone: NoticeTone; text: string }>()
    // A deletion that failed half-way changed GitLab all the same: the list must hear of it.
    const [touched, setTouched] = useState(false)

    useEffect(() => {
        let cancelled = false
        planShareDeletion(row.targetKey, row.slug, row.version)
            .then((answer) => {
                if (cancelled) return
                setPlan(answer.plan)
                setLoadError(answer.error)
            })
            .catch(() => {
                if (!cancelled) setLoadError('Die Anfrage an den Server ist fehlgeschlagen.')
            })
        return () => {
            cancelled = true
        }
    }, [row.targetKey, row.slug, row.version, attempt])

    const words = plan ? planWords(plan) : undefined

    async function confirm() {
        if (!plan || plan.kind === 'none') return
        setNotice(undefined)
        setRunning(true)
        try {
            const result = await deleteShare(row.targetKey, row.slug, row.version, plan.fingerprint)
            if (result.status === 'ok') {
                onDone({ detail: result.detail, mrUrl: result.mrUrl, remote: true })
                return
            }
            if (result.partial) {
                // Part of it happened: what is left is a new plan, read at once instead of on the next click.
                setTouched(true)
                setPlan(undefined)
                setAttempt((count) => count + 1)
            } else if (result.status === 'changed' && result.plan) {
                setPlan(result.plan)
            }
            const quiet = result.status === 'changed' || result.status === 'forbidden' || result.status === 'unconfigured' || result.status === 'unchanged'
            setNotice({ tone: quiet ? 'neutral' : 'error', text: result.detail })
        } catch {
            setNotice({ tone: 'error', text: 'Die Anfrage ist fehlgeschlagen. Bitte erneut versuchen.' })
        } finally {
            setRunning(false)
        }
    }

    return (
        <Frame
            title={title}
            busy={running}
            onClose={() => onCancel(touched)}
            cancelLabel={words && !words.confirm ? 'Schließen' : 'Abbrechen'}
            confirm={
                words?.confirm && (
                    <Button variant="danger" icon={Trash2} pending={running} onClick={() => void confirm()}>
                        {words.confirm}
                    </Button>
                )
            }
        >
            {!plan && !loadError && <Pending>Stand bei GitLab wird geprüft …</Pending>}
            {loadError && (
                <Notice
                    tone="error"
                    live
                    action={
                        <Button
                            onClick={() => {
                                setLoadError(undefined)
                                setAttempt((count) => count + 1)
                            }}
                        >
                            Erneut versuchen
                        </Button>
                    }
                >
                    Was Löschen hier bedeutet, ließ sich nicht prüfen: {loadError}
                </Notice>
            )}
            {notice && (
                <Notice tone={notice.tone} live>
                    {notice.text}
                </Notice>
            )}
            {plan && <DeletionSummary plan={plan} />}
        </Frame>
    )
}
