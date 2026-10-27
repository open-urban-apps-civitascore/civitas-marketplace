'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Eye } from 'lucide-react'
import { exportAction, inspectExportSource, type ExportActionResult, type ExportIntent } from '@/lib/export-actions'
import { FILL_REQUEST_FAILED, requestNewVersionFill } from '@/lib/export/fill-request'
import type { NewVersionFill } from '@/lib/export/new-version-fill'
import type { ExportReadiness, ExportTarget } from '@/lib/export/config'
import type { ExportSource } from '@/lib/export/sources'
import { draftStart, draftStartedOn, draftStepAt, draftTime, type ShareDraft } from '@/lib/export/share-drafts'
import { busyOptions, sourceOptions, type ListingState } from '@/lib/export/source-options'
import { reasonWords, removalDeclineShown } from '@/lib/export/declines'
import {
    asksWhatChanged,
    BUSY_BLOCKER,
    busyBeside,
    CHANGE_NOTE_MAX,
    declineIsNews,
    changeNoteProblem,
    filledNotice,
    followedDecline,
    followsRefOf,
    nameTakenIn,
    sharedPackageOf,
    stageNotice,
    startingBasics,
    suggestedVersion,
    unfilledNotice,
    whatChangedLead,
    whatChangedRefusal,
    wizardStart,
    type FollowedDecline,
    type ListingFacts,
    type SteckbriefBasics,
} from '@/lib/export/new-version'
import { reviewChangeNotice, shareProgress, takenOutNotice } from '@/lib/export/share-stages'
import { mergeRequestRef, rememberShareResult, reviewChangeBelow, shareKey, takenOutOf, type ShareStates } from '@/lib/export/share-state'
import { draftMetadata, metadataDraft, METADATA_GROUPS, type MetadataDraft } from '@/lib/export/metadata'
import { reachableStep, type WizardStep } from '@/lib/export/wizard-address'
import { useCaseSlugPattern } from '@/lib/catalog/use-case-id'
import { THEME_LABELS, type Theme } from '@/lib/catalog/vocabulary'
import { DiscardDraftDialog } from '@/components/export/delete-share-dialog'
import { MetadataForm } from '@/components/export/metadata-form'
import { PackageContents } from '@/components/export/package-contents'
import { ShareSteps } from '@/components/export/share-steps'
import { BusySentence, InProgressLink, ListingLine, StageNoticeView } from '@/components/export/source-picker'
import { useShareListingReload, useShareView } from '@/components/export/share-listing-provider'
import { useShareDraftActions, useShareDrafts } from '@/components/export/use-share-drafts'
import { useWizardAddress } from '@/components/export/use-wizard-address'
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
}
function Steps({ current }: { current: number }) {
    return <ol aria-label="Fortschritt" className="grid gap-2 sm:grid-cols-3">
        {STEPS.map((label, index) => <li key={label} aria-current={current === index + 1 ? 'step' : undefined}
            className={`rounded-lg border px-3 py-3 text-sm ${current === index + 1 ? 'border-primary bg-primary/5 font-semibold text-primary' : 'text-muted-foreground'}`}>
            <span className="mr-2">{index + 1}.</span>{label}
        </li>)}
    </ol>
}
/** Without the right to submit nothing is read, so nothing is greyed out. */
const NOTHING_READ: ListingState = { state: 'read', rows: [], busy: new Map() }

/** The share listing as „Auswählen“ uses it: still asked, failed, or read. */
function listingStateOf(enabled: boolean, view: ReturnType<typeof useShareView>): ListingState {
    if (!enabled) return NOTHING_READ
    if (view.rows === null) return { state: 'loading' }
    if (view.error) return { state: 'failed' }
    return { state: 'read', rows: view.rows, busy: view.tabs.busy, ...(view.instance ? { instance: view.instance } : {}) }
}

/** The shared version a new Steckbrief is filled from, and the answer. */
interface FillState {
    from: string
    /** Absent while it is asked. */
    answer?: NewVersionFill
}

/** What the address's dataset has open on the page: its form, or the question whether to continue its started share. */
interface Opened {
    id: string
    /** Tells two openings of one dataset apart, so continuing or discarding a started share makes a fresh form. */
    run: number
    /** The started share the form continues. */
    draft?: ShareDraft
    /** A started share offered for the dataset, until „Weitermachen“ or „Neu beginnen“: no form meanwhile. */
    offer?: ShareDraft
    /** The furthest step this opening went to through the wizard's buttons: the preview opens again once it was made here. */
    reached: WizardStep
    /** Discarded at a later step: the form starts afresh once the address is back at „Auswählen“. */
    restarting?: boolean
}
/**
 * The three steps of sharing, on their own page (/export/new). „Auswählen“
 * holds the dropdown and, once a dataset is chosen, what goes into its
 * package, without a button in between (plan of 2026-10-18); the editor
 * below does the rest.
 *
 * Each step is an address (`lib/export/wizard-address.ts`), and the address
 * is the only record of where the person is: browser back goes one step
 * back, a reload stays on the step, and the buttons move the address rather
 * than keep a step of their own. An address that asks for a step the person
 * may not be on yet opens the furthest one allowed. Steps never re-run the
 * page's reads of the portal (`use-wizard-address.ts`).
 *
 * The dropdown lives here and the package contents in the editor, which is
 * made anew for every dataset: so a new choice drops the old dataset's form
 * and its pending answer, and focus stays in the dropdown. Moving between the
 * steps of one dataset keeps its form.
 *
 * From the share listing, a dataset with something in „In Arbeit“ is greyed
 * out and the others say where they stand; the Steckbrief starts from the
 * newest shared version of the package, and after a "no" asks what changed.
 */
