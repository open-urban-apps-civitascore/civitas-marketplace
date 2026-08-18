import { UninstallButton } from '@/components/installed/uninstall-button'
import { getAccessToken, requireSession } from '@/lib/session'

interface InstalledArtifactRow {
    artifactType:
        | 'DATA_STRUCTURE'
        | 'DATA_SOURCE'
        | 'MAPPING'
        | 'DATA_SET'
        | 'DATA_SINK'
        | 'PIPELINE'
        | string
    name?: string
    shellId?: string
    urn?: string
    action: 'CREATED' | 'REUSED' | string
}

interface InstallationRow {
    id: string
    createdAt: string
    /** Set when the installation was uninstalled; the record stays as history. */
    uninstalledAt?: string | null
    bundleId?: string
    bundleVersion?: string
    dataSetId?: string
    dataSetName?: string
    installedBy?: string
    artifacts: InstalledArtifactRow[]
}

const ARTIFACT_TYPE_LABELS: Record<string, string> = {
    DATA_STRUCTURE: 'Datenstruktur',
    DATA_SOURCE: 'Datenquelle',
    MAPPING: 'Mapping',
    DATA_SET: 'Dataset',
    DATA_SINK: 'Datensenke',
    PIPELINE: 'Pipeline',
}

const ACTION_LABELS: Record<string, string> = {
    CREATED: 'neu angelegt',
    REUSED: 'wiederverwendet',
}

const dateFormat = new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Berlin',
})

/**
 * True marketplace installs — the backend's install provenance
 * (GET /v1/installations): which catalogue entry, when, by whom, and what each
 * install created or reused. Both use-case bundles and single data structures
 * record one. Manually created artifacts never show up here; the full instance
 * inventory lives on /instance.
 */
export default async function InstalledPage() {
    await requireSession()
    const accessToken = await getAccessToken()

    const res = await fetch(
        `${process.env.API_BASE_URL}:${process.env.API_PORT}/v1/installations`,
        {
            headers: { Authorization: `Bearer ${accessToken}` },
            cache: 'no-store',
        },
    )

    if (!res.ok) {
        return (
            <div className="flex flex-col gap-6">
                <h1>Installiert</h1>
                <p className="rounded-lg border border-error/40 bg-error/5 px-4 py-3 text-sm text-error">
                    Backend antwortet mit {res.status} {res.statusText}
                    {res.status === 403 &&
                        ' — fehlt der Rolle die Berechtigung INSTALLATION_READ?'}
                </p>
            </div>
        )
    }

    const page = (await res.json()) as { content?: InstallationRow[]; totalElements?: number }
    const installations = page.content ?? []

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1>Installiert</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Über den Marketplace installierte Bundles — Provenienz aus dem
                    Portal-Backend: wer hat wann was installiert, und was wurde dabei angelegt
                    oder wiederverwendet.
                </p>
            </div>

            {installations.length === 0 ? (
                <p className="rounded-lg border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
                    Noch nichts installiert.
                </p>
            ) : (
                installations.map((installation) => (
                    <div
                        key={installation.id}
                        className="overflow-hidden rounded-xl border bg-card"
                    >
                        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b bg-muted/50 px-4 py-3">
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                <span className="font-medium text-foreground">
                                    {installation.dataSetName ?? installation.bundleId ?? '—'}
                                </span>
                                {installation.bundleVersion && (
                                    <span className="rounded bg-status-label px-1.5 py-0.5 text-xs">
                                        v{installation.bundleVersion}
                                    </span>
                                )}
                                {installation.bundleId && (
                                    <span className="break-all text-xs text-muted-foreground">
                                        {installation.bundleId}
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="text-xs text-muted-foreground">
                                    {dateFormat.format(new Date(installation.createdAt))}
                                    {installation.installedBy && (
                                        <span title={installation.installedBy}>
                                            {' · von '}
                                            {installation.installedBy.slice(0, 8)}
                                        </span>
                                    )}
                                </div>
                                {installation.uninstalledAt ? (
                                    <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                                        Deinstalliert{' '}
                                        {dateFormat.format(new Date(installation.uninstalledAt))}
                                    </span>
                                ) : (
                                    <UninstallButton installationId={installation.id} />
                                )}
                            </div>
                        </div>

                        <table className="w-full text-sm">
                            <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                                <tr>
                                    <th className="px-4 py-2 font-medium">Typ</th>
                                    <th className="px-4 py-2 font-medium">Name</th>
                                    <th className="px-4 py-2 font-medium">URN</th>
                                    <th className="px-4 py-2 font-medium">Aktion</th>
                                </tr>
                            </thead>
                            <tbody>
                                {installation.artifacts.map((artifact, index) => (
                                    <tr
                                        key={`${installation.id}-${index}`}
                                        className="border-b last:border-0"
                                    >
                                        <td className="px-4 py-2 text-muted-foreground">
                                            {ARTIFACT_TYPE_LABELS[artifact.artifactType] ??
                                                artifact.artifactType}
                                        </td>
                                        <td className="px-4 py-2 font-medium text-foreground">
                                            {artifact.name ?? '—'}
                                        </td>
                                        <td className="break-all px-4 py-2 text-xs text-muted-foreground">
                                            {artifact.urn ?? '—'}
                                        </td>
                                        <td className="px-4 py-2">
                                            <span
                                                className={
                                                    artifact.action === 'CREATED'
                                                        ? 'rounded bg-success/10 px-1.5 py-0.5 text-xs text-success'
                                                        : 'rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground'
                                                }
                                            >
                                                {ACTION_LABELS[artifact.action] ?? artifact.action}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ))
            )}
        </div>
    )
}
