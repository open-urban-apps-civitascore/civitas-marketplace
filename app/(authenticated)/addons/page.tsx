import { AddonChangePreview } from '@/components/catalog/addon-change-preview'
import { AddonInstallButton } from '@/components/catalog/addon-install-button'
import { CatalogCard } from '@/components/catalog/catalog-card'
import { Code } from '@/components/catalog/code'
import { mockAddonCatalog } from '@/lib/addon-catalog'
import {
    deploymentRepoConfig,
    environmentFilePath,
    forgeReadiness,
    type ForgeReadiness,
} from '@/lib/deployment-repo/config'
import { requireSession } from '@/lib/session'

const READINESS_HINT: Record<ForgeReadiness, string | null> = {
    ready: null,
    'missing-repo':
        'Für diese Instanz ist kein Deployment-Repository hinterlegt (DEPLOYMENT_REPO). Vorschläge lassen sich trotzdem erzeugen und unten einsehen – sie können dann manuell übernommen werden.',
    'missing-token':
        'Es fehlt nur noch der Zugang (DEPLOYMENT_REPO_TOKEN) – bis dahin wird die Änderung erzeugt und angezeigt, aber kein Pull Request geöffnet.',
}

export default async function AddonsPage() {
    await requireSession()
    const config = deploymentRepoConfig()
    const readiness = forgeReadiness(config)
    const hint = READINESS_HINT[readiness]
    const registrationPath = environmentFilePath(config)

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
                    hint ? 'border-warn/40 bg-warn/5' : 'bg-card'
                }`}
            >
                {config.repo && (
                    <p>
                        Ziel: <Code>{config.repo}</Code> auf Branch <Code>{config.baseBranch}</Code>,
                        Umgebung <Code>{config.environment}</Code>.
                    </p>
                )}
                {hint && <p>{hint}</p>}
            </section>

            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {mockAddonCatalog.map((entry) => (
                    <CatalogCard
                        key={entry.manifest.id}
                        manifest={entry.manifest}
                        action={
                            <div className="flex flex-col gap-3">
                                <AddonInstallButton entryId={entry.manifest.id} />
                                <AddonChangePreview
                                    entry={entry}
                                    registrationPath={registrationPath}
                                />
                            </div>
                        }
                    />
                ))}
            </div>
        </div>
    )
}
