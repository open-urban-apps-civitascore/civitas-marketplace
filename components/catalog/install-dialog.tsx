'use client'

import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Download, FileSearch, PlayCircle, ShieldCheck, X } from 'lucide-react'

import { feedbackText } from '@/components/catalog/install-button'
import { InstallOutcomeView } from '@/components/catalog/install-outcome'
import { SubmitButton } from '@/components/catalog/submit-button'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { InlineNotice, Notice, type NoticeTone } from '@/components/ui/notice'
import { Select } from '@/components/ui/select'
import type { PackageContents } from '@/lib/catalog/package-contents'
import { DATAPOOL_NAME_MAX, DATAPOOL_NAME_MIN, suggestDatapoolName } from '@/lib/datapool-name'
import type { DatapoolOption } from '@/lib/datapools'
import { installEntry, type InstallResult } from '@/lib/install-actions'
import { cn } from '@/lib/utils'

/**
 * The use-case install wizard: data source → target and release → review.
 *
 * The target is the datapool the use case is installed into. A package cannot
 * carry it, because datapools exist only on the receiving instance, so the
 * dialog asks. The release half of that step decides how the use case stands
 * afterwards: as a draft, the default, because a release publishes data and is
 * the operator's call; or released in the same step, which stages and releases
 * the dataset right after the install (see installEntry).
 *
 * Shaped like the clickdummy's wizard (install-use-case-button.tsx): a modal
 * with one decision per view, numbered steps, radio choices with the demo-data
 * start featured, and for an entry nobody has checked in depth one view before
 * the wizard that says so (friction in proportion to trust, D11).
 */

type DataSourceMode = 'demo' | 'custom' | 'later'
type ReleaseMode = 'draft' | 'release'
/**
 * Where the install goes. For a person who may create pools, a new one is the
 * default, under a proposed name: it puts nothing next to data whose access was
 * set up for something else, and choosing an existing pool stays a deliberate
 * step. Without that right the new pool is shown but not offered, so the
 * dialog does not preselect what the platform would refuse.
 */
type DatapoolMode = 'new' | 'existing'

/** Why the wizard is preceded by a note: the seal says "not reviewed in depth", or there is no seal yet. */
export type InstallAcknowledgement = 'experimental' | 'unreviewed'

const STEPS = ['Datenquelle', 'Ziel und Freigabe', 'Prüfen'] as const

const STEP_HINTS: Record<number, string | undefined> = {
    0: 'Woher kommen die Daten? Zum Ausprobieren brauchen Sie noch keine eigenen.',
    2: 'Alles auf einen Blick - erst nach Ihrer Bestätigung wird etwas angelegt.',
}

const ACKNOWLEDGEMENT: Record<InstallAcknowledgement, { title: string; text: string }> = {
    experimental: {
        title: 'Als „Experimentell“ eingestuft',
        text: 'Dieser Eintrag ist formal gültig, aber noch nicht inhaltlich geprüft.',
    },
    unreviewed: {
        title: 'Noch ohne Siegel',
        text: 'Die Kuratierung hat diesen Eintrag noch nicht eingestuft.',
    },
}

/** A refusal is the platform's answer to this attempt; "already installed" is a fact, not a failure. */
const RESULT_TONES: Record<InstallResult['status'], NoticeTone> = {
    created: 'success',
    conflict: 'neutral',
    invalid: 'error',
    error: 'error',
}

/**
 * Which existing datapool is selected once the user switches to one. A single
 * pool is no choice, so it is taken. With several, none is preselected: a
 * default would let a user click through into a pool they never looked at, and
 * the pool decides who gets access to what is installed there.
 */
function initialDatapoolId(datapools: DatapoolOption[]): string {
    return datapools.length === 1 ? datapools[0].id : ''
}

