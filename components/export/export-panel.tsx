'use client'

import { useActionState, useState } from 'react'
import { ExternalLink, Eye, GitMerge, GitPullRequest, Loader2, RefreshCw } from 'lucide-react'

import { exportAction, type ExportActionResult } from '@/lib/export-actions'
import type { ExportReadiness, ExportTarget } from '@/lib/export/config'
import type { DatasetListing } from '@/lib/export/portal-reader'
import { slugify } from '@/lib/export/urn'

const FEEDBACK_STYLES: Record<ExportActionResult['status'], string> = {
    ok: 'text-success',
    'already-open': 'text-warn',
    unchanged: 'text-warn',
    'not-merged': 'text-warn',
    unconfigured: 'text-warn',
    invalid: 'text-error',
    error: 'text-error',
}

const inputClass =
    'w-full rounded-md border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40'
const labelClass = 'flex flex-col gap-1 text-xs font-medium text-muted-foreground'

function Field({
    label,
    name,
    value,
    onChange,
    hint,
    required,
}: {
    label: string
    name: string
    value: string
    onChange: (value: string) => void
    hint?: string
    required?: boolean
}) {
    return (
        <label className={labelClass}>
            <span>{label}</span>
            <input
                name={name}
                value={value}
                required={required}
                onChange={(event) => onChange(event.target.value)}
                className={inputClass}
            />
            {hint && <span className="font-normal">{hint}</span>}
        </label>
    )
}

/**
 * One form, four submit buttons: preview, propose the bundle, re-read the
 * status, propose the catalogue entry. The button's `name=intent` travels in
 * the FormData, so a single server action serves all four without four copies
 * of the field handling.
 *
 * The catalogue step is a SECOND merge request by design: its entry pins the
 * merged commit, which does not exist before the bundle merge request is
 * merged. The status is read fresh from GitLab on every click - no timer, no
 * bookkeeping in the marketplace.
 */
