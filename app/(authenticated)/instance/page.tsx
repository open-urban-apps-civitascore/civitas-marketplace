import { getAccessToken, requireSession } from '@/lib/session'

interface DataStructureRow {
    id: string
    name: string
    description?: string
    dataStructureStatus?: string
}

/**
 * What is actually in the platform right now — read live from the portal
 * backend through the gateway (so OPA scopes the list to the signed-in user).
 * Deliberately NOT called "installed": this list contains everything in the
 * instance, including structures created manually in the portal. Marketplace
 * installs live on /installed, backed by the backend's install provenance.
 */
export default async function InstancePage() {
    await requireSession()
    const accessToken = await getAccessToken()

    const res = await fetch(
        `${process.env.API_BASE_URL}:${process.env.API_PORT}/v1/datastructures`,
        {
            headers: { Authorization: `Bearer ${accessToken}` },
            cache: 'no-store',
        },
    )

    if (!res.ok) {
        return (
            <div className="flex flex-col gap-6">
                <h1>In der Instanz vorhanden</h1>
                <p className="rounded-lg border border-error/40 bg-error/5 px-4 py-3 text-sm text-error">
                    Backend antwortet mit {res.status} {res.statusText}
                </p>
            </div>
        )
    }

    const page = (await res.json()) as { content?: DataStructureRow[] }
    const rows = page.content ?? []

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1>In der Instanz vorhanden</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Alle Datenstrukturen dieser CIVITAS-Instanz — live aus dem Portal-Backend,
                    gefiltert auf deine Berechtigungen. Auch manuell angelegte, nicht nur
                    Marketplace-Installationen.
                </p>
            </div>

            {rows.length === 0 ? (
                <p className="rounded-lg border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
                    Keine Datenstrukturen vorhanden.
                </p>
            ) : (
                <div className="overflow-hidden rounded-xl border bg-card">
                    <table className="w-full text-sm">
                        <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                            <tr>
                                <th className="px-4 py-2.5 font-medium">Name</th>
                                <th className="px-4 py-2.5 font-medium">Beschreibung</th>
                                <th className="px-4 py-2.5 font-medium">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => (
                                <tr key={row.id} className="border-b last:border-0">
                                    <td className="px-4 py-2.5 font-medium text-foreground">
                                        {row.name}
                                    </td>
                                    <td className="px-4 py-2.5 text-muted-foreground">
                                        {row.description ?? '—'}
                                    </td>
                                    <td className="px-4 py-2.5">
                                        <span className="rounded bg-status-label px-1.5 py-0.5 text-xs">
                                            {row.dataStructureStatus ?? 'DRAFT'}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}