export function InstallDialog({
    entryId,
    displayName,
    version,
    installed = false,
    demoAvailable = false,
    datapools = [],
    datapoolProblem,
    canCreateDatapool = false,
    acknowledge,
    contents,
    triggerLabel = 'Nachnutzen',
    title,
    datapoolNamePrefix = '',
    installationHref,
    onInstalled,
}: {
    entryId: string
    displayName: string
    version: string
    /** Already present in this instance: the dialog then renders nothing. */
    installed?: boolean
    /** Simulator reachable — gates the demo-data option, not the dialog. */
    demoAvailable?: boolean
    /** The datapools the signed-in user can read; the install goes into one of them. */
    datapools?: DatapoolOption[]
    /** Why the list is empty although the instance may well have datapools. */
    datapoolProblem?: string
    /** DATAPOOL_CREATE across the tenant: decides whether a new pool is offered. */
    canCreateDatapool?: boolean
    /** Set for a catalogue entry nobody has reviewed in depth: a note comes before the wizard. */
    acknowledge?: InstallAcknowledgement
    /** What the package holds, for the review's "Das wird angelegt"; absent, the review lists the choices only. */
    contents?: PackageContents
    /** The trigger's text; the assistant's plan card says "Plan bestätigen". */
    triggerLabel?: string
    /** The dialog's heading; by default the entry is taken over ("nachnutzen"). */
    title?: string
    /** Put in front of the proposed name of a new datapool, e.g. "[AI-Assistant] " for generated use cases. */
    datapoolNamePrefix?: string
    /** Where the new installation can be looked at; set, the success message links there in a new tab. */
    installationHref?: (installationId: string) => string
    /** Called once when the install succeeded, e.g. for the assistant to report it in the chat. */
    onInstalled?: (result: InstallResult) => void
}) {
    const titleId = useId()
    const [open, setOpen] = useState(false)
    const [acknowledged, setAcknowledged] = useState(false)
    const [step, setStep] = useState(0)
    const [mode, setMode] = useState<DataSourceMode>(demoAvailable ? 'demo' : 'later')
    const [brokerUrl, setBrokerUrl] = useState('')
    const [datapoolMode, setDatapoolMode] = useState<DatapoolMode>(canCreateDatapool ? 'new' : 'existing')
    const [newDatapoolName, setNewDatapoolName] = useState(() =>
        suggestDatapoolName(
            `${datapoolNamePrefix}${displayName}`,
            version,
            datapools.map((pool) => pool.name),
        ),
    )
    const [datapoolId, setDatapoolId] = useState(() => initialDatapoolId(datapools))
    const [releaseMode, setReleaseMode] = useState<ReleaseMode>('draft')
    const [result, formAction, pending] = useActionState(installEntry, null)

    // The action's result is the same object on every render after the install,
    // so the ref keeps the success from being reported twice.
    const reported = useRef<InstallResult | null>(null)
    useEffect(() => {
        if (result?.status !== 'created' || reported.current === result) return
        reported.current = result
        onInstalled?.(result)
    }, [result, onInstalled])

    const done = installed || result?.status === 'created'
    const datapool = datapools.find((pool) => pool.id === datapoolId)
    // A custom source without an address would install the package default and
    // silently ignore the user's choice — block the step instead. The same goes
    // for the target: without a datapool the platform refuses the whole install.
    const stepIncomplete =
        (step === 0 && mode === 'custom' && brokerUrl.trim() === '') ||
        (step === 1 &&
            (datapoolMode === 'existing'
                ? !datapool
                : newDatapoolName.trim().length < DATAPOOL_NAME_MIN))
    const needsAcknowledgement = acknowledge !== undefined && !acknowledged && !done

    function close() {
        // An install in flight finishes whether or not the dialog is open; closing would hide its answer.
        if (pending) return
        setOpen(false)
        setStep(0)
    }

    // Installed and closed: the page's installation section has taken over, and
    // a disabled trigger would only repeat the badge. An install from this
    // dialog re-renders the page as installed (revalidatePath) while the dialog
    // is still open, so its outcome stays readable until "Fertig".
    if (installed && !open) return null

    return (
        <div className="flex flex-col gap-2">
            {/* Download, not Sparkles: installing is a fixed sequence of steps, not magic (design system §6). */}
            {!done && (
                <Button variant="primary" icon={Download} onClick={() => setOpen(true)}>
                    {triggerLabel}
                </Button>
            )}
            {/* A refusal stays below the trigger once the dialog is closed, so
                the user can retry knowing why. A success needs no trace here. */}
            {!open && result && result.status !== 'created' && (
                <Notice tone={RESULT_TONES[result.status]} className="rounded-md px-3 py-2">
                    {feedbackText(result)}
                </Notice>
            )}

            <Modal open={open} onClose={close} labelledBy={titleId}>
                <div className="flex items-start justify-between gap-3 border-b p-5">
                    <h2 id={titleId} className="text-lg font-semibold text-foreground">
                        {title ?? `„${displayName}“ nachnutzen`}
                    </h2>
                    <button
                        type="button"
                        onClick={close}
                        aria-label="Schließen"
                        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                        <X className="size-5" />
                    </button>
                </div>

                {needsAcknowledgement ? (
                    <>
                        <div className="flex flex-col gap-3 overflow-y-auto p-5">
                            <Notice tone="warn" title={ACKNOWLEDGEMENT[acknowledge].title}>
                                {ACKNOWLEDGEMENT[acknowledge].text} Ausprobieren ist gefahrlos - die Installation
                                lässt sich wieder entfernen. Für den Produktivbetrieb wird ein geprüfter Eintrag
                                empfohlen.
                            </Notice>
                        </div>
                        <div className="flex flex-wrap justify-end gap-2 border-t p-4">
                            <Button onClick={close}>Abbrechen</Button>
                            <Button variant="primary" onClick={() => setAcknowledged(true)}>
                                Verstanden, weiter
                            </Button>
                        </div>
                    </>
                ) : (
                    <>
                        <ol aria-label="Schritte" className="flex flex-wrap items-center gap-1.5 px-5 pt-4">
                            {STEPS.map((label, index) => (
                                <li key={label} aria-current={index === step ? 'step' : undefined} className="flex items-center gap-1.5">
                                    {index > 0 && <span aria-hidden className="h-px w-4 bg-border" />}
                                    <span
                                        className={cn(
                                            'grid size-6 place-items-center rounded-full text-xs font-semibold',
                                            index === step
                                                ? 'bg-primary text-primary-foreground'
                                                : index < step
                                                  ? 'bg-primary/15 text-primary'
                                                  : 'bg-muted text-muted-foreground',
                                        )}
                                    >
                                        {index + 1}
                                    </span>
                                    <span className={cn('text-xs font-medium', index === step ? 'text-foreground' : 'text-muted-foreground')}>
                                        {label}
                                    </span>
                                </li>
                            ))}
                        </ol>

                        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
                            {STEP_HINTS[step] && <p className="text-sm text-muted-foreground">{STEP_HINTS[step]}</p>}

                            {step === 0 && (
                                <DataSourceStep
                                    mode={mode}
                                    onMode={setMode}
                                    brokerUrl={brokerUrl}
                                    onBrokerUrl={setBrokerUrl}
                                    demoAvailable={demoAvailable}
                                />
                            )}
                            {step === 1 && (
                                <TargetStep
                                    datapools={datapools}
                                    datapoolProblem={datapoolProblem}
                                    canCreateDatapool={canCreateDatapool}
                                    datapoolMode={datapoolMode}
                                    onDatapoolMode={setDatapoolMode}
                                    newDatapoolName={newDatapoolName}
                                    onNewDatapoolName={setNewDatapoolName}
                                    datapoolId={datapoolId}
                                    onDatapool={setDatapoolId}
                                    releaseMode={releaseMode}
                                    onReleaseMode={setReleaseMode}
                                />
                            )}
                            {step === 2 && (
                                <ReviewStep
                                    displayName={displayName}
                                    version={version}
                                    mode={mode}
                                    brokerUrl={brokerUrl}
                                    datapoolName={
                                        datapoolMode === 'new'
                                            ? `„${newDatapoolName.trim()}“, wird neu angelegt`
                                            : (datapool?.name ?? '')
                                    }
                                    releaseMode={releaseMode}
                                    contents={contents}
                                />
                            )}

                            {step === 2 && result?.status === 'created' && result.outcome && (
                                <InstallOutcomeView
                                    outcome={result.outcome}
                                    installationHref={
                                        result.installationId && installationHref
                                            ? installationHref(result.installationId)
                                            : undefined
                                    }
                                />
                            )}
                            {step === 2 && result && !(result.status === 'created' && result.outcome) && (
                                <Notice tone={RESULT_TONES[result.status]} live>
                                    {feedbackText(result)}
                                    {result.status === 'created' && result.installationId && installationHref && (
                                        <>
                                            {' '}
                                            <a
                                                href={installationHref(result.installationId)}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="font-medium underline"
                                            >
                                                Installation ansehen ↗
                                            </a>
                                        </>
                                    )}
                                </Notice>
                            )}
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 border-t p-4">
                            {done ? <span /> : (
                                <Button variant="ghost" onClick={close} disabled={pending}>
                                    Abbrechen
                                </Button>
                            )}
                            <div className="flex gap-2">
                                {step > 0 && !done && (
                                    <Button icon={ArrowLeft} onClick={() => setStep(step - 1)} disabled={pending}>
                                        Zurück
                                    </Button>
                                )}
                                {step < 2 ? (
                                    <Button variant="primary" onClick={() => setStep(step + 1)} disabled={stepIncomplete}>
                                        Weiter
                                        <ArrowRight aria-hidden className="size-4" />
                                    </Button>
                                ) : done ? (
                                    <Button variant="primary" onClick={close}>
                                        Fertig
                                    </Button>
                                ) : (
                                    <form action={formAction}>
                                        <input type="hidden" name="entryId" value={entryId} />
                                        <input type="hidden" name="dataSourceMode" value={mode} />
                                        <input type="hidden" name="brokerUrl" value={brokerUrl} />
                                        <input type="hidden" name="datapoolMode" value={datapoolMode} />
                                        <input
                                            type="hidden"
                                            name="datapoolId"
                                            value={datapoolMode === 'existing' ? datapoolId : ''}
                                        />
                                        <input
                                            type="hidden"
                                            name="newDatapoolName"
                                            value={datapoolMode === 'new' ? newDatapoolName.trim() : ''}
                                        />
                                        <input type="hidden" name="releaseMode" value={releaseMode} />
                                        <SubmitButton
                                            pending={pending}
                                            icon={Download}
                                            label="Jetzt installieren"
                                            pendingLabel="Wird installiert …"
                                        />
                                    </form>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </Modal>
        </div>
    )
}

/**
 * One choice of a step as a radio, the clickdummy's pattern: a native radio
 * group gives arrow keys and one tab stop for free. The checked choice gets
 * the primary tint; the featured one (the demo start) is tinted always, as a
 * recommendation. What a choice needs filled in shows right under it once it
 * is chosen.
 */
function Choice({
    name,
    checked,
    disabled = false,
    onSelect,
    title,
    description,
    featured = false,
    children,
}: {
    name: string
    checked: boolean
    disabled?: boolean
    onSelect: () => void
    title: string
    description: string
    featured?: boolean
    children?: ReactNode
}) {
    return (
        <div className="flex flex-col gap-2">
            <label
                className={cn(
                    'flex cursor-pointer items-start gap-2.5 rounded-md border p-3 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60',
                    featured
                        ? 'border-emerald-300 bg-emerald-50/60 has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:has-[:checked]:border-emerald-600'
                        : 'has-[:checked]:border-primary has-[:checked]:bg-primary/5',
                )}
            >
                <input
                    type="radio"
                    name={name}
                    checked={checked}
                    disabled={disabled}
                    onChange={onSelect}
                    className={cn('mt-0.5', featured ? 'accent-emerald-600' : 'accent-primary')}
                />
                <span className="flex flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground">{title}</span>
                        {featured && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
                                <PlayCircle aria-hidden className="size-3" />
                                Empfohlen zum Ausprobieren
                            </span>
                        )}
                    </span>
                    <span className="text-xs leading-relaxed text-muted-foreground">{description}</span>
                </span>
            </label>
            {checked && children && <div className="ml-6">{children}</div>}
        </div>
    )
}

function DataSourceStep({
    mode,
    onMode,
    brokerUrl,
    onBrokerUrl,
    demoAvailable,
}: {
    mode: DataSourceMode
    onMode: (mode: DataSourceMode) => void
    brokerUrl: string
    onBrokerUrl: (url: string) => void
    demoAvailable: boolean
}) {
    return (
        <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Datenquelle</legend>
            <Choice
                name="dataSource"
                checked={mode === 'demo'}
                disabled={!demoAvailable}
                onSelect={() => onMode('demo')}
                featured={demoAvailable}
                title="Mit Demo-Daten starten"
                description={
                    demoAvailable
                        ? 'Der Anwendungsfall sendet nach der Freigabe mitgelieferte Beispieldaten - ohne eigene Sensoren, ohne Konfiguration. Ideal, um zu sehen, ob er zu Ihrer Kommune passt.'
                        : 'Nicht verfügbar: Der Demo-Daten-Simulator ist auf dieser Instanz nicht konfiguriert (SIMULATOR_API_URL).'
                }
            />
            <Choice
                name="dataSource"
                checked={mode === 'custom'}
                onSelect={() => onMode('custom')}
                title="Eigene Datenquelle anbinden"
                description="Verbindet den Anwendungsfall direkt mit Ihrem MQTT-Broker."
            >
                <label className="flex flex-col gap-1 text-xs font-medium">
                    MQTT-Broker-URL *
                    <input
                        type="text"
                        value={brokerUrl}
                        onChange={(event) => onBrokerUrl(event.target.value)}
                        placeholder="tcp://broker.meine-kommune.de:1883"
                        className="rounded-md border bg-background px-2.5 py-1.5 font-mono text-xs"
                    />
                    <span className="font-normal text-muted-foreground">
                        Wird für die Datenquellen übernommen, die das Paket dafür freigibt.
                    </span>
                </label>
            </Choice>
            <Choice
                name="dataSource"
                checked={mode === 'later'}
                onSelect={() => onMode('later')}
                title="Später konfigurieren"
                description="Installiert mit der Standard-Konfiguration des Pakets - die Broker-Adresse lässt sich danach im Portal anpassen."
            />
        </fieldset>
    )
}

function TargetStep({
    datapools,
    datapoolProblem,
    canCreateDatapool,
    datapoolMode,
    onDatapoolMode,
    newDatapoolName,
    onNewDatapoolName,
    datapoolId,
    onDatapool,
    releaseMode,
    onReleaseMode,
}: {
    datapools: DatapoolOption[]
    datapoolProblem?: string
    canCreateDatapool: boolean
    datapoolMode: DatapoolMode
    onDatapoolMode: (mode: DatapoolMode) => void
    newDatapoolName: string
    onNewDatapoolName: (name: string) => void
    datapoolId: string
    onDatapool: (id: string) => void
    releaseMode: ReleaseMode
    onReleaseMode: (mode: ReleaseMode) => void
}) {
    const selected = datapools.find((pool) => pool.id === datapoolId)
    const nameTooShort = newDatapoolName.trim().length < DATAPOOL_NAME_MIN

    return (
        <div className="flex flex-col gap-6">
            <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm text-muted-foreground">
                    In welchem Datenpool soll der Anwendungsfall angelegt werden? Datenquellen und
                    Datensatz gehören danach zu diesem Pool. Über ihn werden auch die
                    Zugriffsrechte vergeben.
                </legend>
                <Choice
                    name="datapoolMode"
                    checked={datapoolMode === 'new'}
                    disabled={!canCreateDatapool}
                    onSelect={() => onDatapoolMode('new')}
                    title="Neuen Datenpool anlegen"
                    description={
                        canCreateDatapool
                            ? 'Wird mit der Installation angelegt. Wer darauf zugreifen darf, legen Sie danach im Portal fest.'
                            : 'Ihrer Rolle fehlt das Recht, Datenpools anzulegen (in CIVITAS/CORE hat es der Data Architect). Wählen Sie einen bestehenden Datenpool.'
                    }
                >
                    <label className="flex flex-col gap-1 text-xs font-medium">
                        Name des Datenpools
                        <input
                            type="text"
                            value={newDatapoolName}
                            onChange={(event) => onNewDatapoolName(event.target.value)}
                            maxLength={DATAPOOL_NAME_MAX}
                            className="rounded-md border bg-background px-2.5 py-1.5 text-sm font-normal"
                        />
                        {/* Something to fix right here, so warn (design system §4.4). */}
                        {nameTooShort && <InlineNotice tone="warn">Mindestens {DATAPOOL_NAME_MIN} Zeichen.</InlineNotice>}
                    </label>
                </Choice>
                <Choice
                    name="datapoolMode"
                    checked={datapoolMode === 'existing'}
                    disabled={datapools.length === 0}
                    onSelect={() => onDatapoolMode('existing')}
                    title="Bestehenden Datenpool wählen"
                    description={
                        datapools.length === 0
                            ? (datapoolProblem ??
                              'Auf dieser Instanz gibt es noch keinen Datenpool, den Sie lesen dürfen.')
                            : 'Datenquellen und Datensatz kommen zu dem, was dort schon liegt, und erben dessen Zugriffsrechte.'
                    }
                >
                    <label className="flex flex-col gap-1 text-xs font-medium">
                        Datenpool
                        <Select
                            value={datapoolId}
                            onValueChange={onDatapool}
                            placeholder="Bitte wählen …"
                            className="px-2 py-1.5 font-normal"
                            options={datapools.map((pool) => ({ value: pool.id, label: pool.name }))}
                        />
                        {selected?.description && (
                            <span className="font-normal text-muted-foreground">
                                {selected.description}
                            </span>
                        )}
                    </label>
                </Choice>
            </fieldset>

            <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm text-muted-foreground">
                    Wie soll der Anwendungsfall nach der Installation stehen?
                </legend>
                <Choice
                    name="releaseMode"
                    checked={releaseMode === 'draft'}
                    onSelect={() => onReleaseMode('draft')}
                    title="Als Entwurf installieren"
                    description="Datenstrukturen und Datenquellen werden freigegeben, der Datensatz bleibt ein Entwurf. Seine Freigabe erfolgt anschließend im Portal (Datensatz → Freigeben)."
                />
                <Choice
                    name="releaseMode"
                    checked={releaseMode === 'release'}
                    onSelect={() => onReleaseMode('release')}
                    title="Sofort freigeben"
                    description="Installiert und gibt in einem Schritt frei. Die Plattform richtet danach Speicher und Pipeline ein, dann fließen die Daten. Zurücknehmen lässt sich die Freigabe im Portal."
                />
            </fieldset>
        </div>
    )
}

const MODE_LABELS: Record<DataSourceMode, string> = {
    demo: 'Mit Demo-Daten starten',
    custom: 'Eigene Datenquelle',
    later: 'Später konfigurieren',
}

function ReviewStep({
    displayName,
    version,
    mode,
    brokerUrl,
    datapoolName,
    releaseMode,
    contents,
}: {
    displayName: string
    version: string
    mode: DataSourceMode
    brokerUrl: string
    datapoolName: string
    releaseMode: ReleaseMode
    contents?: PackageContents
}) {
    const streams = mode === 'demo' ? (contents?.demoStreams ?? []) : []
    const count = (contents?.parts ?? []).reduce((sum, part) => sum + part.names.length, 0) + streams.length
    return (
        <div className="flex flex-col gap-4">
            <dl className="flex flex-col gap-3 text-sm">
                <ReviewRow label="Paket" value={`${displayName} · v${version}`} />
                <ReviewRow label="Datenquelle" value={MODE_LABELS[mode]} />
                {mode === 'custom' && <ReviewRow label="MQTT-Broker" value={brokerUrl} mono />}
                <ReviewRow label="Datenpool" value={datapoolName} />
                <ReviewRow
                    label="Freigabe"
                    value={
                        releaseMode === 'release'
                            ? 'Sofort freigeben, Daten fließen nach der Einrichtung'
                            : 'Als Entwurf, Freigabe danach im Portal'
                    }
                />
            </dl>
            {/* Grouped by kind rather than one flat list (clickdummy, `DryRunPreview`): "4 Datenstrukturen,
                2 Datenquellen" reads as a plan, a mixed stack of rows just as a lot. */}
            {contents && count > 0 && (
                <div className="flex flex-col gap-4 rounded-md border bg-background p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                            <FileSearch aria-hidden className="size-4 text-muted-foreground" />
                            Das wird angelegt
                        </p>
                        <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                            {count} {count === 1 ? 'Element' : 'Elemente'}
                        </span>
                    </div>
                    {contents.parts.map((part) => (
                        <PlanGroup key={part.type} title={part.label} names={part.names} />
                    ))}
                    {streams.length > 0 && <PlanGroup title={streams.length === 1 ? 'Demo-Datenstrom' : 'Demo-Datenströme'} names={streams} />}
                </div>
            )}
            {/* What a data protection officer signs off on: a sentence about what is NOT touched.
                The install creates copies with identities of their own (see lib/catalog/types). */}
            <div className="rounded-md bg-muted/50 p-3">
                <p className="flex items-center gap-2 text-xs font-medium text-foreground">
                    <ShieldCheck aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                    Was unberührt bleibt
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    Bestehende Datensätze, Datenquellen und Pipelines dieser Instanz bleiben unverändert: die
                    Installation legt eigene an.
                </p>
            </div>
        </div>
    )
}

function PlanGroup({ title, names }: { title: string; names: string[] }) {
    return (
        <section>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {title} <span className="font-normal">({names.length})</span>
            </p>
            <ul className="mt-1.5 divide-y rounded-md border">
                {names.map((name, index) => (
                    <li key={`${name}:${index}`} className="px-3 py-2 text-sm font-medium text-foreground">
                        {name}
                    </li>
                ))}
            </ul>
        </section>
    )
}

function ReviewRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="flex flex-col gap-0.5 border-b pb-2 last:border-b-0">
            <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
            <dd className={mono ? 'font-mono text-xs' : ''}>{value}</dd>
        </div>
    )
}