export function ExportPanel(props: PanelProps) {
    const { address, forward, replace, back } = useWizardAddress()
    const { drafts, ready, discard } = useShareDrafts(props.draftOwner)
    const reloadListing = useShareListingReload()
    const [opened, setOpened] = useState<Opened | null>(null)
    // „Neu beginnen“ discards what was typed, so it asks first, like every „Verwerfen“ (decided 2026-10-18).
    const [restarting, setRestarting] = useState<ShareDraft>()
    const pickerHeading = useRef<HTMLHeadingElement>(null)
    const source = address.datasetId ? props.sources.find((row) => row.id === address.datasetId) : undefined
    // Kept on every step the wizard moves to, so a reload fills the Steckbrief the same way.
    const from = address.from
    const carry = from ? { from } : {}
    // The share pages' listing, read only where the person may submit.
    const forgeReady = props.readiness === 'ready' && props.targets.length > 0 && props.mayShare
    const view = useShareView(forgeReady)
    const listing = listingStateOf(forgeReady, view)
    const facts: ListingFacts | undefined = listing.state === 'read' ? listing : undefined

    // The address's dataset is opened once this browser's started shares are known: before, a reload would
    // start a fresh form in place of the saved one. A started share is offered first when the dataset was only
    // chosen; from the Steckbrief on, or once the person chose to go on (`resume`), it is continued.
    const wanted = ready ? source?.id : undefined
    if (ready && opened?.id !== wanted) {
        const run = (opened?.run ?? 0) + 1
        const draft = wanted ? drafts.find((entry) => entry.datasetId === wanted) : undefined
        setOpened(!wanted ? null : draft && address.step === 1 && !address.resume ? { id: wanted, run, offer: draft, reached: 1 }
            : { id: wanted, run, draft, reached: 1 })
    }
    if (opened?.restarting && address.step === 1) setOpened({ ...opened, restarting: false })

    const hasDraft = drafts.some((entry) => entry.datasetId === source?.id)
    // A busy dataset shows no content and no button at „Auswählen“, but a later step (reached by a link or a race)
    // stays open: the server refuses on submit.
    const start = source ? wizardStart(source, facts, { started: hasDraft, ...(from ? { from } : {}) }, props.targets.map((target) => target.key)) : {}
    const stage = start.stage
    const blocked = stage?.kind === 'busy'
    const notice = source && stage ? stageNotice(stage, source.name) : undefined
    const current: WizardStep = !source ? 1 : opened?.restarting ? 1
        : reachableStep(address.step, { datasetKnown: true, steckbrief: hasDraft || (opened?.reached ?? 1) >= 3 })
    const editing = opened && !opened.offer && opened.id === source?.id && !opened.restarting ? opened : undefined
    // Asked only once the dataset's content is read, so the content comes first; not for a continued share, which fills in its own.
    const [contentRead, setContentRead] = useState<string>()
    const continued = opened?.id === source?.id && opened?.draft !== undefined
    const fillWanted = start.fill && forgeReady && !continued && (contentRead === source?.id || current > 1) ? start.fill : undefined
    const { targetKey: fillTarget, slug: fillSlug, version: fillVersion } = fillWanted ?? {}
    const fillKey = fillTarget && fillSlug && fillVersion ? `${fillTarget}|${fillSlug}|${fillVersion}` : undefined
    const [fills, setFills] = useState<Readonly<Record<string, NewVersionFill>>>({})
    const answered = fillKey ? fills[fillKey] : undefined
    useEffect(() => {
        if (!fillKey || answered || !fillTarget || !fillSlug || !fillVersion) return
        // A route, not a server action: it holds up no other action, and a new choice cancels it.
        const request = new AbortController()
        requestNewVersionFill({ targetKey: fillTarget, slug: fillSlug, version: fillVersion }, request.signal)
            .then((answer) => {
                if (!request.signal.aborted) setFills((known) => ({ ...known, [fillKey]: answer }))
            })
            .catch(() => {
                if (!request.signal.aborted) setFills((known) => ({ ...known, [fillKey]: { status: 'error', detail: FILL_REQUEST_FAILED } }))
            })
        return () => request.abort()
    }, [fillKey, answered, fillTarget, fillSlug, fillVersion])
    const fill: FillState | undefined = fillVersion && fillKey ? { from: fillVersion, ...(answered ? { answer: answered } : {}) } : undefined

    // An address for a step not open to the person yet becomes the step they are on, so the address tells the truth:
    // a dataset not offered here, or a later step without any dataset, is „Auswählen“ with nothing chosen.
    useEffect(() => {
        if (!ready || opened?.restarting) return
        if (!source) {
            // A link whose dataset is gone keeps its version: the person chooses another dataset for it.
            if (address.datasetId || address.step > 1) replace({ step: 1, ...(address.from ? { from: address.from } : {}) })
        } else if (current < address.step) replace({ datasetId: source.id, step: current, resume: true, ...(address.from ? { from: address.from } : {}) })
    }, [ready, opened?.restarting, address, source, current, replace])

    // Back at „Auswählen“, focus goes to this step's heading, as the editor does for its own steps.
    // Not on arrival and not after a choice: then it stays in the dropdown.
    const previousStep = useRef(current)
    useEffect(() => {
        if (current === 1 && previousStep.current > 1) {
            pickerHeading.current?.focus()
            pickerHeading.current?.scrollIntoView({ block: 'start' })
        }
        previousStep.current = current
    }, [current])
    // A listing answering after the choice may make the dataset busy and take the focused button away: focus then goes
    // to this step's heading, not to the top of the page.
    useEffect(() => {
        if (blocked && current === 1 && (!document.activeElement || document.activeElement === document.body)) pickerHeading.current?.focus()
    }, [blocked, current])

    /** Forward by a new history entry, back through history: the browser's buttons then go the same way. */
    const go = (step: WizardStep) => {
        if (!source) return
        // Recorded also when the step is the one shown: a preview made again for an address (a reload, a link)
        // reports here, and the preview must stay open once submitting forgets the started share it relied on.
        setOpened((previous) => (previous && step > previous.reached ? { ...previous, reached: step } : previous))
        if (step === current) return
        if (step < current) {
            // `resume`: entered at a later step, back replaces the address, and at „Auswählen“ it continues what is started.
            back({ datasetId: source.id, step, resume: true, ...carry })
            return
        }
        // Coming back to „Auswählen“ later continues what is started from here on, rather than asking.
        if (current === 1) replace({ datasetId: source.id, step: 1, resume: true, ...carry })
        forward({ datasetId: source.id, step, ...carry })
    }
    // Where the editor finds out the step cannot be had (no data structure, a preview that failed): the step it can.
    const fallBack = (step: WizardStep) => {
        if (source && step < current) replace({ datasetId: source.id, step, resume: true, ...carry })
    }
    // A link's version goes only with the first choice, where the link named no dataset. Failed fills are asked again on
    // the next choice; the others are kept for the visit.
    const choose = (id: string) => {
        setFills((known) => Object.fromEntries(Object.entries(known).filter(([, answer]) => answer.status !== 'error')))
        replace({ datasetId: id, step: 1, ...(address.datasetId ? {} : carry) })
    }
    const continueDraft = (draft: ShareDraft) => {
        setOpened((previous) => ({ id: draft.datasetId, run: (previous?.run ?? 0) + 1, draft, reached: 1 }))
        replace({ datasetId: draft.datasetId, step: 1, resume: true, ...carry })
        if (draft.step === 2) forward({ datasetId: draft.datasetId, step: 2, ...carry })
        // The notice and its button go away: focus moves to this step's heading, not to the top of the page.
        else pickerHeading.current?.focus()
    }
    const startAfresh = (id: string) => {
        setOpened((previous) => ({ id, run: (previous?.run ?? 0) + 1, reached: 1, ...(current > 1 ? { restarting: true } : {}) }))
        if (current > 1) back({ datasetId: id, step: 1, ...carry })
        else pickerHeading.current?.focus()
    }
    const options = sourceOptions(props.sources, drafts, listing, { datasetId: address.datasetId, ...(from ? { from } : {}) })

    if (!props.sources.length) return <EmptyState>Diese Instanz hat noch keinen Datensatz, den du lesen darfst.</EmptyState>
    // Until this browser was read, a named dataset waits: what opens depends on its started share.
    if (address.datasetId && !ready) return <Steps current={source ? address.step : 1} />
    // Busy, the started share is not offered either: the notice points to „In Arbeit“.
    const started = opened?.offer && !blocked ? drafts.find((draft) => draft.datasetId === opened.id) ?? opened.offer : undefined
    const startedLine = started ? `Für diesen Datensatz hast du am ${draftStartedOn(started)} angefangen.` : undefined
    return <div className="flex flex-col gap-6">
        <Steps current={current} />
        {current === 1 && <section className="flex flex-col gap-4 rounded-xl border bg-card p-6">
            <div className="flex flex-col gap-1">
                <h2 ref={pickerHeading} tabIndex={-1} className="scroll-mt-20 text-xl font-semibold focus:outline-none">Welchen Datensatz möchtest du teilen?</h2>
                {/* A link whose dataset is not here: its version waits for the choice. */}
                {from && !source && <p className="text-sm text-muted-foreground">Wähle den Datensatz, aus dem die neue Version entstehen soll.</p>}
            </div>
            {props.sourceNotice && <Notice tone="neutral">{props.sourceNotice}</Notice>}
            <div className="flex flex-col gap-2">
                <label className="flex flex-col gap-2 text-sm">
                    <span>Datensatz</span>
                    <Select value={source?.id ?? ''} onValueChange={choose} placeholder="Bitte auswählen …" options={options} />
                </label>
                {/* Nothing waits for the listing: the server checks again on submit. */}
                <ListingLine listing={listing} />
            </div>
            <BusySentence options={busyOptions(options)} />
            {notice && <StageNoticeView notice={notice} />}
            {started && (
                // Neutral: a fact about this dataset, and a choice, not a warning. Its primary stands in for „Weiter zum Steckbrief“.
                <Notice tone="neutral" title={`Für diesen Datensatz hast du am ${draftStartedOn(started)} angefangen.`}
                    action={<div className="flex flex-wrap gap-2">
                        <Button variant="primary" onClick={() => continueDraft(started)}>Weitermachen</Button>
                        <Button onClick={() => setRestarting(started)}>Neu beginnen</Button>
                    </div>}>
                    Gespeichert in diesem Browser. „Neu beginnen“ verwirft deine bisherigen Angaben.
                </Notice>
            )}
            {/* Focus stays in the dropdown, so what appears below it is announced. */}
            <p role="status" className="sr-only">{[notice?.text, startedLine].filter(Boolean).join(' ')}</p>
            {restarting && <DiscardDraftDialog title={draftTitle(restarting)} draft={restarting} onCancel={() => setRestarting(undefined)}
                onConfirm={() => { setRestarting(undefined); discard(restarting.datasetId); startAfresh(restarting.datasetId) }} />}
        </section>}
        {editing && source && <ExportEditor key={`${source.id}:${editing.run}`} {...props} source={source} draft={editing.draft}
            step={current} blocked={blocked} listing={facts}
            start={{ ...(start.version ? { version: start.version } : {}), ...(fill ? { fill } : {}) }}
            onNavigate={go} onFallBack={fallBack} onProposed={reloadListing} onContentRead={() => setContentRead(source.id)} onDiscarded={() => startAfresh(source.id)} />}
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
function ExportEditor({ source, targets, readiness, mayShare, catalogUrl, defaults, draftOwner, draft, step, blocked, listing, start, onNavigate, onFallBack, onProposed, onContentRead, onDiscarded }: PanelProps & {
    source: ExportSource
    draft?: ShareDraft
    /** The wizard's step, from the address: „Auswählen“ (1) shows its dropdown above this. */
    step: WizardStep
    /** The dataset is busy: „Auswählen“ shows none of its content or buttons, and does not read it. */
    blocked: boolean
    /** The share listing, once read: the source of the Steckbrief's notices and „Was hast du geändert?“. */
    listing?: ListingFacts
    /** What the form starts with until the person types or sends anything: the version, and the fill with its answer. */
    start: { version?: string; fill?: FillState }
    /** To another step, as the buttons ask: forward as a new history entry, back through history. */
    onNavigate: (step: WizardStep) => void
    /** This step cannot be had after all (no data structure of its own, a preview that failed): the address becomes `step`. */
    onFallBack: (step: WizardStep) => void
    /** A merge request was opened or found, or a "no" came to light: "In Arbeit" should read GitLab again. */
    onProposed: () => void
    /** The dataset's content was read, so the panel may ask for the fill. */
    onContentRead: () => void
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
    // Going back a step - by a button or the browser's back - drops the preview and the last answer, which
    // describe a form the person is about to change; going forward keeps them. The answer stays once, when a
    // preview opened by an address failed: it says on the Steckbrief why the preview is not there.
    const [shownStep, setShownStep] = useState(step)
    const [keepAnswer, setKeepAnswer] = useState(false)
    if (shownStep !== step) {
        setShownStep(step)
        if (step < shownStep) {
            setPreview(undefined)
            if (keepAnswer) setKeepAnswer(false)
            else setResult(null)
        }
    }
    const catalog = source.catalog
    const filled = start.fill?.answer?.status === 'ok' ? start.fill.answer.steckbrief : undefined
    const startingWith = { ...(filled ? { fill: filled } : {}), ...(start.version ? { version: start.version } : {}) }
    const [basics, setBasics] = useState<SteckbriefBasics>(() => {
        const initial = startingBasics(source, defaults, startingWith)
        // A draft fills in what it knows; a field it does not know keeps the default.
        for (const key of Object.keys(initial) as (keyof SteckbriefBasics)[]) {
            const saved = draft?.basics[key]
            if (typeof saved === 'string') initial[key] = saved
        }
        return initial
    })
    const [metadata, setMetadata] = useState(() =>
        draft ? restoreMetadata(draft.metadata, metadataDraft(filled?.metadata ?? catalog?.metadata)) : metadataDraft(filled?.metadata ?? catalog?.metadata))
    const [targetKey, setTargetKey] = useState(() =>
        draft && targets.some((target) => target.key === draft.targetKey) ? draft.targetKey
            : filled && targets.some((target) => target.key === filled.targetKey) ? filled.targetKey : targets[0]?.key ?? '')
    // What arrives after the form opened (the listing, the fill) is taken in only while nothing was typed, sent or
    // continued: afterwards the form is the person's, and a reading after a submit must not move its version on.
    const [untouched, setUntouched] = useState(!draft)
    const startKey = `${filled ? `${filled.targetKey}|${filled.from}` : ''}|${start.version ?? ''}`
    const [startedWith, setStartedWith] = useState(startKey)
    // The shared version the form was filled from, for the notice saying so.
    const [filledFrom, setFilledFrom] = useState(draft ? undefined : filled)
    if (startKey !== startedWith) {
        setStartedWith(startKey)
        if (untouched) {
            setBasics(startingBasics(source, defaults, startingWith))
            setMetadata(metadataDraft(filled?.metadata ?? catalog?.metadata))
            if (filled && targets.some((target) => target.key === filled.targetKey)) setTargetKey(filled.targetKey)
            setFilledFrom(filled)
        }
    }
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
    // Where this version stands is told by lib/export/share-stages, the same as in "In Arbeit" and "Veröffentlicht".
    // The catalogue step needs the package on the base branch AND, by tree id, the merged one.
    const known = shareStates[currentShareKey] ?? {}
    // The catalogue team took this version or an earlier one out, as a GitLab reading of any version said: before anyone proposes more.
    const takenOutVersion = takenOutOf(shareStates, currentShareKey)
    const takenOut = takenOutVersion ? <Notice tone="neutral">{takenOutNotice(takenOutVersion)}</Notice> : undefined
    // The catalogue team changed the version this one follows during review: sharing from the dataset would write over
    // their change, so warn first.
    const changed = reviewChangeBelow(listing?.rows ?? null, { targetKey, slug: basics.slug, version: basics.version })
    const reviewChange = changed ? (
        <Notice tone="warn" action={<ExternalAnchor href={changed.changeUrl}>Änderung ansehen</ExternalAnchor>}>
            {reviewChangeNotice(changed.version)}
        </Notice>
    ) : undefined
    // The folder the form proposes into, whoever shared there, as the server's rules read it: the person may have changed
    // the short name „Auswählen“ found.
    const formPackage = listing ? sharedPackageOf(listing.rows, { slug: basics.slug, targetKey, anyInstance: true }, listing.instance) : undefined
    const packageKey = `${targetKey}|${basics.slug.trim().toLowerCase()}`
    // The "no" this version follows: from the listing, or from a refusal where the listing did not know it yet.
    const [heard, setHeard] = useState<{ key: string; followed: FollowedDecline }>()
    const followed = (heard?.key === packageKey ? heard.followed : undefined) ?? (listing ? followedDecline(formPackage, listing.instance) : undefined)
    const whatChanged = asksWhatChanged(followed, basics.version) ? followed : undefined
    // The way on after a "no" at the form's version: above it and everything used up in its package.
    const wayOn = suggestedVersion(formPackage, [basics.version])
    // Another proposal of the dataset open (a link or a race): said at the top of the step, and the submit gives way to
    // where it goes on - the server refuses it anyway.
    const beside = listing ? busyBeside(listing.busy.get(source.id) ?? [], { targetKey, slug: basics.slug, version: basics.version }) : []
    const busyNotice = beside.length ? stageNotice({ kind: 'busy', rows: beside }, source.name) : undefined
    // The form's short name is another instance's package: said here too, where it is changed.
    const nameTaken = listing && !catalog ? nameTakenIn(listing.rows, basics.slug, listing.instance, targetKey) : undefined
    const nameNotice = nameTaken ? stageNotice({ kind: 'name-taken', slug: nameTaken.slug, pkg: nameTaken }, source.name) : undefined
    // Where the fill stands, said only while the form is as it started.
    const fillNotice = !start.fill || !untouched ? undefined
        : !start.fill.answer ? <Pending>Angaben aus Version {start.fill.from} werden geholt …</Pending>
            : start.fill.answer.status !== 'ok' ? <Notice tone="neutral">{unfilledNotice(start.fill.from, start.fill.answer.detail)}</Notice>
                : undefined
    // Not read for a busy dataset at „Auswählen“: a server action queued for nothing delays the next.
    const unread = blocked && step === 1
    // Told once the content is read, by whichever render made it; kept current like `latest` below.
    const reportRead = useRef(onContentRead)
    useEffect(() => {
        reportRead.current = onContentRead
    })
    useEffect(() => {
        if (unread) return
        let cancelled = false
        inspectExportSource(source.id).then((value) => {
            if (cancelled) return
            setInventory(value)
            if (!value.error) reportRead.current()
        })
            // The notice around it already says what failed and offers "Erneut laden"; this names why.
            .catch(() => { if (!cancelled) setInventory({ artifacts: [], warnings: [], error: 'Die Anfrage an den Server ist fehlgeschlagen.' }) })
        return () => { cancelled = true }
    }, [source.id, inventoryAttempt, unread])
    // Back to the Steckbrief, keeping the answer that says what to do there.
    const toSteckbrief = () => {
        setKeepAnswer(true)
        onFallBack(2)
    }
    const run = (intent: ExportIntent) => {
        // A "no" the page learnt of after the Steckbrief is answered there, not on this step.
        if (intent === 'bundle' && whatChanged && changeNoteProblem(basics.changeNote)) {
            setResult({ intent, status: 'invalid', detail: whatChangedRefusal(whatChanged) })
            if (step === 3) toSteckbrief()
            return
        }
        propose(intent)
    }
    const propose = (intent: ExportIntent) => startTransition(async () => {
        setPendingIntent(intent)
        setUntouched(false)
        // The version this request is about, even if the form changes while it runs.
        const requestKey = currentShareKey
        const requestPackage = packageKey
        const data = new FormData()
        for (const [key, value] of Object.entries(basics)) data.set(key, value)
        data.set('datasetId', source.id)
        data.set('targetKey', targetKey)
        data.set('catalogMetadata', JSON.stringify(draftMetadata(metadata)))
        data.set('demoStreams', JSON.stringify(demoChosen))
        if (whatChanged) data.set('follows', JSON.stringify(followsRefOf(whatChanged)))
        data.set('intent', intent)
        try {
            const next = await exportAction(null, data)
            setResult(next)
            setShareStates((previous) => rememberShareResult(previous, requestKey, next))
            // A preview opened by an address that failed goes back to the Steckbrief, with the errors, without showing them here first.
            const failedHere = intent === 'preview' && next.status !== 'ok' && step === 3
            if (next.preview && !failedHere) setPreview(next.preview)
            if (intent === 'preview' && next.status === 'ok') onNavigate(3)
            if (failedHere) toSteckbrief()
            // The server knew of a "no" the page did not: the Steckbrief asks what changed from now on.
            if (next.follows) {
                setHeard({ key: requestPackage, followed: next.follows })
                if (step === 3) toSteckbrief()
            }
            // From here on the merge request (or the repository) holds the content: the draft has done its job.
            const landed = next.status === 'ok' || next.status === 'already-open' || next.status === 'unchanged'
            if (intent === 'bundle' && landed) forgetDraft()
            // A refusal for a dataset busy meanwhile reads the listing again, so „Auswählen“ greys it out; so does a "no"
            // the listing does not know yet.
            const saidNo = declineIsNews(listing?.rows, next)
            if (((intent === 'bundle' || intent === 'catalog') && (landed || next.busy)) || saidNo) onProposed()
        } catch {
            setResult({ intent, status: 'error', detail: 'Die Anfrage ist fehlgeschlagen. Bitte erneut versuchen.' })
            if (intent === 'preview' && step === 3) toSteckbrief()
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
    const editBasics = (key: keyof SteckbriefBasics, value: string) => {
        setBasics({ ...basics, [key]: value })
        setDirty(true)
        setUntouched(false)
        if (key === 'publisher' || key === 'slug' || key === 'domain') setAddressOpen(true)
    }
    const addressInvalid = !SEGMENT.test(basics.publisher.trim().toLowerCase()) || !useCaseSlugPattern.test(basics.slug.trim().toLowerCase())
        || !SEGMENT.test(basics.domain.trim().toLowerCase())
    // Where the use case would be found; the URN itself shows only in the preview's technical details. Valid values
    // read exactly as the catalogue spells its pages (catalogEntryHref), and wrong ones as typed: tidied up, an empty
    // Herausgeber-Kürzel would show an address that will never exist.
    const addressHref = `/use-cases/${basics.publisher.trim().toLowerCase()}/${basics.slug.trim().toLowerCase()}`
    const editMetadata = (next: MetadataDraft) => { setMetadata(next); setDirty(true); setUntouched(false) }
    const chooseTarget = (key: string) => { setTargetKey(key); setDirty(true); setUntouched(false) }
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
    const backToChoice = () => onNavigate(1)
    // A refusal for a busy dataset leads to „In Arbeit“, else to its proposal - unless the step already shows that link.
    const answerAction = (answer: ExportActionResult) =>
        answer.busy ? <InProgressLink />
            : answer.mrUrl && answer.mrUrl !== known.bundle?.mrUrl && answer.mrUrl !== known.catalog?.mrUrl ? <ExternalAnchor href={answer.mrUrl}>In GitLab ansehen</ExternalAnchor>
                : undefined
    // `run` and `onFallBack` are made anew on every render; the effects below ask for the latest ones, so they run
    // on what changes the step's facts, not on each render. Declared first, so it is current when they run.
    const latest = useRef({ run, onFallBack })
    useEffect(() => {
        latest.current = { run, onFallBack }
    })
    // Without a data structure of its own the Steckbrief is no step to be on: „Auswählen“ says why.
    useEffect(() => {
        if (lacksStructure && step > 1) latest.current.onFallBack(1)
    }, [lacksStructure, step])
    // At the preview without one - a reload, browser forward, a link: it is made again from the Steckbrief once the
    // content is read, because the preview needs its demo streams. Unreadable content sends the person to the
    // Steckbrief, which says so and offers to read it again. Once per arrival: a failed answer and the address
    // that follows it land in two renders, and the one between must not ask the server a second time.
    const remade = useRef(false)
    useEffect(() => {
        if (step !== 3) {
            remade.current = false
            return
        }
        if (preview || pending || !inventory || remade.current) return
        remade.current = true
        if (inventory.error) latest.current.onFallBack(2)
        else latest.current.run('preview')
    }, [step, preview, pending, inventory])
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
        {step === 1 && !blocked && <Section title="Was kommt ins Paket?"
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
                            <Button variant="primary" disabled={lacksStructure} aria-describedby={lacksStructure ? 'steckbrief-gesperrt' : undefined} onClick={() => onNavigate(2)}>Weiter zum Steckbrief</Button>
                        </div>
                    </div>
                </>}
        </Section>}
        {/* Focus stays in the dropdown, so the contents arriving below it are said, not jumped to. */}
        {step === 1 && !blocked && <p role="status" className="sr-only">{inventory && !inventory.error ? `Inhalt von „${source.name}“ gelesen` : ''}</p>}
        {step === 2 && <form className="flex flex-col gap-6" onSubmit={(event) => { event.preventDefault(); run('preview') }}>
            <div><h2 ref={stepHeading} tabIndex={-1} className="scroll-mt-20 text-xl font-semibold focus:outline-none">Steckbrief ergänzen</h2><p className="mt-1 text-sm text-muted-foreground">Pflichtfelder sind mit * markiert. Weitere Angaben kannst du ergänzen, soweit sie bekannt sind.</p>
                <div className="mt-3 flex flex-col gap-2 empty:hidden">
                    {/* First: while it stands, nothing below can be submitted. */}
                    {busyNotice && <StageNoticeView notice={busyNotice} />}
                    {nameNotice && <StageNoticeView notice={nameNotice} />}
                    {/* Filled from a shared version, its notice replaces the catalogue's prefill notice. */}
                    {source.notice && !filledFrom && <Notice tone="neutral">{source.notice}</Notice>}
                    {filledFrom && <Notice tone="neutral">{filledNotice(filledFrom)}</Notice>}
                    {fillNotice}
                    {/* A second merge request for the same package next to an open one would compete with it, so the advice differs per state. */}
                    {known.bundle?.state === 'mr-open' && <Notice tone="neutral">Für Version {basics.version} ist schon ein Vorschlag in Prüfung{mergeRequestRef(known.bundle.mrUrl) ? ` (${mergeRequestRef(known.bundle.mrUrl)})` : ''}. Er enthält den vorherigen Stand - Änderungen gehen erst, wenn er angenommen oder zurückgezogen ist, dann mit einer neuen Version.</Notice>}
                    {known.bundle?.state === 'on-base' && <Notice tone="neutral">Version {basics.version} ist schon angenommen. Änderungen am Steckbrief gehen jetzt nur noch mit einer neuen Version.</Notice>}
                    {takenOut}
                    {reviewChange}
                </div></div>
            <fieldset disabled={pending} className="flex flex-col gap-6 disabled:opacity-60">
                {/* First, as it is what this version is about. */}
                {whatChanged && <section className="flex flex-col gap-2 rounded-xl border bg-card p-5">
                    <label htmlFor="was-geaendert" className="font-semibold">Was hast du geändert? *</label>
                    <p id="was-geaendert-warum" className="text-sm text-muted-foreground">{whatChangedLead(whatChanged)}</p>
                    {/* The catalogue team's words, as „In Arbeit“ shows them. */}
                    <p id="was-geaendert-grund" className="break-words text-sm text-foreground">{reasonWords(whatChanged.decline)}{' '}
                        <ExternalAnchor href={whatChanged.decline.mrUrl}>Vorschlag ansehen</ExternalAnchor></p>
                    <textarea id="was-geaendert" rows={3} maxLength={CHANGE_NOTE_MAX} required className={inputClass} value={basics.changeNote}
                        aria-describedby="was-geaendert-warum was-geaendert-grund was-geaendert-hinweis" onChange={(event) => editBasics('changeNote', event.target.value)} />
                    <span id="was-geaendert-hinweis" className="text-xs text-muted-foreground">1 bis {CHANGE_NOTE_MAX} Zeichen. Das Katalog-Team liest den Text im öffentlichen Vorschlag bei GitLab.</span>
                </section>}
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
                    <p className="text-sm text-muted-foreground md:col-span-2">{catalog || filledFrom ? 'Die nächste Version ist vorgeschlagen. Für eine eigenständige Variante kannst du die Adresse ändern.' : 'Die Adresse ist aus dem Namen des Datensatzes gebildet. Ändern musst du sie nur, wenn sie anders lauten soll.'}</p>
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
        {step === 3 && <>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h2 ref={stepHeading} tabIndex={-1} className="scroll-mt-20 text-xl font-semibold focus:outline-none">Vorschau & Teilen</h2><p className="mt-1 text-sm text-muted-foreground">Prüfe Steckbrief und Paket. Nach dem Einreichen prüft das Katalog-Team zweimal: erst das Paket, dann den Katalog-Eintrag, den du dazwischen vorschlägst.</p></div>
                <Button variant="ghost" disabled={pending} onClick={() => onNavigate(2)}>Steckbrief bearbeiten</Button>
            </div>
            {/* The same heading while the preview is made again, so focus stays on it when the preview arrives. */}
            {!preview ? <Pending>Vorschau wird erstellt …</Pending> : <>
                {busyNotice && <StageNoticeView notice={busyNotice} />}
                {takenOut}
                {reviewChange}
                {/* The one action first, not under all the previews (Ewa's point 8). */}
                <ShareSteps
                    progress={shareProgress({ version: basics.version, bundle: known.bundle, catalog: known.catalog })}
                    pendingIntent={pending && (pendingIntent === 'bundle' || pendingIntent === 'status' || pendingIntent === 'catalog') ? pendingIntent : undefined}
                    busy={pending}
                    proposeBlocker={previewBlocker ?? setupBlocker ?? (beside.length ? BUSY_BLOCKER : undefined)}
                    proposeWaits={!previewBlocker && !setupBlocker && beside.length > 0}
                    catalogBlocker={previewBlocker ?? setupBlocker ?? (catalogUrl ? undefined : 'Der Katalog ist auf dieser Instanz noch nicht eingerichtet - das richtet der Betrieb ein.')}
                    canCheck={forgeReady}
                    bundleMrUrl={known.bundle?.mrUrl}
                    catalogMrUrl={known.catalog?.mrUrl}
                    removalMrUrl={known.bundle?.removal?.mrUrl}
                    version={basics.version}
                    suggested={wayOn}
                    declines={{ review: known.bundle?.declined, listing: known.catalog?.state === 'declined' ? known.catalog.declined : undefined }}
                    removalDeclined={removalDeclineShown(known.bundle, known.catalog)}
                    onPropose={() => run('bundle')}
                    onCheck={() => run('status')}
                    onCatalog={() => run('catalog')}
                />
                {/* The answer to the last action, under the task it answers. */}
                {result && <Notice tone={resultTone(result.status)} live action={answerAction(result)}>
                    <p className="whitespace-pre-wrap">{result.detail}</p>
                </Notice>}
                <section className="rounded-xl border bg-card p-5">
                    <h3 className="text-lg font-semibold">{basics.displayName}</h3><p className="mt-2 whitespace-pre-wrap text-sm">{basics.description}</p>
                    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">{([['Herausgeber', basics.maintainer], ['Lizenz', basics.license], ['Schlagworte', basics.keywords], ['Version', basics.version],
                        ['Adresse im Katalog', addressHref], ['Fachgebiet', basics.domain]] as const).map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="break-words">{value || 'Keine Angabe'}</dd></div>)}
                        {whatChanged && <div className="sm:col-span-2"><dt className="text-muted-foreground">Was hast du geändert?</dt><dd className="whitespace-pre-wrap break-words">{basics.changeNote}</dd></div>}</dl>
                    <div className="mt-5"><MetadataReview metadata={metadata} /></div>
                </section>
                <Preview preview={preview} />
            </>}
        </>}
        {pending && step !== 3 && <Pending>Anfrage wird verarbeitet …</Pending>}
        {result && !refused && step !== 3 && <Notice tone={resultTone(result.status)} live action={answerAction(result)}>
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
