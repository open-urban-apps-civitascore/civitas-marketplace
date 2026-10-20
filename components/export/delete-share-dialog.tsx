'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Trash2, Undo2, X } from 'lucide-react'

import { Button, ExternalAnchor } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Notice, Pending, type NoticeTone } from '@/components/ui/notice'
import { deleteShare, planShareDeletion } from '@/lib/export-actions'
import type { InProgressItem } from '@/lib/export/in-progress-items'
import { fileCount, type DeletionPlan, type DeletionScope } from '@/lib/export/share-deletion'
import { draftStartedOn, type ShareDraft } from '@/lib/export/share-drafts'
import type { SharedPackageRow } from '@/lib/export/share-listing'

/** What a withdrawal tells the list it came from. */
export interface DeletionDone {
    detail: string
    mrUrl?: string
    /** Something changed at GitLab, so the list reads it again. */
    remote: boolean
}

/**
 * Said in every dialog, in its footer: next to a dataset's name, "verwerfen"
 * or "zurückziehen" could be read as deleting the dataset itself.
 */
export const INSTANCE_STAYS = 'Alles auf dieser Instanz - Datensatz, Datenstrukturen und Daten bleiben, wie sie sind.'

/**
 * „Verwerfen“ (a share only started) or „Zurückziehen“ (a submitted one) for
 * one row of "In Arbeit", confirmed in a dialog that says what it means at the
 * row's stage - which the server decides, from a fresh look at GitLab (see
 * `share-deletion.ts`), not the list from minutes ago. What happens and what
 * stays are named apart, and the button names the deed („Vorschlag
 * zurückziehen“, „Entfernen vorschlagen“), not "OK".
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
    /** `reload`: a failed withdrawal had already changed something at GitLab. */
    onCancel: (reload: boolean) => void
    onDiscardDraft: (datasetId: string) => void
    onDone: (done: DeletionDone) => void
}) {
    if (item.kind === 'draft') {
        const draft = item.draft
        return (
            <DiscardDraftDialog
                title={title}
                draft={draft}
                onCancel={() => onCancel(false)}
                onConfirm={() => {
                    onDiscardDraft(draft.datasetId)
                    onDone({ detail: `„${title}“ ist verworfen.`, remote: false })
                }}
            />
        )
    }
    return <SharedDeletion row={item.row} title={title} onCancel={onCancel} onDone={onDone} />
}

function Frame({
    heading,
    busy,
    onClose,
    cancelLabel = 'Behalten',
    confirm,
    children,
}: {
    heading: string
    busy: boolean
    onClose: () => void
    cancelLabel?: string
    confirm?: ReactNode
    children: ReactNode
}) {
    const titleId = useId()
    const footer = useRef<HTMLDivElement>(null)
    // While GitLab is being changed the dialog stays: closing it would hide how it ended.
    const close = busy ? () => {} : onClose
    // „Behalten“ has the focus first, so a quick Enter keeps everything. After the Modal's own focus
    // move, which it makes on the dialog box: a parent's effects run after its children's.
    useEffect(() => {
        footer.current?.querySelector<HTMLButtonElement>('button')?.focus()
    }, [])
    return (
        <Modal open onClose={close} labelledBy={titleId} className="max-w-lg">
            <div className="flex items-start justify-between gap-3 border-b p-5">
                <h2 id={titleId} className="text-lg font-semibold text-foreground">
                    {heading}
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
            <div className="flex flex-col gap-3 border-t p-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">{INSTANCE_STAYS}</p>
                <div ref={footer} className="flex shrink-0 flex-wrap justify-end gap-2">
                    <Button onClick={close} disabled={busy}>
                        {cancelLabel}
                    </Button>
                    {confirm}
                </div>
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
            {stays.length > 0 && (
                <div className="flex flex-col gap-1.5">
                    <p className="text-xs text-muted-foreground">Das bleibt</p>
                    <ul className="flex list-disc flex-col gap-1 pl-5 text-foreground">
                        {stays.map((line, index) => (
                            <li key={index}>{line}</li>
                        ))}
                    </ul>
                </div>
            )}
        </>
    )
}

