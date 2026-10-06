'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { ExternalLink, Eye, GitMerge, GitPullRequest, Loader2, RefreshCw } from 'lucide-react'
import { exportAction, inspectExportSource, type ExportActionResult, type ExportIntent } from '@/lib/export-actions'
import type { ExportReadiness, ExportTarget } from '@/lib/export/config'
import type { ExportSource } from '@/lib/export/sources'
import { verificationLabel } from '@/lib/export/labels'
import { draftMetadata, metadataDraft, METADATA_GROUPS, type MetadataDraft } from '@/lib/export/metadata'
import { slugify } from '@/lib/export/urn'
import { catalogEntryPath } from '@/lib/use-case-catalog/path'
import { THEME_LABELS, type Theme } from '@/lib/catalog/vocabulary'
import { MetadataForm } from '@/components/export/metadata-form'

const inputClass = 'w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40'
const STEPS = ['Use Case auswählen', 'Bestand prüfen', 'Steckbrief ergänzen', 'Vorschau & Teilen']
const FEEDBACK_STYLES: Record<ExportActionResult['status'], string> = {
    ok: 'text-success', 'already-open': 'text-warn', unchanged: 'text-warn', 'not-merged': 'text-warn',
    unconfigured: 'text-warn', invalid: 'text-error', error: 'text-error',
}
interface PanelProps {
    sources: ExportSource[]
    sourceNotice?: string
    targets: ExportTarget[]
    readiness: ExportReadiness
    catalogUrl?: string
    defaults: { publisher: string; maintainer: string }
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
    const [active, setActive] = useState('')
    const source = props.sources.find((row) => row.id === active)
    if (!props.sources.length) return <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">Diese Instanz hat noch keinen Use Case, auf den du zugreifen kannst.</p>
    if (source) return <ExportEditor key={source.id} {...props} source={source} onChoose={() => setActive('')} />
    return <div className="flex flex-col gap-6">
        <Steps current={1} />
        <section className="flex flex-col gap-4 rounded-xl border bg-card p-6">
            <h2 className="text-xl font-semibold">Welchen Use Case möchtest du teilen?</h2>
            <p className="text-sm text-muted-foreground">Wähle einen installierten oder selbst erstellten Use Case dieser Instanz.</p>
            {props.sourceNotice && <p className="text-sm text-warn">{props.sourceNotice}</p>}
            <label className="flex flex-col gap-2 text-sm">
                <span>Lokaler Use Case</span>
                <select className={inputClass} value={selection} onChange={(event) => setSelection(event.target.value)}>
                    <option value="">Bitte auswählen …</option>
                    {props.sources.map((row) => <option key={row.id} value={row.id}>{row.catalog?.displayName ?? row.name} · {row.catalog ? `installiert (${row.name})` : 'lokaler Bestand'}</option>)}
                </select>
            </label>
            <button type="button" disabled={!selection} className={`${buttonClass('primary')} self-start`} onClick={() => setActive(selection)}>Bestand prüfen</button>
        </section>
    </div>
}
function ExportEditor({ source, targets, readiness, catalogUrl, defaults, onChoose }: PanelProps & { source: ExportSource; onChoose: () => void }) {
    const [step, setStep] = useState(2)
    const stepHeading = useRef<HTMLHeadingElement>(null)
    useEffect(() => {
        stepHeading.current?.focus()
        stepHeading.current?.scrollIntoView({ block: 'start' })
    }, [step])
    const [inventory, setInventory] = useState<Awaited<ReturnType<typeof inspectExportSource>> | null>(null)
    const [inventoryAttempt, setInventoryAttempt] = useState(0)
    const [pending, startTransition] = useTransition()
    const [result, setResult] = useState<ExportActionResult | null>(null)
    const [preview, setPreview] = useState<ExportActionResult['preview']>()
    const catalog = source.catalog
    // The catalogue's own split, not a fourth regex for it: a looser pattern here
    // seeds a slug the server then rejects, and the author finds out on submit.
    const address = catalog ? catalogEntryPath(catalog.id) : undefined
    const nextVersion = catalog?.version.match(/^(\d+)\.(\d+)\.(\d+)$/)
    const [basics, setBasics] = useState({
        displayName: catalog?.displayName ?? source.name,
        description: catalog?.description ?? source.description ?? '',
        slug: address?.slug ?? slugify(source.name), publisher: address?.publisher ?? defaults.publisher,
        version: nextVersion ? `${nextVersion[1]}.${nextVersion[2]}.${Number(nextVersion[3]) + 1}` : '1.0.0',
        domain: 'general', maintainer: catalog?.maintainer ?? defaults.maintainer,
        license: catalog?.license ?? 'EUPL-1.2', keywords: catalog?.keywords.join(', ') ?? '',
    })
    const [metadata, setMetadata] = useState(() => metadataDraft(catalog?.metadata))
    const [targetKey, setTargetKey] = useState(targets[0]?.key ?? '')
    const forgeReady = readiness === 'ready' && targets.length > 0
    // The catalogue step needs the package on the base branch AND, by tree id, the merged one.
    const bundleReady = result?.bundle?.state === 'on-base' && result.bundle.verification?.state === 'verified'
    useEffect(() => {
        let cancelled = false
        inspectExportSource(source.id).then((value) => { if (!cancelled) setInventory(value) })
            .catch(() => { if (!cancelled) setInventory({ artifacts: [], warnings: [], error: 'Bestand konnte nicht geladen werden. Bitte erneut versuchen.' }) })
        return () => { cancelled = true }
    }, [source.id, inventoryAttempt])
    const run = (intent: ExportIntent) => startTransition(async () => {
        const data = new FormData()
        for (const [key, value] of Object.entries(basics)) data.set(key, value)
        data.set('datasetId', source.id)
        data.set('targetKey', targetKey)
        data.set('catalogMetadata', JSON.stringify(draftMetadata(metadata)))
        data.set('intent', intent)
        try {
            const next = await exportAction(null, data)
            setResult(next)
            if (next.preview) setPreview(next.preview)
            if (intent === 'preview' && next.status === 'ok') setStep(4)
        } catch {
            setResult({ intent, status: 'error', detail: 'Die Anfrage ist fehlgeschlagen. Bitte erneut versuchen.' })
        }
    })
    const editBasics = (key: keyof typeof basics, value: string) => setBasics({ ...basics, [key]: value })
    return <div className="flex flex-col gap-6">
        <Steps current={step} />
        <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm"><span className="text-muted-foreground">Ausgewählt: </span><strong>{source.name}</strong></p>
            <button type="button" disabled={pending} className="text-sm underline disabled:opacity-50" onClick={onChoose}>Andere Auswahl (Eingaben verwerfen)</button>
        </div>
        {step === 2 && <section className="flex flex-col gap-4 rounded-xl border bg-card p-6">
            <h2 ref={stepHeading} tabIndex={-1} className="scroll-mt-20 text-xl font-semibold focus:outline-none">Was wird geteilt?</h2>
            <p className="text-sm text-muted-foreground">Diese Artefakte sind aktuell mit dem Use Case verbunden. Die Vorschau liest den Bestand erneut und zeigt, welche Zugangsdaten entfernt werden.</p>
            {!inventory ? <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" />Bestand wird geladen …</p>
                : inventory.error ? <><p role="alert" className="text-sm text-error">{inventory.error}</p><button type="button" className={buttonClass('secondary')} onClick={() => { setInventory(null); setInventoryAttempt((n) => n + 1) }}>Erneut laden</button></>
                : <>
                    {inventory.artifacts.length ? <ul className="divide-y rounded-lg border px-4">
                        {inventory.artifacts.map((item, index) => <li key={index} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><span className="min-w-0 break-all">{item.name}</span><span className="text-muted-foreground">{item.kind}</span></li>)}
                    </ul> : <p className="text-sm text-warn">Keine verbundenen Artefakte gefunden. Die Vorschau prüft, ob das Paket exportierbar ist.</p>}
                    {!!inventory.warnings.length && <List title="Hinweise zum Bestand" items={inventory.warnings} tone="warn" />}
                    <button type="button" className={`${buttonClass('primary')} self-start`} onClick={() => setStep(3)}>Steckbrief ergänzen</button>
                </>}
        </section>}
        {step === 3 && <form className="flex flex-col gap-6" onSubmit={(event) => { event.preventDefault(); run('preview') }}>
            <div><h2 ref={stepHeading} tabIndex={-1} className="scroll-mt-20 text-xl font-semibold focus:outline-none">Steckbrief ergänzen</h2><p className="mt-1 text-sm text-muted-foreground">Pflichtfelder sind mit * markiert. Weitere Angaben kannst du ergänzen, soweit sie bekannt sind.</p>
                {source.notice && <p className="mt-2 text-sm text-muted-foreground">{source.notice}</p>}</div>
            <fieldset disabled={pending} className="flex flex-col gap-6 disabled:opacity-60">
                <section className="grid gap-4 rounded-xl border bg-card p-5 md:grid-cols-2">
                    <h3 className="font-semibold md:col-span-2">Grundangaben</h3>
                    {([{ key: 'displayName', label: 'Anzeigename *' }, { key: 'maintainer', label: 'Herausgeber / Maintainer *' },
                        { key: 'license', label: 'Lizenz *' }, { key: 'keywords', label: 'Schlagworte (kommagetrennt)' }] as const).map(({ key, label }) =>
                        <label key={key} className="flex flex-col gap-1 text-sm"><span>{label}</span><input className={inputClass} value={basics[key]} required={key !== 'keywords'} onChange={(event) => editBasics(key, event.target.value)} /></label>)}
                    <label className="flex flex-col gap-1 text-sm md:col-span-2"><span>Beschreibung *</span><textarea rows={4} className={inputClass} value={basics.description} required onChange={(event) => editBasics('description', event.target.value)} /></label>
                </section>
                <MetadataForm value={metadata} onChange={setMetadata} />
                <section className="grid gap-4 rounded-xl border bg-card p-5 md:grid-cols-2">
                    <h3 className="font-semibold md:col-span-2">Paket & Veröffentlichung</h3>
                    <p className="text-sm text-muted-foreground md:col-span-2">{catalog ? 'Die nächste Patch-Version ist vorgeschlagen. Für eine eigenständige Variante kannst du Publisher und Paket-Slug ändern.' : 'Lege die Kennung für das neue Paket fest.'}</p>
                    {([{ key: 'publisher', label: 'Publisher *', hint: '2–40 Kleinbuchstaben oder Ziffern.' }, { key: 'slug', label: 'Paket-Slug *', hint: '2–60 Kleinbuchstaben, Ziffern oder Bindestriche, nicht am Rand.' },
                        { key: 'version', label: 'Version *', hint: 'Zum Beispiel 1.0.0.' }, { key: 'domain', label: 'URN-Domain *', hint: 'Zum Beispiel environment, mobility oder general.' }] as const).map(({ key, label, hint }) =>
                        <label key={key} className="flex flex-col gap-1 text-sm"><span>{label}</span><input className={inputClass} value={basics[key]} required onChange={(event) => editBasics(key, event.target.value)} /><span className="text-xs text-muted-foreground">{hint}</span></label>)}
                    <p className="break-all text-xs text-muted-foreground md:col-span-2">Katalog-ID: urn:{basics.publisher}:usecase:{basics.slug}</p>
                    <label className="flex flex-col gap-1 text-sm md:col-span-2"><span>Zielrepository</span><select className={inputClass} value={targetKey} disabled={!targets.length} onChange={(event) => setTargetKey(event.target.value)}>
                        {!targets.length && <option value="">Nicht konfiguriert — Vorschau verfügbar</option>}
                        {targets.map((target) => <option key={target.key} value={target.key}>{target.label} · {target.baseBranch}</option>)}
                    </select></label>
                </section>
                <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass('secondary')} onClick={() => setStep(2)}>Zurück zum Bestand</button>
                    <button type="submit" className={buttonClass('primary')}>{pending ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}Vorschau erstellen</button></div>
            </fieldset>
        </form>}
        {step === 4 && preview && <>
            <div><h2 ref={stepHeading} tabIndex={-1} className="scroll-mt-20 text-xl font-semibold focus:outline-none">Vorschau & Teilen</h2><p className="mt-1 text-sm text-muted-foreground">Prüfe den Steckbrief und das Paket. Zuerst wird das Paket zur Prüfung vorgeschlagen. Nach dessen Merge kann der Katalogeintrag folgen.</p></div>
            <section className="rounded-xl border bg-card p-5">
                <h3 className="text-lg font-semibold">{basics.displayName}</h3><p className="mt-2 whitespace-pre-wrap text-sm">{basics.description}</p>
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">{Object.entries(basics).filter(([key]) => !['displayName', 'description'].includes(key)).map(([key, value]) => <div key={key}><dt className="text-muted-foreground">{{ maintainer: 'Herausgeber', license: 'Lizenz', keywords: 'Schlagworte', version: 'Version', domain: 'URN-Domain', publisher: 'Publisher', slug: 'Paket-Slug' }[key]}</dt><dd className="break-words">{value || 'Keine Angabe'}</dd></div>)}</dl>
                <div className="mt-5"><MetadataReview metadata={metadata} /></div>
            </section>
            <Preview preview={preview} />
            <div className="flex flex-wrap gap-2">
                <button type="button" disabled={pending} className={buttonClass('secondary')} onClick={() => { setStep(3); setResult(null); setPreview(undefined) }}>Steckbrief bearbeiten</button>
                <button type="button" disabled={pending || !forgeReady || !!preview.errors.length} className={buttonClass('primary')} onClick={() => run('bundle')}><GitPullRequest className="size-4" />Bundle-MR erstellen</button>
                <button type="button" disabled={pending || !forgeReady} className={buttonClass('secondary')} onClick={() => run('status')}><RefreshCw className="size-4" />Status prüfen</button>
                <button type="button" disabled={pending || !forgeReady || !catalogUrl || !bundleReady || !!preview.errors.length} className={buttonClass('primary')} onClick={() => run('catalog')}><GitMerge className="size-4" />Katalog-Eintrag vorschlagen</button>
            </div>
            <p className="text-xs text-muted-foreground">Nach dem Paket-Merge „Status prüfen“ wählen, um den Katalogvorschlag freizuschalten. Er geht nur, wenn das Paket auf dem Basisbranch genau dem gemergten Stand entspricht. Später geht das auch unten unter „Geteilte Pakete“, ohne dieses Formular.</p>
        </>}
        {pending && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" />Anfrage wird verarbeitet …</p>}
        {result && <div role={result.status === 'invalid' || result.status === 'error' ? 'alert' : 'status'} className={`whitespace-pre-wrap text-sm ${FEEDBACK_STYLES[result.status]}`}><p>{result.detail}</p>
            {result.mrUrl && <a href={result.mrUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 underline">Merge Request öffnen<ExternalLink className="size-3" /></a>}
        </div>}
        {step === 3 && result?.preview && !!result.preview.errors.length && <List title="Paketprüfung" items={result.preview.errors} tone="error" />}
        {result?.bundle && <div className="flex flex-wrap gap-2 text-xs"><Badge label={`Bundle: ${bundleLabel(result.bundle.state)}`} url={result.bundle.mrUrl} />{result.bundle.verification && <Badge label={`Prüfung: ${verificationLabel(result.bundle.verification)}`} url={result.bundle.verification.mergedMrUrl} />}{result.catalog && <Badge label={`Katalog: ${catalogLabel(result.catalog.state)}`} url={result.catalog.mrUrl} />}</div>}
    </div>
}

function buttonClass(kind: 'primary' | 'secondary'): string {
    const base = 'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-opacity disabled:opacity-50'
    return kind === 'primary'
        ? `${base} bg-primary text-primary-foreground hover:opacity-90`
        : `${base} border text-foreground hover:bg-muted`
}

function bundleLabel(state: string): string {
    return state === 'mr-open' ? 'MR offen' : state === 'on-base' ? 'auf dem Basisbranch' : 'nicht vorhanden'
}

function catalogLabel(state: string): string {
    return state === 'listed'
        ? 'gelistet'
        : state === 'mr-open'
          ? 'MR offen'
          : state === 'unconfigured'
            ? 'nicht konfiguriert'
            : 'nicht gelistet'
}

function Badge({ label, url }: { label: string; url?: string }) {
    const content = <span className="rounded-md bg-muted px-2 py-1 text-muted-foreground">{label}</span>
    return url ? (
        <a href={url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
            {content}
        </a>
    ) : (
        content
    )
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

            {preview.errors.length > 0 && (
                <List title="Validierung schlägt fehl" items={preview.errors} tone="error" />
            )}
            {preview.warnings.length > 0 && <List title="Hinweise aus dem Export" items={preview.warnings} tone="warn" />}

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
                tone="muted"
            />
            <List
                title="Install-Parameter der Zielinstanz"
                items={
                    preview.parameters.length
                        ? preview.parameters.map((p) => `${p.file}: ${p.fields.join(', ')}`)
                        : ['keine']
                }
                tone="muted"
            />
        </div>
    )
}

function List({ title, items, tone }: { title: string; items: string[]; tone: 'error' | 'warn' | 'muted' }) {
    const color = tone === 'error' ? 'text-error' : tone === 'warn' ? 'text-warn' : 'text-muted-foreground'
    return (
        <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
            <ul className={`mt-1 list-disc pl-5 text-xs ${color}`}>
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
