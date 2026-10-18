'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Eye } from 'lucide-react'
import { exportAction, inspectExportSource, type ExportActionResult, type ExportIntent } from '@/lib/export-actions'
import type { ExportReadiness, ExportTarget } from '@/lib/export/config'
import type { ExportSource } from '@/lib/export/sources'
import { draftStart, draftStartedOn, draftStepAt, draftTime, type ShareDraft } from '@/lib/export/share-drafts'
import { sourceOptions } from '@/lib/export/source-options'
import { shareProgress, takenOutNotice } from '@/lib/export/share-stages'
import { mergeRequestRef, rememberShareResult, shareKey, takenOutOf, type ShareStates } from '@/lib/export/share-state'
import { draftMetadata, metadataDraft, METADATA_GROUPS, type MetadataDraft } from '@/lib/export/metadata'
import { slugify } from '@/lib/export/urn'
import { catalogEntryPath } from '@/lib/use-case-catalog/path'
import { useCaseSlugPattern } from '@/lib/catalog/schema'
import { THEME_LABELS, type Theme } from '@/lib/catalog/vocabulary'
import { DiscardDraftDialog } from '@/components/export/delete-share-dialog'
import { InProgress } from '@/components/export/in-progress'
import { MetadataForm } from '@/components/export/metadata-form'
import { PackageContents } from '@/components/export/package-contents'
import { ShareSteps } from '@/components/export/share-steps'
import { useShareDraftActions, useShareDrafts } from '@/components/export/use-share-drafts'
import { useSharedListing } from '@/components/export/use-shared-listing'
import { Button, ExternalAnchor } from '@/components/ui/button'
import { Disclosure } from '@/components/ui/disclosure'
import { EmptyState, Section } from '@/components/ui/layout'
import { InlineNotice, Notice, NoticeList, Pending } from '@/components/ui/notice'
import { resultTone } from '@/lib/export/result-tone'
import { Select } from '@/components/ui/select'

const inputClass = 'w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40'
const STEPS = ['Auswählen', 'Steckbrief ergänzen', 'Vorschau & Teilen']
/** The server's rules for the address fields (`parseForm`), so the fold-out can open when one is wrong. */
const SEGMENT = /^[a-z0-9]{2,40}$/
/** How the package kinds of the preview's identity table read on the page. */
const IDENTITY_KINDS: Record<string, string> = { datastructure: 'Datenstruktur', mapping: 'Mapping', datasource: 'Datenquelle', datasink: 'Datensenke' }
interface PanelProps {
    sources: ExportSource[]
    sourceNotice?: string
    targets: ExportTarget[]
    readiness: ExportReadiness
    /** Whether this person may have the bot open merge requests; previewing is open to all. */
    mayShare: boolean
    catalogUrl?: string
    defaults: { publisher: string; maintainer: string }
    /** Whose drafts these are (`draftOwnerTag`); drafts stay in this browser. None: no drafts at all. */
    draftOwner?: string
    /** Whether the bot's merge requests can be read here, for "In Arbeit". */
    canListShares: boolean
}
function Steps({ current }: { current: number }) {
    return <ol aria-label="Fortschritt" className="grid gap-2 sm:grid-cols-3">
        {STEPS.map((label, index) => <li key={label} aria-current={current === index + 1 ? 'step' : undefined}
            className={`rounded-lg border px-3 py-3 text-sm ${current === index + 1 ? 'border-primary bg-primary/5 font-semibold text-primary' : 'text-muted-foreground'}`}>
            <span className="mr-2">{index + 1}.</span>{label}
        </li>)}
    </ol>
}
/**
 * The three steps of sharing. „Auswählen“ holds the dropdown and, once a
 * dataset is chosen, what goes into its package, without a button in between
 * (plan of 2026-10-18); the editor below does the rest.
 *
 * The dropdown lives here and the package contents in the editor, which is
 * made anew for every dataset: so a new choice drops the old dataset's form
 * and its pending answer, and focus stays in the dropdown.
 */