/**
 * „Verwerfen“ for a started share, asked first wherever it is offered - in
 * "In Arbeit", in the wizard's top row and behind „Neu beginnen“ (decided
 * 2026-10-18): what was typed lives only in this browser and cannot be
 * brought back.
 */
export function DiscardDraftDialog({
    title,
    draft,
    onCancel,
    onConfirm,
}: {
    title: string
    /** When the share was started, for the dialog's words. */
    draft: Pick<ShareDraft, 'savedAt' | 'startedAt'>
    onCancel: () => void
    onConfirm: () => void
}) {
    return (
        <Frame
            heading={`„${title}“ verwerfen?`}
            busy={false}
            onClose={onCancel}
            confirm={
                <Button variant="danger" icon={Trash2} onClick={onConfirm}>
                    Verwerfen
                </Button>
            }
        >
            <p className="text-foreground">Noch ist nichts eingereicht: Deine Angaben liegen nur in diesem Browser, bei GitLab gibt es dazu nichts.</p>
            <Consequences happens={[`Deine Angaben seit dem ${draftStartedOn(draft)} werden verworfen - zurückholen lassen sie sich nicht.`]} stays={[]} />
        </Frame>
    )
}

/** A merge request by its number, as a link. */
function MrLink({ close }: { close: { ref: string; url: string } }) {
    return <ExternalAnchor href={close.url}>{close.ref}</ExternalAnchor>
}

/** One line per proposal the withdrawal closes, the package's first. */
function closeLines(plan: DeletionPlan): ReactNode[] {
    return plan.closes.map((close) =>
        close.what === 'bundle' ? (
            <>
                Der Vorschlag <MrLink close={close} /> wird geschlossen. Das Katalog-Team sieht dort, dass du ihn zurückgezogen hast.
            </>
        ) : (
            <>
                Der Katalog-Vorschlag <MrLink close={close} /> wird geschlossen.
            </>
        ),
    )
}

/** "Vorschlag zurückziehen", or the plural when two are open. */
function withdrawLabel(plan: DeletionPlan): string {
    return plan.closes.length > 1 ? 'Vorschläge zurückziehen' : 'Vorschlag zurückziehen'
}

/** The dialog's words for one plan. Undefined `confirm`: nothing to withdraw, the dialog only explains. */
function planWords(plan: DeletionPlan): { lead: ReactNode; happens: ReactNode[]; stays: ReactNode[]; confirm?: string } {
    switch (plan.kind) {
        case 'withdraw':
            // The catalogue team's decision: only what would undo it is withdrawn, the package stays.
            if (plan.takenOut) {
                return {
                    lead: 'Das Katalog-Team hat diese Version aus dem Katalog genommen. Offen ist noch ein Vorschlag, der sie zurückbringen würde - Zurückziehen schließt ihn.',
                    happens: closeLines(plan),
                    stays: ['Das angenommene Paket, so wie es ist. Eine neue Version kannst du teilen - frag vorher beim Katalog-Team nach.'],
                    confirm: withdrawLabel(plan),
                }
            }
            if (plan.listed) {
                return {
                    lead: 'Diese Version steht schon im Katalog. Offen ist nur noch ein Vorschlag dazu - Zurückziehen schließt ihn.',
                    happens: closeLines(plan),
                    stays: ['Die Version im Katalog, so wie sie ist. Herausnehmen kann sie nur das Katalog-Team.'],
                    confirm: withdrawLabel(plan),
                }
            }
            if (plan.accepted) {
                return {
                    lead: 'Das Paket ist schon angenommen. Zurückgezogen wird nur, was dazu noch offen ist.',
                    happens: closeLines(plan),
                    stays: ['Das angenommene Paket, so wie es ist.'],
                    confirm: withdrawLabel(plan),
                }
            }
            return {
                lead: 'Das Paket wartet noch auf die Prüfung. Zurückziehen schließt den Vorschlag.',
                happens: closeLines(plan),
                stays: ['Der geschlossene Vorschlag, als Protokoll bei GitLab. „Geteilte Pakete“ zeigt die Version als „Zurückgezogen“, und einreichen kannst du sie jederzeit wieder.'],
                confirm: withdrawLabel(plan),
            }
        case 'remove': {
            const removal = plan.removal
            const change = removal?.previous
                ? `den Ordner ${removal.folder} auf ${removal.restores ? `Version ${removal.restores}` : 'den Stand'} zurückzusetzen, wie er vor der Annahme war (${fileCount(removal.files)})`
                : `den Ordner ${removal?.folder ?? ''} zu entfernen (${fileCount(removal?.files ?? 0)})`
            return {
                lead: 'Das Paket ist schon angenommen. Zurückziehen heißt hier: du schlägst vor, es bei GitLab wieder herauszunehmen - das Katalog-Team entscheidet.',
                happens: [...closeLines(plan), `Ein neuer Vorschlag bittet das Katalog-Team, ${change}.`],
                stays: ['Bis das Katalog-Team entscheidet, steht die Version hier als „Entfernen vorgeschlagen“. Lehnt es ab, bleibt das Paket, wie es ist.'],
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
                                <ExternalAnchor href={plan.mrUrl}>In GitLab ansehen</ExternalAnchor>
                            </>
                        )}
                    </>
                ),
                happens: [],
                stays: [],
            }
    }
}

