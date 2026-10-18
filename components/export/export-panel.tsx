'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Eye } from 'lucide-react'
import { exportAction, inspectExportSource, type ExportActionResult, type ExportIntent } from '@/lib/export-actions'
import type { ExportReadiness, ExportTarget } from '@/lib/export/config'
import type { ExportSource } from '@/lib/export/sources'
import { draftTime, type ShareDraft } from '@/lib/export/share-drafts'
import { shareProgress, takenOutNotice } from '@/lib/export/share-stages'
import { mergeRequestRef, rememberShareResult, shareKey, takenOutOf, type ShareStates } from '@/lib/export/share-state'
import { draftMetadata, metadataDraft, METADATA_GROUPS, type MetadataDraft } from '@/lib/export/metadata'
import { slugify } from '@/lib/export/urn'
import { catalogEntryPath } from '@/lib/use-case-catalog/path'
import { THEME_LABELS, type Theme } from '@/lib/catalog/vocabulary'
import { InProgress } from '@/components/export/in-progress'
import { MetadataForm } from '@/components/export/metadata-form'
import { PackageContents } from '@/components/export/package-contents'
import { ShareSteps } from '@/components/export/share-steps'
import { useShareDraftActions, useShareDrafts } from '@/components/export/use-share-drafts'
import { useSharedListing } from '@/components/export/use-shared-listing'
import { Button, ExternalAnchor } from '@/components/ui/button'
import { EmptyState, Section } from '@/components/ui/layout'
import { InlineNotice, Notice, NoticeList, Pending } from '@/components/ui/notice'
import { resultTone } from '@/lib/export/result-tone'
import { Select } from '@/components/ui/select'

const inputClass = 'w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40'
const STEPS = ['Use Case auswählen', 'Bestand prüfen', 'Steckbrief ergänzen', 'Vorschau & Teilen']
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
    return <ol aria-label="Fortschritt" className="grid gap-2 sm:grid-cols-4">
        {STEPS.map((label, index) => <li key={label} aria-current={current === index + 1 ? 'step' : undefined}
            className={`rounded-lg border px-3 py-3 text-sm ${current === index + 1 ? 'border-primary bg-primary/5 font-semibold text-primary' : 'text-muted-foreground'}`}>
            <span className="mr-2">{index + 1}.</span>{label}
        </li>)}
    </ol>
}
export function ExportPanel(props: PanelProps) {
    const [selection, setSelection] = useState('')
    // The dataset being shared, and the draft it continues, if it continues one.
    const [active, setActive] = useState<{ id: string; draft?: ShareDraft } | null>(null)
    const { drafts, discard } = useShareDrafts(props.draftOwner)
    // Read here, not in "In Arbeit": this panel stays while the form comes and goes.
    const shared = useSharedListing(props.canListShares)
    const source = active ? props.sources.find((row) => row.id === active.id) : undefined
    if (source) return <ExportEditor key={source.id} {...props} source={source} draft={active?.draft}
        onChoose={() => setActive(null)} onProposed={shared.reload} />
    const inProgress = <InProgress drafts={drafts} sources={props.sources} rows={shared.rows} error={shared.error}
        loaded={shared.loaded} onReload={shared.reload}
        onContinue={(draft) => setActive({ id: draft.datasetId, draft })} onDiscard={discard} />
    if (!props.sources.length) return <div className="flex flex-col gap-6">{inProgress}<EmptyState>Diese Instanz hat noch keinen Use Case, auf den du zugreifen kannst.</EmptyState></div>
    const selectedDraft = drafts.find((draft) => draft.datasetId === selection)
    const draftOf = new Set(drafts.map((draft) => draft.datasetId))
    return <div className="flex flex-col gap-6">
        {/* What was started and is not finished comes before starting anew: the start-or-resume screen. */}
        {inProgress}
        <Steps current={1} />
        <section className="flex flex-col gap-4 rounded-xl border bg-card p-6">
            <h2 className="text-xl font-semibold">Welchen Use Case möchtest du teilen?</h2>
            <p className="text-sm text-muted-foreground">Wähle einen installierten oder selbst erstellten Use Case dieser Instanz.</p>
            {props.sourceNotice && <Notice tone="neutral">{props.sourceNotice}</Notice>}
            <label className="flex flex-col gap-2 text-sm">
                <span>Lokaler Use Case</span>
                <Select value={selection} onValueChange={setSelection} placeholder="Bitte auswählen …"
                    options={props.sources.map((row) => ({ value: row.id, label: `${row.catalog?.displayName ?? row.name} · ${row.catalog ? `installiert (${row.name})` : 'lokaler Bestand'}${draftOf.has(row.id) ? ' · Entwurf vorhanden' : ''}` }))} />
            </label>
            {selectedDraft ? (
                // Neutral: a fact about this dataset, and a choice, not a warning.
                <Notice tone="neutral" title={`Für diesen Use Case gibt es einen Entwurf vom ${draftTime(selectedDraft.savedAt)}.`}
                    action={<div className="flex flex-wrap gap-2">
                        <Button variant="primary" onClick={() => setActive({ id: selection, draft: selectedDraft })}>Entwurf fortsetzen</Button>
                        <Button onClick={() => { discard(selection); setActive({ id: selection }) }}>Neu beginnen</Button>
                    </div>}>
                    Gespeichert in diesem Browser. „Neu beginnen“ löscht den Entwurf.
                </Notice>
            ) : (
                <Button variant="primary" disabled={!selection} className="self-start" onClick={() => setActive({ id: selection })}>Bestand prüfen</Button>
            )}
        </section>
    </div>
}