export function ExportPanel(props: PanelProps) {
    const [selection, setSelection] = useState('')
    // The share being worked on, and the draft it continues, if it continues one. Unset while a chosen
    // dataset's started share waits for „Weitermachen“ or „Neu beginnen“. `run` tells two openings of one
    // dataset apart, so continuing a draft replaces the form that was open instead of keeping it.
    const [active, setActive] = useState<{ id: string; draft?: ShareDraft; run: number } | null>(null)
    const [step, setStep] = useState(1)
    // The started share offered for the chosen dataset, as it was when chosen: discarded meanwhile in another
    // tab, it stays on offer, so the choice does not end in an empty step without a button.
    const [offered, setOffered] = useState<ShareDraft>()
    // „Neu beginnen“ discards what was typed, so it asks first, like every „Verwerfen“ (decided 2026-10-18).
    const [restarting, setRestarting] = useState<ShareDraft>()
    const runs = useRef(0)
    const pickerHeading = useRef<HTMLHeadingElement>(null)
    const previousStep = useRef(step)
    const { drafts, discard } = useShareDrafts(props.draftOwner)
    // Read here, not in "In Arbeit": this panel stays while the form comes and goes.
    const shared = useSharedListing(props.canListShares)
    const source = active ? props.sources.find((row) => row.id === active.id) : undefined
    const current = source ? step : 1
    // Back from the Steckbrief, focus goes to this step's heading, as the editor does for its own steps.
    // Not on arrival and not after a choice: then it stays in the dropdown.
    useEffect(() => {
        if (current === 1 && previousStep.current > 1) {
            pickerHeading.current?.focus()
            pickerHeading.current?.scrollIntoView({ block: 'start' })
        }
        previousStep.current = current
    }, [current])
    const open = (id: string, draft?: ShareDraft) => {
        runs.current += 1
        setSelection(id)
        setActive({ id, draft, run: runs.current })
        setOffered(undefined)
        setStep(draft?.step ?? 1)
    }
    const choose = (id: string) => {
        // A started share is offered first; without one, the package contents load at once.
        const draft = drafts.find((entry) => entry.datasetId === id)
        if (draft) {
            setSelection(id)
            setActive(null)
            setOffered(draft)
        } else {
            open(id)
        }
    }
    const discardDraft = (id: string) => {
        discard(id)
        // The dataset on screen starts afresh: what it continued is gone.
        if (id === selection) open(id)
    }
    // Opened from a button that goes away with it (the started share's notice) or sits far above („In Arbeit“):
    // focus moves to this step's heading, not to the top of the page. On the Steckbrief the editor moves it on.
    const openFromButton = (id: string, draft?: ShareDraft) => {
        open(id, draft)
        pickerHeading.current?.focus()
    }
    const inProgress = <InProgress drafts={drafts} sources={props.sources} rows={shared.rows} error={shared.error}
        loaded={shared.loaded} onReload={shared.reload}
        onContinue={(draft) => openFromButton(draft.datasetId, draft)} onDiscard={discardDraft} />
    if (!props.sources.length) return <div className="flex flex-col gap-6">{inProgress}<EmptyState>Diese Instanz hat noch keinen Datensatz, den du lesen darfst.</EmptyState></div>
    const started = active ? undefined : drafts.find((draft) => draft.datasetId === selection) ?? offered
    return <div className="flex flex-col gap-6">
        {/* What was started and is not finished comes before starting anew: the start-or-resume screen. */}
        {current === 1 && inProgress}
        <Steps current={current} />
        {current === 1 && <section className="flex flex-col gap-4 rounded-xl border bg-card p-6">
            <h2 ref={pickerHeading} tabIndex={-1} className="scroll-mt-20 text-xl font-semibold focus:outline-none">Welchen Datensatz möchtest du teilen?</h2>
            {props.sourceNotice && <Notice tone="neutral">{props.sourceNotice}</Notice>}
            <label className="flex flex-col gap-2 text-sm">
                <span>Datensatz</span>
                <Select value={selection} onValueChange={choose} placeholder="Bitte auswählen …" options={sourceOptions(props.sources, drafts)} />
            </label>
            {started && (
                // Neutral: a fact about this dataset, and a choice, not a warning. Its primary stands in for „Weiter zum Steckbrief“.
                <Notice tone="neutral" title={`Für diesen Datensatz hast du am ${draftStartedOn(started)} angefangen.`}
                    action={<div className="flex flex-wrap gap-2">
                        <Button variant="primary" onClick={() => openFromButton(selection, started)}>Weitermachen</Button>
                        <Button onClick={() => setRestarting(started)}>Neu beginnen</Button>
                    </div>}>
                    Gespeichert in diesem Browser. „Neu beginnen“ verwirft deine bisherigen Angaben.
                </Notice>
            )}
            {/* Focus stays in the dropdown, so the offer appearing below it is said, as the package contents are. */}
            <p role="status" className="sr-only">{started ? `Für diesen Datensatz hast du am ${draftStartedOn(started)} angefangen.` : ''}</p>
            {restarting && <DiscardDraftDialog title={draftTitle(restarting)} draft={restarting} onCancel={() => setRestarting(undefined)}
                onConfirm={() => { setRestarting(undefined); discard(restarting.datasetId); openFromButton(restarting.datasetId) }} />}
        </section>}
        {active && source && <ExportEditor key={`${source.id}:${active.run}`} {...props} source={source} draft={active.draft}
            step={current} onStep={setStep} onProposed={shared.reload} onDiscarded={() => openFromButton(source.id)} />}
    </div>
}

/** The Steckbrief's basic fields, by the labels the server's messages use too (`parseForm`). */
const BASIC_FIELDS: { key: 'displayName' | 'maintainer' | 'license' | 'keywords'; label: string; hint?: string }[] = [
    { key: 'displayName', label: 'Name im Katalog *' },
    { key: 'maintainer', label: 'Herausgeber *' },
    { key: 'license', label: 'Lizenz *' },
    { key: 'keywords', label: 'Schlagworte', hint: 'Mit Komma trennen.' },
]

/** The address fields inside „Adresse ändern“: plain names, a hint with an example, the server's limits. */
const ADDRESS_FIELDS: { key: 'publisher' | 'slug' | 'domain'; label: string; hint: string }[] = [
    { key: 'publisher', label: 'Herausgeber-Kürzel *', hint: 'Steht vorn in der Adresse, zum Beispiel openurbanapps. 2 bis 40 Kleinbuchstaben oder Ziffern.' },
    { key: 'slug', label: 'Kurzname *', hint: 'Steht hinten in der Adresse, zum Beispiel baumkataster-mitte. 2 bis 60 Kleinbuchstaben, Ziffern oder Bindestriche, nicht am Anfang oder Ende.' },
    { key: 'domain', label: 'Fachgebiet *', hint: 'Auf Englisch, zum Beispiel environment, mobility oder general - es steht in den Kennungen der Bausteine. 2 bis 40 Kleinbuchstaben oder Ziffern.' },
]