/** One reading of a version: its plan, and where the person has a choice, the other one. */
export interface DeletionReading {
    plan: DeletionPlan
    alternative?: DeletionPlan
}

/** The plan in view: the chosen scope's where there is a choice, else the one there is. */
function chosenPlan(reading: DeletionReading, scope: DeletionScope): DeletionPlan {
    return [reading.plan, reading.alternative].find((plan) => plan?.scope === scope) ?? reading.plan
}

/** What the confirm button says for the plan in view; undefined when there is nothing to confirm. */
export function confirmLabel(reading: DeletionReading, scope: DeletionScope): string | undefined {
    return planWords(chosenPlan(reading, scope)).confirm
}

/**
 * Only the open proposal, or the accepted package too (decided 2026-10-18):
 * native radios, the least destructive one first and preselected.
 */
function ScopeChoice({
    reading,
    scope,
    disabled,
    onScope,
}: {
    reading: DeletionReading
    scope: DeletionScope
    disabled: boolean
    onScope: (scope: DeletionScope) => void
}) {
    const name = useId()
    const many = reading.plan.closes.length > 1
    const options: { scope: DeletionScope; label: string }[] = [
        {
            scope: 'proposal',
            label: many
                ? 'Nur die offenen Vorschläge zurückziehen - das angenommene Paket bleibt'
                : 'Nur den offenen Vorschlag zurückziehen - das angenommene Paket bleibt',
        },
        { scope: 'version', label: 'Auch das angenommene Paket entfernen lassen - das Katalog-Team entscheidet' },
    ]
    return (
        <fieldset disabled={disabled} className="flex flex-col gap-2">
            <legend className="mb-2 text-foreground">
                Das Paket ist schon angenommen, und {many ? 'dazu sind noch Vorschläge' : 'dazu ist noch ein Vorschlag'} offen. Was
                soll zurückgezogen werden?
            </legend>
            {options.map((option) => (
                <label key={option.scope} className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-foreground">
                    <input
                        type="radio"
                        name={name}
                        value={option.scope}
                        checked={scope === option.scope}
                        onChange={() => onScope(option.scope)}
                        className="mt-0.5 size-4 shrink-0 accent-primary"
                    />
                    <span>{option.label}</span>
                </label>
            ))}
        </fieldset>
    )
}