export function ExportPanel({
    datasets,
    targets,
    readiness,
    catalogUrl,
    defaults,
}: {
    datasets: DatasetListing[]
    targets: ExportTarget[]
    readiness: ExportReadiness
    catalogUrl?: string
    defaults: { publisher: string; maintainer: string }
}) {
    const [result, formAction, pending] = useActionState(exportAction, null)
    const [datasetId, setDatasetId] = useState(datasets[0]?.id ?? '')
    const [slug, setSlug] = useState(datasets[0] ? slugify(datasets[0].name) : '')
    const [displayName, setDisplayName] = useState(datasets[0]?.name ?? '')
    const [description, setDescription] = useState(datasets[0]?.description ?? '')
    const [publisher, setPublisher] = useState(defaults.publisher)
    const [version, setVersion] = useState('1.0.0')
    const [domain, setDomain] = useState('general')
    const [maintainer, setMaintainer] = useState(defaults.maintainer)
    const [license, setLicense] = useState('EUPL-1.2')
    const [keywords, setKeywords] = useState('')
    const [touched, setTouched] = useState(false)

    const forgeReady = readiness === 'ready' && targets.length > 0
    const bundleOnBase = result?.bundle?.state === 'on-base'

    const chooseDataset = (id: string) => {
        setDatasetId(id)
        const dataset = datasets.find((d) => d.id === id)
        // Pre-fill from the dataset until the user edited a field; afterwards their text wins.
        if (dataset && !touched) {
            setSlug(slugify(dataset.name))
            setDisplayName(dataset.name)
            setDescription(dataset.description ?? '')
        }
    }
    const edit = (setter: (value: string) => void) => (value: string) => {
        setTouched(true)
        setter(value)
    }

    if (datasets.length === 0) {
        return (
            <p className="rounded-lg border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
                Diese Instanz hat kein Dataset, das du lesen darfst - nichts zu exportieren.
            </p>
        )
    }

    return (
        <form action={formAction} className="flex flex-col gap-6">
            <section className="grid gap-4 rounded-xl border bg-card p-4 md:grid-cols-2">
                <label className={`${labelClass} md:col-span-2`}>
                    <span>Dataset</span>
                    <select
                        name="datasetId"
                        value={datasetId}
                        onChange={(event) => chooseDataset(event.target.value)}
                        className={inputClass}
                    >
                        {datasets.map((dataset) => (
                            <option key={dataset.id} value={dataset.id}>
                                {dataset.name}
                                {dataset.status ? ` (${dataset.status})` : ''}
                            </option>
                        ))}
                    </select>
                </label>
                <label className={`${labelClass} md:col-span-2`}>
                    <span>Zielrepository</span>
                    <select name="targetKey" className={inputClass} disabled={targets.length === 0}>
                        {targets.length === 0 ? (
                            <option value="">nicht konfiguriert</option>
                        ) : (
                            targets.map((target) => (
                                <option key={target.key} value={target.key}>
                                    {target.label} - {target.pathPrefix === '.' ? '/' : `${target.pathPrefix}/`}
                                    &lt;slug&gt; auf {target.baseBranch}
                                </option>
                            ))
                        )}
                    </select>
                </label>
                <Field label="Anzeigename" name="displayName" value={displayName} onChange={edit(setDisplayName)} required />
                <Field
                    label="Paket-Slug"
                    name="slug"
                    value={slug}
                    onChange={edit(setSlug)}
                    hint="Ordnername und Teil der Katalog-ID: urn:<publisher>:usecase:<slug>"
                    required
                />
                <label className={`${labelClass} md:col-span-2`}>
                    <span>Beschreibung</span>
                    <textarea
                        name="description"
                        value={description}
                        onChange={(event) => edit(setDescription)(event.target.value)}
                        rows={3}
                        required
                        className={inputClass}
                    />
                </label>
                <Field
                    label="Publisher"
                    name="publisher"
                    value={publisher}
                    onChange={edit(setPublisher)}
                    hint="Wird URN-Owner der neu identifizierten Artefakte (Kleinbuchstaben, Ziffern)"
                    required
                />
                <Field label="Version" name="version" value={version} onChange={edit(setVersion)} hint="SemVer, z. B. 1.0.0" />
                <Field label="URN-Domain" name="domain" value={domain} onChange={edit(setDomain)} hint="z. B. environment, mobility, general" />
                <Field label="Maintainer" name="maintainer" value={maintainer} onChange={edit(setMaintainer)} required />
                <Field label="Lizenz" name="license" value={license} onChange={edit(setLicense)} />
                <Field label="Schlagworte" name="keywords" value={keywords} onChange={edit(setKeywords)} hint="kommagetrennt, klein, ohne Umlaute (Katalog-Schlüssel)" />
            </section>

            <div className="flex flex-wrap items-center gap-2">
                <button type="submit" name="intent" value="preview" disabled={pending} className={buttonClass('secondary')}>
                    {pending ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
                    Vorschau
                </button>
                <button type="submit" name="intent" value="bundle" disabled={pending || !forgeReady} className={buttonClass('primary')}>
                    {pending ? <Loader2 className="size-4 animate-spin" /> : <GitPullRequest className="size-4" />}
                    Bundle-MR erstellen
                </button>
                <button type="submit" name="intent" value="status" disabled={pending || !forgeReady} className={buttonClass('secondary')}>
                    {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                    Status prüfen
                </button>
                <button
                    type="submit"
                    name="intent"
                    value="catalog"
                    disabled={pending || !forgeReady || !catalogUrl}
                    title={
                        !catalogUrl
                            ? 'Kein Katalog-Repository konfiguriert'
                            : bundleOnBase
                              ? undefined
                              : 'Erst „Status prüfen": der Eintrag pinnt den gemergten Commit'
                    }
                    className={buttonClass(bundleOnBase ? 'primary' : 'secondary')}
                >
                    {pending ? <Loader2 className="size-4 animate-spin" /> : <GitMerge className="size-4" />}
                    Katalog-Eintrag vorschlagen
                </button>
            </div>

            {result && (
                <div className={`flex flex-col gap-1 text-sm leading-relaxed ${FEEDBACK_STYLES[result.status]}`}>
                    <p>{result.detail}</p>
                    {result.mrUrl && (
                        <a href={result.mrUrl} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 font-medium underline underline-offset-2">
                            Merge Request öffnen
                            <ExternalLink className="size-3" />
                        </a>
                    )}
                </div>
            )}

            {result?.bundle && (
                <div className="flex flex-wrap gap-2 text-xs">
                    <Badge label={`Bundle: ${bundleLabel(result.bundle.state)}`} url={result.bundle.mrUrl} />
                    {result.catalog && <Badge label={`Katalog: ${catalogLabel(result.catalog.state)}`} url={result.catalog.mrUrl} />}
                </div>
            )}

            {result?.preview && <Preview preview={result.preview} />}
        </form>
    )
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