/** The name a started share goes by: the name typed for the catalogue so far, else the dataset's. */
function draftTitle(draft: ShareDraft): string {
    return draft.basics.displayName?.trim() || draft.datasetName
}

/** A saved draft's form text over the defaults: fields added since the draft was saved start empty, not undefined. */
function restoreMetadata(saved: MetadataDraft, defaults: MetadataDraft): MetadataDraft {
    return { fields: { ...defaults.fields, ...saved.fields }, themes: saved.themes, media: saved.media }
}
/** A draft as saved now: the time of this save, and of the first one, which a new share sets here. */
function stamped(payload: ShareDraft, startedAt: { current: string | undefined }): ShareDraft {
    const at = new Date().toISOString()
    startedAt.current ??= at
    return { ...payload, savedAt: at, startedAt: startedAt.current }
}
function ExportEditor({ source, targets, readiness, mayShare, catalogUrl, defaults, draftOwner, draft, step, onStep, onProposed, onDiscarded }: PanelProps & {
    source: ExportSource
    draft?: ShareDraft
    /** The wizard's step, kept by the panel: „Auswählen“ (1) shows its dropdown above this. */
    step: number
    onStep: (step: number) => void
    /** A merge request was opened or found: "In Arbeit" should read GitLab again. */
    onProposed: () => void
    /** The started share was discarded: the panel starts this dataset afresh. */
    onDiscarded: () => void
}) {
    const stepHeading = useRef<HTMLHeadingElement>(null)
    useEffect(() => {
        // „Auswählen“ keeps focus in its dropdown while the package contents appear below it.
        if (step === 1) return
        stepHeading.current?.focus()
        stepHeading.current?.scrollIntoView({ block: 'start' })
    }, [step])
    const [inventory, setInventory] = useState<Awaited<ReturnType<typeof inspectExportSource>> | null>(null)
    const [inventoryAttempt, setInventoryAttempt] = useState(0)
    // Demo streams are taken along unless unticked, so a stream made in the meantime arrives ticked.
    const [demoExcluded, setDemoExcluded] = useState<ReadonlySet<string>>(() => new Set(draft?.demoExcluded ?? []))
    const [pending, startTransition] = useTransition()
    const [result, setResult] = useState<ExportActionResult | null>(null)
    const [preview, setPreview] = useState<ExportActionResult['preview']>()
    const catalog = source.catalog
    // The catalogue's own split, not a fourth regex for it: a looser pattern here
    // seeds a slug the server then rejects, and the author finds out on submit.
    const address = catalog ? catalogEntryPath(catalog.id) : undefined
    const nextVersion = catalog?.version.match(/^(\d+)\.(\d+)\.(\d+)$/)
    const [basics, setBasics] = useState(() => {
        const initial = {
            displayName: catalog?.displayName ?? source.name,
            description: catalog?.description ?? source.description ?? '',
            slug: address?.slug ?? slugify(source.name), publisher: address?.publisher ?? defaults.publisher,
            version: nextVersion ? `${nextVersion[1]}.${nextVersion[2]}.${Number(nextVersion[3]) + 1}` : '1.0.0',
            domain: 'general', maintainer: catalog?.maintainer ?? defaults.maintainer,
            license: catalog?.license ?? 'EUPL-1.2', keywords: catalog?.keywords.join(', ') ?? '',
        }
        // A draft fills in what it knows; a field it does not know keeps the default.
        for (const key of Object.keys(initial) as (keyof typeof initial)[]) {
            const saved = draft?.basics[key]
            if (typeof saved === 'string') initial[key] = saved
        }
        return initial
    })
    const [metadata, setMetadata] = useState(() =>
        draft ? restoreMetadata(draft.metadata, metadataDraft(catalog?.metadata)) : metadataDraft(catalog?.metadata))
    const [targetKey, setTargetKey] = useState(() =>
        draft && targets.some((target) => target.key === draft.targetKey) ? draft.targetKey : targets[0]?.key ?? '')
    // Saved as a draft once something was changed: only opening a dataset, or a draft, writes nothing,
    // so a draft keeps the time of its last real change.
    const [dirty, setDirty] = useState(false)
    const [savedAt, setSavedAt] = useState<string | undefined>(draft?.savedAt)
    // Whether this share is in the browser already, and since when: a new one is saved from the Steckbrief on (draftStepAt).
    const stored = useRef(draft !== undefined)
    const startedAt = useRef(draft ? draftStart(draft) : undefined)
    const [pendingIntent, setPendingIntent] = useState<ExportIntent>()
    // The started share „Verwerfen“ asks about, as it stood when the button was pressed.
    const [discarding, setDiscarding] = useState<Pick<ShareDraft, 'savedAt' | 'startedAt'>>()
    // „Adresse ändern“ stays folded while the prefilled address is fine, and opens by itself when it is not:
    // a required field must never be wrong or empty out of sight. Once edited it stays open, so fixing a
    // value does not fold it away mid-typing.
    const [addressOpen, setAddressOpen] = useState(false)
    const { save: saveDraft, discard: discardDraft } = useShareDraftActions(draftOwner)
    // The edits a pending save has not written yet; written at once when the page is left.
    const unsaved = useRef<ShareDraft | null>(null)
    const forgeReady = readiness === 'ready' && targets.length > 0 && mayShare
    // What is known about THIS version's merge requests, kept apart from the last result:
    // "Status prüfen" overwrites that and "Steckbrief bearbeiten" clears it (lib/export/share-state).
    // One entry per version, so previewing another version does not forget this one's merge request.
    const currentShareKey = shareKey({ ...basics, targetKey })
    const [shareStates, setShareStates] = useState<ShareStates>({})
    // Where this version stands is told by lib/export/share-stages, the same as in "In Arbeit" and "Geteilte Pakete".
    // The catalogue step needs the package on the base branch AND, by tree id, the merged one.
    const known = shareStates[currentShareKey] ?? {}
    // The catalogue team took this version or an earlier one out, as a GitLab reading of any version said: before anyone proposes more.
    const takenOutVersion = takenOutOf(shareStates, currentShareKey)
    const takenOut = takenOutVersion ? <Notice tone="neutral">{takenOutNotice(takenOutVersion)}</Notice> : undefined
    useEffect(() => {
        let cancelled = false
        inspectExportSource(source.id).then((value) => { if (!cancelled) setInventory(value) })
            // The notice around it already says what failed and offers "Erneut laden"; this names why.
            .catch(() => { if (!cancelled) setInventory({ artifacts: [], warnings: [], error: 'Die Anfrage an den Server ist fehlgeschlagen.' }) })
        return () => { cancelled = true }
    }, [source.id, inventoryAttempt])
    const run = (intent: ExportIntent) => startTransition(async () => {
        setPendingIntent(intent)
        // The version this request is about, even if the form changes while it runs.
        const requestKey = currentShareKey
        const data = new FormData()
        for (const [key, value] of Object.entries(basics)) data.set(key, value)
        data.set('datasetId', source.id)
        data.set('targetKey', targetKey)
        data.set('catalogMetadata', JSON.stringify(draftMetadata(metadata)))
        data.set('demoStreams', JSON.stringify(demoChosen))
        data.set('intent', intent)
        try {
            const next = await exportAction(null, data)
            setResult(next)
            setShareStates((previous) => rememberShareResult(previous, requestKey, next))
            if (next.preview) setPreview(next.preview)
            if (intent === 'preview' && next.status === 'ok') onStep(3)
            // From here on the merge request (or the repository) holds the content: the draft has done its job.
            const landed = next.status === 'ok' || next.status === 'already-open' || next.status === 'unchanged'
            if (intent === 'bundle' && landed) forgetDraft()
            if ((intent === 'bundle' || intent === 'catalog') && landed) onProposed()
        } catch {
            setResult({ intent, status: 'error', detail: 'Die Anfrage ist fehlgeschlagen. Bitte erneut versuchen.' })
        } finally {
            setPendingIntent(undefined)
        }
    })
    const forgetDraft = () => {
        unsaved.current = null
        stored.current = false
        startedAt.current = undefined
        discardDraft(source.id)
        setSavedAt(undefined)
        setDirty(false)
    }
    const editBasics = (key: keyof typeof basics, value: string) => {
        setBasics({ ...basics, [key]: value })
        setDirty(true)
        if (key === 'publisher' || key === 'slug' || key === 'domain') setAddressOpen(true)
    }
    const addressInvalid = !SEGMENT.test(basics.publisher.trim().toLowerCase()) || !useCaseSlugPattern.test(basics.slug.trim().toLowerCase())
        || !SEGMENT.test(basics.domain.trim().toLowerCase())
    // Where the use case would be found; the URN itself shows only in the preview's technical details. Valid values
    // read exactly as the catalogue spells its pages (catalogEntryHref), and wrong ones as typed: tidied up, an empty
    // Herausgeber-Kürzel would show an address that will never exist.
    const addressHref = `/use-cases/${basics.publisher.trim().toLowerCase()}/${basics.slug.trim().toLowerCase()}`
    const editMetadata = (next: MetadataDraft) => { setMetadata(next); setDirty(true) }
    const chooseTarget = (key: string) => { setTargetKey(key); setDirty(true) }
    // Saved shortly after the typing stops, without a button and without validation:
    // a draft may be incomplete (patterns for long forms, 2026-10-16).
    useEffect(() => {
        // Not for a demo stream unticked in „Auswählen“ alone: looking at a dataset starts no share.
        const resumeAt = draftStepAt(step, stored.current)
        if (!dirty || !resumeAt) return
        const payload: ShareDraft = {
            datasetId: source.id, datasetName: source.name, savedAt: '', step: resumeAt,
            basics, metadata, targetKey, demoExcluded: [...demoExcluded],
        }
        unsaved.current = payload
        const timer = window.setTimeout(() => {
            const saving = stamped(payload, startedAt)
            if (saveDraft(saving)) {
                stored.current = true
                setSavedAt(saving.savedAt)
            }
            unsaved.current = null
        }, 600)
        return () => window.clearTimeout(timer)
    }, [dirty, step, basics, metadata, targetKey, demoExcluded, source.id, source.name, saveDraft])
    // Leaving within that moment - another page, another dataset, closing the tab - writes the last edits at once.
    useEffect(() => {
        const flush = () => {
            if (!unsaved.current) return
            saveDraft(stamped(unsaved.current, startedAt))
            unsaved.current = null
        }
        window.addEventListener('pagehide', flush)
        return () => {
            window.removeEventListener('pagehide', flush)
            flush()
        }
    }, [saveDraft])
    // Only a request in flight can still be lost by closing the tab; everything typed is saved.
    useEffect(() => {
        if (!pending) return
        const warn = (event: BeforeUnloadEvent) => {
            event.preventDefault()
            // Older Safari and some embedded browsers show the dialog only with a return value.
            event.returnValue = ''
        }
        window.addEventListener('beforeunload', warn)
        return () => window.removeEventListener('beforeunload', warn)
    }, [pending])
    const reloadInventory = () => { setInventory(null); setInventoryAttempt((n) => n + 1) }
    // A source without a Topic cannot take its streams along (see DemoSource.problem), so they are never sent.
    const demoChosen = (inventory?.demo?.sources ?? []).filter((demoSource) => !demoSource.problem)
        .flatMap((demoSource) => demoSource.streams.map((stream) => stream.id)).filter((id) => !demoExcluded.has(id))
    const toggleDemo = (id: string) => {
        setDirty(true)
        setDemoExcluded((excluded) => {
            const next = new Set(excluded)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }
    // The package validator refuses a use case without a data structure of its own, so the
    // inventory says so before the author fills in the whole form - an empty inventory too,
    // since it has none either. Not while the inventory is loading or failed to load.
    const lacksStructure = !!inventory && !inventory.error && !inventory.artifacts.some((item) => item.type === 'structure')
    // A refused preview stays on the Steckbrief and never reaches the preview step, yet the export's
    // warnings there usually name the cause (a source without a structure, say), so they
    // are shown next to the errors - in place of the general answer, which would only
    // repeat that the check failed.
    const refused = step === 2 && result?.preview?.errors.length ? result.preview : undefined
    // Why a step of the task cannot be taken from here, in the person's words.
    const previewBlocker = preview?.errors.length ? 'Die Paketprüfung meldet Fehler - Details in der Vorschau unten.' : undefined
    const setupBlocker = readiness !== 'ready' || targets.length === 0
        ? 'Teilen ist auf dieser Instanz noch nicht eingerichtet - das richtet der Betrieb ein. Die Vorschau geht trotzdem.'
        : mayShare ? undefined : 'Einreichen darf hier nur, wer Datenstrukturen anlegen und Datensätze bearbeiten darf, zum Beispiel Data Owner, Data Architect oder Data Steward.'
    // To „Auswählen“, with this dataset still chosen and the form kept; the preview is made again from the Steckbrief.
    const backToChoice = () => { onStep(1); setResult(null); setPreview(undefined) }
    return <div className="flex flex-col gap-6">
        {step >= 2 && <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm"><span className="text-muted-foreground">Datensatz: </span><strong>{source.name}</strong></p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {/* Quiet proof that nothing is lost by leaving; the started share stays in this browser. */}
                {savedAt && <span className="text-xs text-muted-foreground">Zwischenstand gespeichert, {draftTime(savedAt)} ·{' '}
                    <Button variant="ghost" className="text-xs" disabled={pending} onClick={() => setDiscarding({ savedAt, startedAt: startedAt.current })}>Verwerfen</Button></span>}
                {/* In the Steckbrief the same move is its footer's secondary button. */}
                {step === 3 && <Button variant="ghost" disabled={pending} onClick={backToChoice}>Zurück zur Auswahl</Button>}
            </div>
        </div>}
        {/* Asked first: what was typed lives only in this browser. Afterwards the dataset starts afresh at „Auswählen“. */}
        {discarding && <DiscardDraftDialog title={basics.displayName.trim() || source.name} draft={discarding}
            onCancel={() => setDiscarding(undefined)} onConfirm={() => { setDiscarding(undefined); forgetDraft(); onDiscarded() }} />}
        {step === 1 && <Section title="Was kommt ins Paket?"
            lead={<>Das gehört zum Datensatz „{source.name}“ - in der Reihenfolge, in der die Daten fließen.</>}>
            {!inventory ? <Pending>Inhalt wird gelesen …</Pending>
                : inventory.error ? <Notice tone="error" title="Der Inhalt ließ sich nicht lesen" live action={<Button onClick={reloadInventory}>Erneut laden</Button>}>{inventory.error}</Notice>
                : <>
                    <PackageContents source={source} artifacts={inventory.artifacts} demo={inventory.demo}
                        demoExcluded={demoExcluded} onToggleDemo={toggleDemo} onReloadDemo={reloadInventory} />
                    {lacksStructure && <Notice tone="warn" title="Es fehlt eine eigene Datenstruktur">Ohne eigene Datenstruktur lässt sich das Paket nicht teilen - die Paketprüfung verlangt mindestens eine.</Notice>}
                    {!!inventory.warnings.length && <Notice tone="warn" title="Hinweise zum Inhalt"><NoticeList items={inventory.warnings} /></Notice>}
                    <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs text-muted-foreground">Nicht im Paket: gespeicherte Daten, der Datenpool und Zugangsdaten.</p>
                        {/* Blocked rather than refused later: the package check would turn it down after the whole form (Ewa's plan, 2026-10-13). */}
                        <div className="flex flex-wrap items-center gap-3">
                            {lacksStructure && <InlineNotice tone="warn" id="steckbrief-gesperrt">Geht erst mit einer eigenen Datenstruktur.</InlineNotice>}
                            <Button variant="primary" disabled={lacksStructure} aria-describedby={lacksStructure ? 'steckbrief-gesperrt' : undefined} onClick={() => onStep(2)}>Weiter zum Steckbrief</Button>
                        </div>
                    </div>
                </>}
        </Section>}
        {/* Focus stays in the dropdown, so the contents arriving below it are said, not jumped to. */}
        {step === 1 && <p role="status" className="sr-only">{inventory && !inventory.error ? `Inhalt von „${source.name}“ gelesen` : ''}</p>}
        {step === 2 && <form className="flex flex-col gap-6" onSubmit={(event) => { event.preventDefault(); run('preview') }}>
            <div><h2 ref={stepHeading} tabIndex={-1} className="scroll-mt-20 text-xl font-semibold focus:outline-none">Steckbrief ergänzen</h2><p className="mt-1 text-sm text-muted-foreground">Pflichtfelder sind mit * markiert. Weitere Angaben kannst du ergänzen, soweit sie bekannt sind.</p>
                <div className="mt-3 flex flex-col gap-2 empty:hidden">
                    {source.notice && <Notice tone="neutral">{source.notice}</Notice>}
                    {/* A second merge request for the same package next to an open one would compete with it, so the advice differs per state. */}
                    {known.bundle?.state === 'mr-open' && <Notice tone="neutral">Für Version {basics.version} ist schon ein Vorschlag in Prüfung{mergeRequestRef(known.bundle.mrUrl) ? ` (${mergeRequestRef(known.bundle.mrUrl)})` : ''}. Er enthält den vorherigen Stand - Änderungen gehen erst, wenn er angenommen oder zurückgezogen ist, dann mit einer neuen Version.</Notice>}
                    {known.bundle?.state === 'on-base' && <Notice tone="neutral">Version {basics.version} ist schon angenommen. Änderungen am Steckbrief gehen jetzt nur noch mit einer neuen Version.</Notice>}
                    {takenOut}
                </div></div>
            <fieldset disabled={pending} className="flex flex-col gap-6 disabled:opacity-60">
                <section className="grid gap-4 rounded-xl border bg-card p-5 md:grid-cols-2">
                    <h3 className="font-semibold md:col-span-2">Grundangaben</h3>
                    {BASIC_FIELDS.map(({ key, label, hint }) =>
                        <label key={key} className="flex flex-col gap-1 text-sm"><span>{label}</span><input className={inputClass} value={basics[key]} required={key !== 'keywords'} onChange={(event) => editBasics(key, event.target.value)} />
                            {hint && <span className="text-xs text-muted-foreground">{hint}</span>}</label>)}
                    <label className="flex flex-col gap-1 text-sm md:col-span-2"><span>Kurzbeschreibung *</span><textarea rows={4} className={inputClass} value={basics.description} required onChange={(event) => editBasics('description', event.target.value)} /></label>
                </section>
                <MetadataForm value={metadata} onChange={editMetadata} />
                <section className="grid gap-4 rounded-xl border bg-card p-5 md:grid-cols-2">
                    <h3 className="font-semibold md:col-span-2">Adresse und Version im Katalog</h3>
                    <p className="text-sm text-muted-foreground md:col-span-2">{catalog ? 'Die nächste Version ist vorgeschlagen. Für eine eigenständige Variante kannst du die Adresse ändern.' : 'Die Adresse ist aus dem Namen des Datensatzes gebildet. Ändern musst du sie nur, wenn sie anders lauten soll.'}</p>
                    <label className="flex flex-col gap-1 text-sm"><span>Version *</span><input className={inputClass} value={basics.version} required onChange={(event) => editBasics('version', event.target.value)} />
                        <span className="text-xs text-muted-foreground">Drei Zahlen mit Punkt, zum Beispiel 1.0.0. Eine neue Version muss höher sein als die letzte.</span></label>
                    <p className="text-sm md:col-span-2"><span className="text-muted-foreground">Adresse im Katalog: </span><span className="break-all">{addressHref}</span></p>
                    {/* Prefilled and rarely changed, so folded - but never while one of them is wrong or empty. */}
                    <Disclosure className="md:col-span-2" summary="Adresse ändern" open={addressOpen || addressInvalid} onOpenChange={setAddressOpen}>
                        <div className="grid gap-4 md:grid-cols-2">
                            {ADDRESS_FIELDS.map(({ key, label, hint }) =>
                                <label key={key} className="flex flex-col gap-1 text-sm"><span>{label}</span><input className={inputClass} value={basics[key]} required onChange={(event) => editBasics(key, event.target.value)} /><span className="text-xs text-muted-foreground">{hint}</span></label>)}
                        </div>
                    </Disclosure>
                    <label className="flex flex-col gap-1 text-sm md:col-span-2"><span>Ablageort</span><Select value={targetKey} onValueChange={chooseTarget} disabled={!targets.length} placeholder="Nicht eingerichtet - die Vorschau geht trotzdem"
                        options={targets.map((target) => ({ value: target.key, label: target.label }))} />
                        <span className="text-xs text-muted-foreground">Wo das Paket bei GitLab abgelegt wird.</span></label>
                </section>
                {/* The answer belongs to this step's form: back in „Auswählen“ it would describe a form no longer shown. */}
                {/* A continued draft starts here, before the inventory arrived - or without it, when reading it failed.
                    The preview needs its demo streams, so it waits for the inventory instead of going without them. */}
                {inventory?.error && <InlineNotice tone="warn" id="inhalt-fehlt">Der Inhalt ließ sich nicht lesen ({inventory.error}). Ohne ihn fehlen dem Paket die Demo-Daten - bitte erst neu laden.</InlineNotice>}
                <div className="flex flex-wrap gap-2"><Button onClick={backToChoice}>Zurück zur Auswahl</Button>
                    {inventory?.error && <Button onClick={reloadInventory}>Inhalt neu laden</Button>}
                    <Button type="submit" variant="primary" icon={Eye} pending={pending || !inventory} disabled={Boolean(inventory?.error)}
                        aria-describedby={inventory?.error ? 'inhalt-fehlt' : undefined}>Vorschau erstellen</Button></div>
            </fieldset>
        </form>}
        {step === 3 && preview && <>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h2 ref={stepHeading} tabIndex={-1} className="scroll-mt-20 text-xl font-semibold focus:outline-none">Vorschau & Teilen</h2><p className="mt-1 text-sm text-muted-foreground">Prüfe Steckbrief und Paket. Nach dem Einreichen prüft das Katalog-Team zweimal: erst das Paket, dann den Katalog-Eintrag, den du dazwischen vorschlägst.</p></div>
                <Button variant="ghost" disabled={pending} onClick={() => { onStep(2); setResult(null); setPreview(undefined) }}>Steckbrief bearbeiten</Button>
            </div>
            {takenOut}
            {/* The one action first, not under all the previews (Ewa's point 8). */}
            <ShareSteps
                progress={shareProgress({ version: basics.version, bundle: known.bundle, catalog: known.catalog })}
                pendingIntent={pending && (pendingIntent === 'bundle' || pendingIntent === 'status' || pendingIntent === 'catalog') ? pendingIntent : undefined}
                busy={pending}
                proposeBlocker={previewBlocker ?? setupBlocker}
                catalogBlocker={previewBlocker ?? setupBlocker ?? (catalogUrl ? undefined : 'Der Katalog ist auf dieser Instanz noch nicht eingerichtet - das richtet der Betrieb ein.')}
                canCheck={forgeReady}
                bundleMrUrl={known.bundle?.mrUrl}
                catalogMrUrl={known.catalog?.mrUrl}
                removalMrUrl={known.bundle?.removal?.mrUrl}
                onPropose={() => run('bundle')}
                onCheck={() => run('status')}
                onCatalog={() => run('catalog')}
            />
            {/* The answer to the last action, under the task it answers. */}
            {result && <Notice tone={resultTone(result.status)} live
                action={result.mrUrl && result.mrUrl !== known.bundle?.mrUrl && result.mrUrl !== known.catalog?.mrUrl ? <ExternalAnchor href={result.mrUrl}>In GitLab ansehen</ExternalAnchor> : undefined}>
                <p className="whitespace-pre-wrap">{result.detail}</p>
            </Notice>}
            <section className="rounded-xl border bg-card p-5">
                <h3 className="text-lg font-semibold">{basics.displayName}</h3><p className="mt-2 whitespace-pre-wrap text-sm">{basics.description}</p>
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">{([['Herausgeber', basics.maintainer], ['Lizenz', basics.license], ['Schlagworte', basics.keywords], ['Version', basics.version],
                    ['Adresse im Katalog', addressHref], ['Fachgebiet', basics.domain]] as const).map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="break-words">{value || 'Keine Angabe'}</dd></div>)}</dl>
                <div className="mt-5"><MetadataReview metadata={metadata} /></div>
            </section>
            <Preview preview={preview} />
        </>}
        {pending && step !== 3 && <Pending>Anfrage wird verarbeitet …</Pending>}
        {/* Not twice: once a step shows its merge request, the answer does not repeat the link. */}
        {result && !refused && step !== 3 && <Notice tone={resultTone(result.status)} live
            action={result.mrUrl && result.mrUrl !== known.bundle?.mrUrl && result.mrUrl !== known.catalog?.mrUrl ? <ExternalAnchor href={result.mrUrl}>In GitLab ansehen</ExternalAnchor> : undefined}>
            <p className="whitespace-pre-wrap">{result.detail}</p>
        </Notice>}
        {refused && <div className="flex flex-col gap-3">
            <Notice tone="error" live title={`Das Paket würde die Paketprüfung nicht bestehen (${refused.errors.length} Fehler)`}><NoticeList items={refused.errors} /></Notice>
            {!!refused.warnings.length && <Notice tone="warn" title="Hinweise zum Paket"><NoticeList items={refused.warnings} /></Notice>}
        </div>}
    </div>
}

