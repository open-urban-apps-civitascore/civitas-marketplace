import { AddonListingCard } from '@/components/catalog/addon-listing-card'
import { CatalogFreshness } from '@/components/catalog/catalog-freshness'
import { Code } from '@/components/catalog/code'
import { listAddons } from '@/lib/addon-catalog'
import { getCatalogMeta } from '@/lib/catalog/source'
import { deploymentRepoConfig, forgeReadiness, type ForgeReadiness } from '@/lib/deployment-repo/config'
import { requireSession } from '@/lib/session'

const READINESS_HINT: Record<ForgeReadiness, string | null> = {
    ready: null,
    'missing-repo':
        'Für diese Instanz ist kein Deployment-Repository hinterlegt (DEPLOYMENT_REPO). Vorschläge lassen sich trotzdem erzeugen und einsehen – sie können dann manuell übernommen werden.',
    'missing-token':
        'Es fehlt nur noch der Zugang (DEPLOYMENT_REPO_TOKEN) – bis dahin wird die Änderung erzeugt und angezeigt, aber kein Pull Request geöffnet.',
}

export default async function AddonsPage() {
    await requireSession()

    const [{ addons, skipped }, meta] = await Promise.all([listAddons(), getCatalogMeta()])
    const curated = addons.filter((entry) => entry.missingForInstall.length === 0)
    const ecosystem = addons.filter((entry) => entry.missingForInstall.length > 0)
    const config = deploymentRepoConfig()
    const readinessHint = READINESS_HINT[forgeReadiness(config)]

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1>Add-ons</h1>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                    Eigenständige Anwendungen, die zu Ihrer Instanz gehören. Der Marktplatz kann sie
                    nicht selbst installieren – er bereitet die nötige Änderung vor, freigegeben und
                    ausgerollt wird sie vom Betrieb.
                </p>
                <div className="mt-2">
                    <CatalogFreshness meta={meta} />
                </div>
            </div>

            {(readinessHint || skipped > 0 || config.repo) && (
                <section className="flex flex-col gap-1.5 rounded-lg border bg-card p-4 text-sm text-muted-foreground">
                    {config.repo && (
                        <p>
                            Ziel für Vorschläge: <Code>{config.repo}</Code> auf Branch{' '}
                            <Code>{config.baseBranch}</Code>, Umgebung <Code>{config.environment}</Code>.
                        </p>
                    )}
                    {readinessHint && <p>{readinessHint}</p>}
                    {skipped > 0 && (
                        <p>
                            {skipped} {skipped === 1 ? 'Eintrag' : 'Einträge'} aus dem Katalog konnten
                            nicht gelesen werden und fehlen in der Liste.
                        </p>
                    )}
                </section>
            )}

            {curated.length > 0 && (
                <section className="flex flex-col gap-3">
                    <div>
                        <h2 className="text-lg font-semibold text-foreground">
                            Für CIVITAS/CORE v2 kuratiert
                        </h2>
                        <p className="text-sm text-muted-foreground">
                            Geprüft, auf eine feste Version festgelegt und über den Marktplatz
                            vorschlagbar.
                        </p>
                    </div>
                    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                        {curated.map((entry) => (
                            <AddonListingCard key={entry.listing.id} entry={entry} />
                        ))}
                    </div>
                </section>
            )}

            {ecosystem.length > 0 && (
                <section className="flex flex-col gap-3">
                    <div>
                        <h2 className="text-lg font-semibold text-foreground">
                            Weitere Add-ons im Ökosystem
                        </h2>
                        <p className="max-w-3xl text-sm text-muted-foreground">
                            Diese Add-ons gibt es bereits, sie sind aber noch nicht für v2
                            paketiert: es fehlen die Angaben, die eine Installation über den
                            Marktplatz möglich machen. Sie stehen hier, damit sichtbar ist, was
                            der Katalog als Nächstes aufnehmen kann.
                        </p>
                    </div>
                    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                        {ecosystem.map((entry) => (
                            <AddonListingCard key={entry.listing.id} entry={entry} />
                        ))}
                    </div>
                </section>
            )}

            {addons.length === 0 && (
                <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
                    Keine Add-ons verfügbar.
                </div>
            )}
        </div>
    )
}