/** What withdrawing means for one reading, as the dialog says it: whose share it is, the choice, what happens, what stays. */
export function DeletionView({
    reading,
    scope,
    disabled = false,
    onScope,
}: {
    reading: DeletionReading
    scope: DeletionScope
    disabled?: boolean
    onScope: (scope: DeletionScope) => void
}) {
    const plan = chosenPlan(reading, scope)
    const words = planWords(plan)
    return (
        <>
            {/* In Arbeit lists everything this marketplace shared, so a colleague's share can be withdrawn here too. */}
            {plan.byOther && plan.proposedBy && plan.kind !== 'none' && (
                <Notice tone="neutral" title={`Das hat ${plan.proposedBy} eingereicht, nicht du.`}>
                    Zurückziehen geht trotzdem - sag {plan.proposedBy} am besten vorher Bescheid.
                </Notice>
            )}
            {/* With a choice, the question stands in for the lead: the two plans' leads would contradict each other. */}
            {reading.alternative ? (
                <ScopeChoice reading={reading} scope={scope} disabled={disabled} onScope={onScope} />
            ) : (
                <p className="text-foreground">{words.lead}</p>
            )}
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
    const [reading, setReading] = useState<DeletionReading>()
    // The least destructive plan first; kept when a new reading still offers the choice.
    const [scope, setScope] = useState<DeletionScope>('proposal')
    const [loadError, setLoadError] = useState<string>()
    const [attempt, setAttempt] = useState(0)
    const [running, setRunning] = useState(false)
    const [notice, setNotice] = useState<{ tone: NoticeTone; text: string }>()
    // A withdrawal that failed half-way changed GitLab all the same: the list must hear of it.
    const [touched, setTouched] = useState(false)

    useEffect(() => {
        let cancelled = false
        planShareDeletion(row.targetKey, row.slug, row.version)
            .then((answer) => {
                if (cancelled) return
                setReading(answer.plan ? { plan: answer.plan, alternative: answer.alternative } : undefined)
                setLoadError(answer.error)
            })
            .catch(() => {
                if (!cancelled) setLoadError('Die Anfrage an den Server ist fehlgeschlagen.')
            })
        return () => {
            cancelled = true
        }
    }, [row.targetKey, row.slug, row.version, attempt])

    const plan = reading ? chosenPlan(reading, scope) : undefined
    const confirming = reading ? confirmLabel(reading, scope) : undefined

    async function confirm() {
        if (!plan || plan.kind === 'none') return
        setNotice(undefined)
        setRunning(true)
        try {
            // Without a choice the one plan answers any scope; with one, the server reads the chosen plan again.
            const result = await deleteShare(row.targetKey, row.slug, row.version, plan.fingerprint, plan.scope ?? 'proposal')
            if (result.status === 'ok') {
                onDone({ detail: result.detail, mrUrl: result.mrUrl, remote: true })
                return
            }
            if (result.partial) {
                // Part of it happened: what is left is a new plan, read at once instead of on the next click.
                setTouched(true)
                setReading(undefined)
                setAttempt((count) => count + 1)
            } else if (result.status === 'changed' && result.plan) {
                setReading({ plan: result.plan, alternative: result.alternative })
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
            heading={`„${title}“ zurückziehen?`}
            busy={running}
            onClose={() => onCancel(touched)}
            cancelLabel={reading && !confirming ? 'Schließen' : 'Behalten'}
            confirm={
                confirming && (
                    <Button variant="danger" icon={Undo2} pending={running} onClick={() => void confirm()}>
                        {confirming}
                    </Button>
                )
            }
        >
            {!reading && !loadError && <Pending>Stand bei GitLab wird geprüft …</Pending>}
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
                    Was Zurückziehen hier bedeutet, ließ sich nicht prüfen: {loadError}
                </Notice>
            )}
            {notice && (
                <Notice tone={notice.tone} live>
                    {notice.text}
                </Notice>
            )}
            {reading && <DeletionView reading={reading} scope={scope} disabled={running} onScope={setScope} />}
        </Frame>
    )
}
