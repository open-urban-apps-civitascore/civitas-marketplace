import { AddonListingCard } from '@/components/catalog/addon-listing-card'
import { Code } from '@/components/catalog/code'
import { listAddons, type CatalogState } from '@/lib/addon-catalog'
import { deploymentRepoConfig, forgeReadiness, type ForgeReadiness } from '@/lib/deployment-repo/config'
import { requireSession } from '@/lib/session'

const READINESS_HINT: Record<ForgeReadiness, string | null> = {
    ready: null,
    'missing-repo':
        'Für diese Instanz ist kein Deployment-Repository hinterlegt (DEPLOYMENT_REPO). Vorschläge lassen sich trotzdem erzeugen und einsehen – sie können dann manuell übernommen werden.',
    'missing-token':
        'Es fehlt nur noch der Zugang (DEPLOYMENT_REPO_TOKEN) – bis dahin wird die Änderung erzeugt und angezeigt, aber kein Pull Request geöffnet.',
}

const CATALOG_HINT: Record<CatalogState, string | null> = {
    ok: null,
    unconfigured:
        'Es ist kein Katalog hinterlegt (ADDON_CATALOG_URL). Gezeigt wird nur das mitgelieferte Beispiel-Add-on.',
    unreachable:
        'Der Katalog ist derzeit nicht erreichbar und wurde auch noch nie erfolgreich gelesen – deshalb steht hier nur das mitgelieferte Beispiel.',
    stale: 'Der Katalog ist gerade nicht erreichbar. Gezeigt wird der zuletzt gelesene Stand.',
    incompatible:
        'Der Katalog verwendet ein neueres Format, als diese Anwendung lesen kann — nicht der Katalog ist veraltet, sondern der Marktplatz. Bis zum Update wird nur das mitgelieferte Beispiel gezeigt.',
}

function formatTimestamp(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export default async function AddonsPage() {
    await requireSession()

    const { addons, state, url, fetchedAt, error, skipped } = await listAddons()
    const config = deploymentRepoConfig()
    const readiness = forgeReadiness(config)

    const catalogHint = CATALOG_HINT[state]
    const readinessHint = READINESS_HINT[readiness]

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1>Add-ons</h1>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                    Eigenständige Anwendungen, die zu Ihrer Instanz gehören. Der Marktplatz kann sie
                    nicht selbst installieren – er bereitet die nötige Änderung vor, freigegeben und
                    ausgerollt wird sie vom Betrieb.
                </p>
            </div>

            <section
                className={`flex flex-col gap-1.5 rounded-lg border p-4 text-sm text-muted-foreground ${
                    catalogHint || readinessHint ? 'border-warn/40 bg-warn/5' : 'bg-card'
                }`}
            >
                {url && (
                    <p>
                        Katalog: <Code>{url}</Code>
                        {fetchedAt && ` · gelesen ${formatTimestamp(fetchedAt)}`}
                    </p>
                )}
                {catalogHint && <p>{catalogHint}</p>}
                {error && (state === 'stale' || state === 'incompatible') && (
                    <p>Letzter Fehler: {error}</p>
                )}
                {skipped > 0 && (
                    <p>
                        {skipped} {skipped === 1 ? 'Eintrag' : 'Einträge'} aus dem Katalog konnten
                        nicht gelesen werden und fehlen in der Liste.
                    </p>
                )}
                {config.repo && (
                    <p>
                        Ziel für Vorschläge: <Code>{config.repo}</Code> auf Branch{' '}
                        <Code>{config.baseBranch}</Code>, Umgebung <Code>{config.environment}</Code>.
                    </p>
                )}
                {readinessHint && <p>{readinessHint}</p>}
            </section>

            {addons.length > 0 ? (
                <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                    {addons.map((entry) => (
                        <AddonListingCard key={entry.listing.id} entry={entry} />
                    ))}
                </div>
            ) : (
                <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
                    Keine Add-ons verfügbar.
                </div>
            )}
        </div>
    )
}