/** A saved draft's form text over the defaults: fields added since the draft was saved start empty, not undefined. */
function restoreMetadata(saved: MetadataDraft, defaults: MetadataDraft): MetadataDraft {
    return { fields: { ...defaults.fields, ...saved.fields }, themes: saved.themes, media: saved.media }
}
function ExportEditor({ source, targets, readiness, mayShare, catalogUrl, defaults, draftOwner, draft, onChoose, onProposed }: PanelProps & {
    source: ExportSource
    draft?: ShareDraft
    onChoose: () => void
    /** A merge request was opened or found: "In Arbeit" should read GitLab again. */
    onProposed: () => void
}) {
    const [step, setStep] = useState<number>(draft?.step ?? 2)
    const stepHeading = useRef<HTMLHeadingElement>(null)
    useEffect(() => {
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
    const [pendingIntent, setPendingIntent] = useState<ExportIntent>()
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
            if (intent === 'preview' && next.status === 'ok') setStep(4)
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
        discardDraft(source.id)
        setSavedAt(undefined)
        setDirty(false)
    }
    const editBasics = (key: keyof typeof basics, value: string) => { setBasics({ ...basics, [key]: value }); setDirty(true) }
    const editMetadata = (next: MetadataDraft) => { setMetadata(next); setDirty(true) }
    const chooseTarget = (key: string) => { setTargetKey(key); setDirty(true) }
    // Saved shortly after the typing stops, without a button and without validation:
    // a draft may be incomplete (patterns for long forms, 2026-10-16).
    useEffect(() => {
        if (!dirty) return
        const payload: ShareDraft = {
            datasetId: source.id, datasetName: source.name, savedAt: '', step: step >= 3 ? 3 : 2,
            basics, metadata, targetKey, demoExcluded: [...demoExcluded],
        }
        unsaved.current = payload
        const timer = window.setTimeout(() => {
            const at = new Date().toISOString()
            if (saveDraft({ ...payload, savedAt: at })) setSavedAt(at)
            unsaved.current = null
        }, 600)
        return () => window.clearTimeout(timer)
    }, [dirty, step, basics, metadata, targetKey, demoExcluded, source.id, source.name, saveDraft])
    // Leaving within that moment - another page, another dataset, closing the tab - writes the last edits at once.
    useEffect(() => {
        const flush = () => {
            if (!unsaved.current) return
            saveDraft({ ...unsaved.current, savedAt: new Date().toISOString() })
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
    // A refused preview stays on step 3 and never reaches the step-4 view, yet the export's
    // warnings there usually name the cause (a source without a structure, say), so they
    // are shown next to the errors - in place of the general answer, which would only
    // repeat that the check failed.
    const refused = step === 3 && result?.preview?.errors.length ? result.preview : undefined
    // Why a step of the task cannot be taken from here, in the person's words.
    const previewBlocker = preview?.errors.length ? 'Die Paketprüfung meldet Fehler - Details in der Vorschau unten.' : undefined
    const setupBlocker = readiness !== 'ready' || targets.length === 0
        ? 'Teilen ist auf dieser Instanz noch nicht eingerichtet - das richtet der Betrieb ein. Die Vorschau geht trotzdem.'
        : mayShare ? undefined : 'Merge Requests darf hier nur anlegen, wer Datenstrukturen anlegen und Datensätze bearbeiten darf, zum Beispiel Data Owner, Data Architect oder Data Steward.'
    return <div className="flex flex-col gap-6">
        <Steps current={step} />
        <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm"><span className="text-muted-foreground">Ausgewählt: </span><strong>{source.name}</strong></p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {/* Quiet proof that nothing is lost by leaving; the draft stays in this browser. */}
                {savedAt && <span className="text-xs text-muted-foreground">Entwurf gespeichert, {draftTime(savedAt)} ·{' '}
                    <Button variant="ghost" className="text-xs" onClick={forgetDraft}>Entwurf löschen</Button></span>}
                <Button variant="ghost" disabled={pending} onClick={onChoose}>Anderen Use Case wählen</Button>
            </div>
        </div>
        {step === 2 && <Section title="Was kommt ins Paket?" headingRef={stepHeading}
            lead={<>Das gehört zum Datensatz „{source.name}“ - in der Reihenfolge, in der die Daten fließen.</>}>
            {!inventory ? <Pending>Bestand wird geladen …</Pending>
                : inventory.error ? <Notice tone="error" title="Der Bestand konnte nicht gelesen werden" live action={<Button onClick={reloadInventory}>Erneut laden</Button>}>{inventory.error}</Notice>
                : <>
                    <PackageContents source={source} artifacts={inventory.artifacts} demo={inventory.demo}
                        demoExcluded={demoExcluded} onToggleDemo={toggleDemo} onReloadDemo={reloadInventory} />
                    {lacksStructure && <Notice tone="warn" title="Es fehlt eine eigene Datenstruktur">Ohne eigene Datenstruktur lässt sich das Paket nicht teilen - die Paketprüfung verlangt mindestens eine.</Notice>}
                    {!!inventory.warnings.length && <Notice tone="warn" title="Hinweise zum Bestand"><NoticeList items={inventory.warnings} /></Notice>}
                    <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs text-muted-foreground">Nicht im Paket: gespeicherte Daten, der Datenpool und Zugangsdaten.</p>
                        {/* Blocked rather than refused later: the package check would turn it down after the whole form (Ewa's plan, 2026-10-13). */}
                        <div className="flex flex-wrap items-center gap-3">
                            {lacksStructure && <InlineNotice tone="warn" id="steckbrief-gesperrt">Geht erst mit einer eigenen Datenstruktur.</InlineNotice>}
                            <Button variant="primary" disabled={lacksStructure} aria-describedby={lacksStructure ? 'steckbrief-gesperrt' : undefined} onClick={() => setStep(3)}>Weiter zum Steckbrief</Button>
                        </div>
                    </div>
                </>}
        </Section>}
        {step === 3 && <form className="flex flex-col gap-6" onSubmit={(event) => { event.preventDefault(); run('preview') }}>
            <div><h2 ref={stepHeading} tabIndex={-1} className="scroll-mt-20 text-xl font-semibold focus:outline-none">Steckbrief ergänzen</h2><p className="mt-1 text-sm text-muted-foreground">Pflichtfelder sind mit * markiert. Weitere Angaben kannst du ergänzen, soweit sie bekannt sind.</p>
                <div className="mt-3 flex flex-col gap-2 empty:hidden">
                    {source.notice && <Notice tone="neutral">{source.notice}</Notice>}
                    {/* A second merge request for the same package next to an open one would compete with it, so the advice differs per state. */}
                    {known.bundle?.state === 'mr-open' && <Notice tone="neutral">Für Version {basics.version} ist schon ein Merge Request offen{mergeRequestRef(known.bundle.mrUrl) ? ` (${mergeRequestRef(known.bundle.mrUrl)})` : ''}. Er enthält den vorherigen Stand - Änderungen gehen erst nach dem Merge oder nach dem Schließen des Merge Requests, dann mit einer neuen Version.</Notice>}
                    {known.bundle?.state === 'on-base' && <Notice tone="neutral">Version {basics.version} ist schon im Repository. Änderungen am Steckbrief gehen jetzt nur noch mit einer neuen Version.</Notice>}
                    {takenOut}
                </div></div>
            <fieldset disabled={pending} className="flex flex-col gap-6 disabled:opacity-60">
                <section className="grid gap-4 rounded-xl border bg-card p-5 md:grid-cols-2">
                    <h3 className="font-semibold md:col-span-2">Grundangaben</h3>
                    {([{ key: 'displayName', label: 'Anzeigename *' }, { key: 'maintainer', label: 'Herausgeber / Maintainer *' },
                        { key: 'license', label: 'Lizenz *' }, { key: 'keywords', label: 'Schlagworte (kommagetrennt)' }] as const).map(({ key, label }) =>
                        <label key={key} className="flex flex-col gap-1 text-sm"><span>{label}</span><input className={inputClass} value={basics[key]} required={key !== 'keywords'} onChange={(event) => editBasics(key, event.target.value)} /></label>)}
                    <label className="flex flex-col gap-1 text-sm md:col-span-2"><span>Beschreibung *</span><textarea rows={4} className={inputClass} value={basics.description} required onChange={(event) => editBasics('description', event.target.value)} /></label>
                </section>
                <MetadataForm value={metadata} onChange={editMetadata} />
                <section className="grid gap-4 rounded-xl border bg-card p-5 md:grid-cols-2">
                    <h3 className="font-semibold md:col-span-2">Paket & Veröffentlichung</h3>
                    <p className="text-sm text-muted-foreground md:col-span-2">{catalog ? 'Die nächste Patch-Version ist vorgeschlagen. Für eine eigenständige Variante kannst du Publisher und Paket-Slug ändern.' : 'Lege die Kennung für das neue Paket fest.'}</p>
                    {([{ key: 'publisher', label: 'Publisher *', hint: '2–40 Kleinbuchstaben oder Ziffern.' }, { key: 'slug', label: 'Paket-Slug *', hint: '2–60 Kleinbuchstaben, Ziffern oder Bindestriche, nicht am Rand.' },
                        { key: 'version', label: 'Version *', hint: 'Zum Beispiel 1.0.0.' }, { key: 'domain', label: 'URN-Domain *', hint: 'Zum Beispiel environment, mobility oder general.' }] as const).map(({ key, label, hint }) =>
                        <label key={key} className="flex flex-col gap-1 text-sm"><span>{label}</span><input className={inputClass} value={basics[key]} required onChange={(event) => editBasics(key, event.target.value)} /><span className="text-xs text-muted-foreground">{hint}</span></label>)}
                    <p className="break-all text-xs text-muted-foreground md:col-span-2">Katalog-ID: urn:{basics.publisher}:usecase:{basics.slug}</p>
                    <label className="flex flex-col gap-1 text-sm md:col-span-2"><span>Zielrepository</span><Select value={targetKey} onValueChange={chooseTarget} disabled={!targets.length} placeholder="Nicht konfiguriert - Vorschau verfügbar"
                        options={targets.map((target) => ({ value: target.key, label: `${target.label} · ${target.baseBranch}` }))} /></label>
                </section>
                {/* The answer belongs to this step's form: back in the inventory it would describe a form no longer shown. */}
                {/* A continued draft starts here, before the inventory arrived - or without it, when reading it failed.
                    The preview needs its demo streams, so it waits for the inventory instead of going without them. */}
                {inventory?.error && <InlineNotice tone="warn" id="bestand-fehlt">Der Bestand ließ sich nicht lesen ({inventory.error}). Ohne ihn fehlen dem Paket die Demo-Daten - bitte erst neu laden.</InlineNotice>}
                <div className="flex flex-wrap gap-2"><Button onClick={() => { setStep(2); setResult(null) }}>Zurück zum Bestand</Button>
                    {inventory?.error && <Button onClick={reloadInventory}>Bestand neu laden</Button>}
                    <Button type="submit" variant="primary" icon={Eye} pending={pending || !inventory} disabled={Boolean(inventory?.error)}
                        aria-describedby={inventory?.error ? 'bestand-fehlt' : undefined}>Vorschau erstellen</Button></div>
            </fieldset>
        </form>}
        {step === 4 && preview && <>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h2 ref={stepHeading} tabIndex={-1} className="scroll-mt-20 text-xl font-semibold focus:outline-none">Vorschau & Teilen</h2><p className="mt-1 text-sm text-muted-foreground">Prüfe Steckbrief und Paket. In den Katalog kommt es in vier Schritten - zwei davon übernehmen Prüfende.</p></div>
                <Button variant="ghost" disabled={pending} onClick={() => { setStep(3); setResult(null); setPreview(undefined) }}>Steckbrief bearbeiten</Button>
            </div>
            {takenOut}
            {/* The one action first, not under all the previews (Ewa's point 8). */}
            <ShareSteps
                progress={shareProgress({ version: basics.version, bundle: known.bundle, catalog: known.catalog })}
                pendingIntent={pending && (pendingIntent === 'bundle' || pendingIntent === 'status' || pendingIntent === 'catalog') ? pendingIntent : undefined}
                busy={pending}
                proposeBlocker={previewBlocker ?? setupBlocker}
                catalogBlocker={previewBlocker ?? setupBlocker ?? (catalogUrl ? undefined : 'Für diese Instanz ist kein Katalog-Repository eingerichtet - das richtet der Betrieb ein.')}
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
                action={result.mrUrl && result.mrUrl !== known.bundle?.mrUrl && result.mrUrl !== known.catalog?.mrUrl ? <ExternalAnchor href={result.mrUrl}>Merge Request öffnen</ExternalAnchor> : undefined}>
                <p className="whitespace-pre-wrap">{result.detail}</p>
            </Notice>}
            <section className="rounded-xl border bg-card p-5">
                <h3 className="text-lg font-semibold">{basics.displayName}</h3><p className="mt-2 whitespace-pre-wrap text-sm">{basics.description}</p>
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">{Object.entries(basics).filter(([key]) => !['displayName', 'description'].includes(key)).map(([key, value]) => <div key={key}><dt className="text-muted-foreground">{{ maintainer: 'Herausgeber', license: 'Lizenz', keywords: 'Schlagworte', version: 'Version', domain: 'URN-Domain', publisher: 'Publisher', slug: 'Paket-Slug' }[key]}</dt><dd className="break-words">{value || 'Keine Angabe'}</dd></div>)}</dl>
                <div className="mt-5"><MetadataReview metadata={metadata} /></div>
            </section>
            <Preview preview={preview} />
        </>}
        {pending && step !== 4 && <Pending>Anfrage wird verarbeitet …</Pending>}
        {/* Not twice: once a step shows its merge request, the answer does not repeat the link. */}
        {result && !refused && step !== 4 && <Notice tone={resultTone(result.status)} live
            action={result.mrUrl && result.mrUrl !== known.bundle?.mrUrl && result.mrUrl !== known.catalog?.mrUrl ? <ExternalAnchor href={result.mrUrl}>Merge Request öffnen</ExternalAnchor> : undefined}>
            <p className="whitespace-pre-wrap">{result.detail}</p>
        </Notice>}
        {refused && <div className="flex flex-col gap-3">
            <Notice tone="error" live title={`Das Paket würde die Prüfung nicht bestehen (${refused.errors.length} Fehler)`}><NoticeList items={refused.errors} /></Notice>
            {!!refused.warnings.length && <Notice tone="warn" title="Hinweise aus dem Export"><NoticeList items={refused.warnings} /></Notice>}
        </div>}
    </div>
}

function Preview({ preview }: { preview: NonNullable<ExportActionResult['preview']> }) {
    return (
        <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-medium text-foreground">{preview.manifest.displayName}</span>
                <span className="rounded bg-status-label px-1.5 py-0.5 text-xs">v{preview.manifest.version}</span>
                <span className="break-all text-xs text-muted-foreground">{preview.manifest.id}</span>
                <span className="text-xs text-muted-foreground">
                    → {preview.packageDir}/ · Branch {preview.branch}
                </span>
            </div>

            <p className="text-sm">
                {preview.demo.streams
                    ? `Demo-Daten: ${preview.demo.streams === 1 ? 'ein Datenstrom' : `${preview.demo.streams} Datenströme`} aus dem Simulator. Eine Installation startet sie für ihre eigenen Datenquellen.`
                    : 'Das Paket bringt keine Demo-Daten mit. Nach der Installation fließen erst Daten, wenn eine echte Quelle angebunden ist.'}
            </p>

            {preview.errors.length > 0 && (
                <Notice tone="error" title="Das Paket würde die Prüfung nicht bestehen"><NoticeList items={preview.errors} /></Notice>
            )}
            {preview.warnings.length > 0 && <Notice tone="warn" title="Hinweise aus dem Export"><NoticeList items={preview.warnings} /></Notice>}

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
                            <th className="px-2 py-1 font-medium">Artefakt</th>
                            <th className="px-2 py-1 font-medium">Identität im Paket</th>
                            <th className="px-2 py-1 font-medium">Herkunft</th>
                        </tr>
                    </thead>
                    <tbody>
                        {preview.identities.map((identity) => (
                            <tr key={`${identity.kind}-${identity.to}`} className="border-b last:border-0">
                                <td className="px-2 py-1 text-foreground">
                                    {identity.title} <span className="text-muted-foreground">({identity.kind})</span>
                                </td>
                                <td className="break-all px-2 py-1 font-mono text-muted-foreground">{identity.to}</td>
                                <td className="px-2 py-1 text-muted-foreground">
                                    {identity.kept ? 'aus Katalogpaket, unverändert' : 'beim Export abgeleitet'}
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
                title="Install-Parameter der Zielinstanz"
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
