'use client'

import { useActionState, useState } from 'react'
import { Check, Download, PlayCircle, X } from 'lucide-react'

import { FEEDBACK_STYLES, feedbackText } from '@/components/catalog/install-button'
import { SubmitButton } from '@/components/catalog/submit-button'
import type { DatapoolOption } from '@/lib/datapools'
import { installEntry } from '@/lib/install-actions'

/**
 * The use-case install wizard: data source → target and release → review.
 *
 * The target is the datapool the use case is installed into. A package cannot
 * carry it, because datapools exist only on the receiving instance, so the
 * dialog asks. The release half of that step decides how the use case stands
 * afterwards: as a draft, the default, because a release publishes data and is
 * the operator's call; or released in the same step, which stages and releases
 * the dataset right after the install (see installEntry).
 */

type DataSourceMode = 'demo' | 'custom' | 'later'
type ReleaseMode = 'draft' | 'release'

const STEPS = ['Datenquelle', 'Ziel und Freigabe', 'Prüfen'] as const

/**
 * Which datapool the dialog opens with. A single pool is no choice, so it is
 * taken. With several, none is preselected: a default would let a user click
 * through into a pool they never looked at, and the pool decides who gets
 * access to what is installed there.
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
}) {
    const [open, setOpen] = useState(false)
    const [step, setStep] = useState(0)
    const [mode, setMode] = useState<DataSourceMode>(demoAvailable ? 'demo' : 'later')
    const [brokerUrl, setBrokerUrl] = useState('')
    const [datapoolId, setDatapoolId] = useState(() => initialDatapoolId(datapools))
    const [releaseMode, setReleaseMode] = useState<ReleaseMode>('draft')
    const [result, formAction, pending] = useActionState(installEntry, null)

    const done = installed || result?.status === 'created'
    const datapool = datapools.find((pool) => pool.id === datapoolId)
    // A custom source without an address would install the package default and
    // silently ignore the user's choice — block the step instead. The same goes
    // for the target: without a datapool the platform refuses the whole install.
    const stepIncomplete =
        (step === 0 && mode === 'custom' && brokerUrl.trim() === '') ||
        (step === 1 && !datapool)

    function close() {
        setOpen(false)
        setStep(0)
    }

    // Installed when the page loaded: the page's installation section has taken
    // over, and a disabled trigger would only repeat the badge. An install from
    // this dialog re-renders the page as installed too (revalidatePath), so the
    // dialog stays while it has an outcome of its own to show.
    if (installed && !result) return null

    return (
        <div className="flex flex-col gap-2">
            {!done && (
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                >
                    <Download className="size-4" />
                    Installieren
                </button>
            )}
            {!open && result && (
                <p className={`text-xs leading-relaxed ${FEEDBACK_STYLES[result.status]}`}>
                    {feedbackText(result)}
                </p>
            )}

            {open && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label={`„${displayName}“ installieren`}
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                >
                    <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border bg-card shadow-xl">
                        <div className="flex items-center justify-between border-b px-5 py-4">
                            <h2 className="text-base font-semibold">„{displayName}“ installieren</h2>
                            <button
                                type="button"
                                onClick={close}
                                aria-label="Schließen"
                                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted"
                            >
                                <X className="size-4" />
                            </button>
                        </div>

                        <div className="flex items-center gap-2 border-b px-5 py-3 text-sm">
                            {STEPS.map((label, index) => (
                                <div key={label} className="flex items-center gap-2">
                                    {index > 0 && <span className="w-6 border-t" />}
                                    <span
                                        className={`flex size-6 items-center justify-center rounded-full text-xs font-semibold ${
                                            index === step
                                                ? 'bg-primary text-primary-foreground'
                                                : index < step
                                                  ? 'bg-success/15 text-success'
                                                  : 'bg-muted text-muted-foreground'
                                        }`}
                                    >
                                        {index < step ? <Check className="size-3.5" /> : index + 1}
                                    </span>
                                    <span className={index === step ? 'font-medium' : 'text-muted-foreground'}>
                                        {label}
                                    </span>
                                </div>
                            ))}
                        </div>

                        <div className="flex-1 overflow-auto px-5 py-4">
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
                                    datapoolName={datapool?.name ?? ''}
                                    releaseMode={releaseMode}
                                />
                            )}

                            {step === 2 && result && (
                                <p className={`mt-3 text-xs leading-relaxed ${FEEDBACK_STYLES[result.status]}`}>
                                    {feedbackText(result)}
                                </p>
                            )}
                        </div>

                        <div className="flex items-center justify-between border-t px-5 py-4">
                            <button
                                type="button"
                                onClick={step === 0 ? close : () => setStep(step - 1)}
                                className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
                            >
                                {step === 0 ? 'Abbrechen' : 'Zurück'}
                            </button>
                            {step < 2 ? (
                                <button
                                    type="button"
                                    onClick={() => setStep(step + 1)}
                                    disabled={stepIncomplete}
                                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                                >
                                    Weiter →
                                </button>
                            ) : done ? (
                                <button
                                    type="button"
                                    onClick={close}
                                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                                >
                                    Fertig
                                </button>
                            ) : (
                                <form action={formAction}>
                                    <input type="hidden" name="entryId" value={entryId} />
                                    <input type="hidden" name="dataSourceMode" value={mode} />
                                    <input type="hidden" name="brokerUrl" value={brokerUrl} />
                                    <input type="hidden" name="datapoolId" value={datapoolId} />
                                    <input type="hidden" name="releaseMode" value={releaseMode} />
                                    <SubmitButton
                                        pending={pending}
                                        icon={Download}
                                        label="Installieren"
                                        pendingLabel="Installiere …"
                                    />
                                </form>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

function OptionCard({
    selected,
    disabled = false,
    onSelect,
    title,
    badge,
    description,
    children,
}: {
    selected: boolean
    disabled?: boolean
    onSelect: () => void
    title: string
    badge?: string
    description: string
    children?: React.ReactNode
}) {
    return (
        <div
            className={`rounded-lg border p-4 transition-colors ${
                selected ? 'border-success bg-success/5' : disabled ? 'opacity-60' : 'hover:bg-muted/50'
            }`}
        >
            <button
                type="button"
                onClick={onSelect}
                disabled={disabled}
                className="flex w-full items-start gap-3 text-left disabled:cursor-not-allowed"
            >
                <span
                    className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${
                        selected ? 'border-success' : 'border-muted-foreground/50'
                    }`}
                >
                    {selected && <span className="size-2 rounded-full bg-success" />}
                </span>
                <span className="flex flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {title}
                        {badge && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                                <PlayCircle className="size-3" />
                                {badge}
                            </span>
                        )}
                    </span>
                    <span className="text-xs leading-relaxed text-muted-foreground">{description}</span>
                </span>
            </button>
            {selected && children && <div className="mt-3 pl-7">{children}</div>}
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
        <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
                Woher kommen die Daten? Zum Ausprobieren brauchen Sie noch keine eigenen.
            </p>
            <OptionCard
                selected={mode === 'demo'}
                disabled={!demoAvailable}
                onSelect={() => onMode('demo')}
                title="Mit Demo-Daten starten"
                badge="Empfohlen zum Ausprobieren"
                description={
                    demoAvailable
                        ? 'Der Anwendungsfall sendet nach der Freigabe mitgelieferte Beispieldaten — ohne eigene Sensoren, ohne Konfiguration. Ideal, um zu sehen, ob er zu Ihrer Kommune passt.'
                        : 'Nicht verfügbar: Der Demo-Daten-Simulator ist auf dieser Instanz nicht konfiguriert (SIMULATOR_API_URL).'
                }
            />
            <OptionCard
                selected={mode === 'custom'}
                onSelect={() => onMode('custom')}
                title="Eigene Datenquelle anbinden"
                description="Verbindet den Anwendungsfall direkt mit Ihrem MQTT-Broker."
            >
                <label className="flex flex-col gap-1 text-xs font-medium">
                    MQTT-Broker-URL
                    <input
                        type="text"
                        value={brokerUrl}
                        onChange={(event) => onBrokerUrl(event.target.value)}
                        placeholder="tcp://broker.meine-kommune.de:1883"
                        className="rounded-md border bg-background px-2 py-1.5 font-mono text-xs"
                    />
                    <span className="font-normal text-muted-foreground">
                        Wird für die Datenquellen übernommen, die das Paket dafür freigibt.
                    </span>
                </label>
            </OptionCard>
            <OptionCard
                selected={mode === 'later'}
                onSelect={() => onMode('later')}
                title="Später konfigurieren"
                description="Installiert mit der Standard-Konfiguration des Pakets — die Broker-Adresse lässt sich danach im Portal anpassen."
            />
        </div>
    )
}

function TargetStep({
    datapools,
    datapoolProblem,
    datapoolId,
    onDatapool,
    releaseMode,
    onReleaseMode,
}: {
    datapools: DatapoolOption[]
    datapoolProblem?: string
    datapoolId: string
    onDatapool: (id: string) => void
    releaseMode: ReleaseMode
    onReleaseMode: (mode: ReleaseMode) => void
}) {
    const selected = datapools.find((pool) => pool.id === datapoolId)

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                    In welchem Datenpool soll der Anwendungsfall angelegt werden? Datenquellen und
                    Datensatz gehören danach zu diesem Pool. Über ihn werden auch die
                    Zugriffsrechte vergeben.
                </p>
                {datapools.length === 0 ? (
                    <p className="rounded-lg border border-warn/40 bg-warn/5 px-4 py-3 text-sm leading-relaxed text-warn dark:bg-warn/15">
                        {datapoolProblem ??
                            'Auf dieser Instanz gibt es noch keinen Datenpool, den Sie lesen dürfen. Legen Sie im Portal einen an (Datenpools → Neu) und öffnen Sie diese Seite erneut.'}
                    </p>
                ) : (
                    <label className="flex flex-col gap-1 text-xs font-medium">
                        Datenpool
                        <select
                            value={datapoolId}
                            onChange={(event) => onDatapool(event.target.value)}
                            className="rounded-md border bg-background px-2 py-1.5 text-sm font-normal"
                        >
                            <option value="" disabled>
                                Bitte wählen …
                            </option>
                            {datapools.map((pool) => (
                                <option key={pool.id} value={pool.id}>
                                    {pool.name}
                                </option>
                            ))}
                        </select>
                        {selected?.description && (
                            <span className="font-normal text-muted-foreground">
                                {selected.description}
                            </span>
                        )}
                    </label>
                )}
            </div>

            <div className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                    Wie soll der Anwendungsfall nach der Installation stehen?
                </p>
                <OptionCard
                    selected={releaseMode === 'draft'}
                    onSelect={() => onReleaseMode('draft')}
                    title="Als Entwurf installieren"
                    description="Datenstrukturen und Datenquellen werden freigegeben, der Datensatz bleibt ein Entwurf. Seine Freigabe erfolgt anschließend im Portal (Datensatz → Freigeben)."
                />
                <OptionCard
                    selected={releaseMode === 'release'}
                    onSelect={() => onReleaseMode('release')}
                    title="Sofort freigeben"
                    description="Installiert und gibt in einem Schritt frei. Die Plattform richtet danach Speicher und Pipeline ein, dann fließen die Daten. Zurücknehmen lässt sich die Freigabe im Portal."
                />
            </div>
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
}: {
    displayName: string
    version: string
    mode: DataSourceMode
    brokerUrl: string
    datapoolName: string
    releaseMode: ReleaseMode
}) {
    return (
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