function Preview({ preview }: { preview: NonNullable<ExportActionResult['preview']> }) {
    return (
        <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-medium text-foreground">{preview.manifest.displayName}</span>
                <span className="rounded bg-status-label px-1.5 py-0.5 text-xs">v{preview.manifest.version}</span>
            </div>
            {/* For whoever reviews or operates it: the identifiers GitLab and the catalogue use. */}
            <Disclosure summary="Technische Angaben">
                <dl className="grid gap-1 text-xs text-muted-foreground">
                    <div><dt className="inline">Kennung im Katalog: </dt><dd className="inline break-all font-mono">{preview.manifest.id}</dd></div>
                    <div><dt className="inline">Ordner im Ablageort: </dt><dd className="inline break-all font-mono">{preview.packageDir}/</dd></div>
                    <div><dt className="inline">Zweig bei GitLab: </dt><dd className="inline break-all font-mono">{preview.branch}</dd></div>
                </dl>
            </Disclosure>

            <p className="text-sm">
                {preview.demo.streams
                    ? `Demo-Daten: ${preview.demo.streams === 1 ? 'ein Datenstrom' : `${preview.demo.streams} Datenströme`} aus dem Simulator. Eine Installation startet sie für ihre eigenen Datenquellen.`
                    : 'Das Paket bringt keine Demo-Daten mit. Nach der Installation fließen erst Daten, wenn eine echte Quelle angebunden ist.'}
            </p>

            {preview.errors.length > 0 && (
                <Notice tone="error" title="Das Paket würde die Paketprüfung nicht bestehen"><NoticeList items={preview.errors} /></Notice>
            )}
            {preview.warnings.length > 0 && <Notice tone="warn" title="Hinweise zum Paket"><NoticeList items={preview.warnings} /></Notice>}

            <div className="overflow-x-auto">
                <table className="w-full min-w-[32rem] text-xs">
                    <thead className="border-b text-left uppercase tracking-wide text-muted-foreground">
                        <tr>
                            <th className="px-2 py-1 font-medium">Datei</th>
                            <th className="px-2 py-1 text-right font-medium">Bytes</th>
                        </tr>
                    </thead>
                    <tbody>
                        {preview.files.map((file) => (
                            <tr key={file.path} className="border-b last:border-0">
                                <td className="break-all px-2 py-1 font-mono text-foreground">{file.path}</td>
                                <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{file.bytes}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-xs">
                    <thead className="border-b text-left uppercase tracking-wide text-muted-foreground">
                        <tr>
                            <th className="px-2 py-1 font-medium">Baustein</th>
                            <th className="px-2 py-1 font-medium">Kennung im Paket</th>
                            <th className="px-2 py-1 font-medium">Herkunft</th>
                        </tr>
                    </thead>
                    <tbody>
                        {preview.identities.map((identity) => (
                            <tr key={`${identity.kind}-${identity.to}`} className="border-b last:border-0">
                                <td className="px-2 py-1 text-foreground">
                                    {identity.title} <span className="text-muted-foreground">({IDENTITY_KINDS[identity.kind] ?? identity.kind})</span>
                                </td>
                                <td className="break-all px-2 py-1 font-mono text-muted-foreground">{identity.to}</td>
                                <td className="px-2 py-1 text-muted-foreground">
                                    {identity.kept ? 'aus dem Katalog, unverändert' : 'neu vergeben'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <List
                title="Entfernte Zugangsdaten"
                items={
                    preview.stripped.length
                        ? [...new Set(preview.stripped.map((s) => `${s.file}: ${s.field} (${s.reason})`))]
                        : ['keine - das Paket enthielt keine Zugangsdaten']
                }
            />
            <List
                title="Wird bei der Installation abgefragt"
                items={
                    preview.parameters.length
                        ? preview.parameters.map((p) => `${p.file}: ${p.fields.join(', ')}`)
                        : ['keine']
                }
            />
        </div>
    )
}

/** A plain list of facts in the preview; messages use `Notice`. */
function List({ title, items }: { title: string; items: string[] }) {
    return (
        <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
            <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                {items.map((item) => (
                    <li key={item} className="break-all">
                        {item}
                    </li>
                ))}
            </ul>
        </div>
    )
}

function MetadataReview({ metadata }: { metadata: MetadataDraft }) {
    return <dl className="grid gap-4 text-sm sm:grid-cols-2">
        {!!metadata.themes.length && <div className="sm:col-span-2"><dt className="text-muted-foreground">Themengebiete</dt><dd>{metadata.themes.map((theme) => THEME_LABELS[theme as Theme]).join(', ')}</dd></div>}
        {METADATA_GROUPS.flatMap((group) => group.fields).filter((field) => metadata.fields[field.path]?.trim()).map((field) =>
            <div key={field.path}><dt className="text-muted-foreground">{field.label}</dt><dd className="whitespace-pre-wrap break-words">{field.options?.[metadata.fields[field.path]] ?? metadata.fields[field.path]}</dd></div>)}
        {metadata.media.map((item, index) => <div key={index} className="sm:col-span-2"><dt className="text-muted-foreground">Bild {index + 1}</dt><dd className="break-all">{item.src}</dd><dd>{item.alt}</dd>{item.caption && <dd className="text-muted-foreground">{item.caption}</dd>}</div>)}
    </dl>
}
