import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
    Archive,
    ArrowLeft,
    BookOpen,
    CircleAlert,
    ExternalLink,
    GitBranch,
    Globe,
    Package,
    ServerCog,
    ShieldCheck,
} from 'lucide-react'

import { AddonInstallButton } from '@/components/catalog/addon-install-button'
import { Code } from '@/components/catalog/code'
import { CurationTierBadge, curationHint } from '@/components/catalog/curation-tier'
import { findAddonListing, findBundledEntry, originLabel } from '@/lib/addon-catalog'
import { addonDir, componentLine, composeAddonInstall } from '@/lib/deployment-repo/compose'
import { deploymentRepoConfig, environmentFilePath, forgeReadiness } from '@/lib/deployment-repo/config'
import { asTextPackage } from '@/lib/package-file'
import { requireSession } from '@/lib/session'

export default async function AddonDetailPage({ params }: { params: Promise<{ id: string }> }) {
    await requireSession()

    const { id } = await params
    const entry = await findAddonListing(id)
    if (!entry) notFound()

    const { listing, missingForInstall } = entry
    const installable = missingForInstall.length === 0
    const config = deploymentRepoConfig()
    const registrationPath = environmentFilePath(config)
    const forge = forgeReadiness(config)

    const bundled = findBundledEntry(listing.id)
    const composed =
        bundled && listing.install
            ? composeAddonInstall(
                  {
                      componentName: listing.install.componentName,
                      subdomain: listing.install.subdomain,
                      displayName: listing.displayName,
                      description: listing.summary,
                      publisher: listing.publisher,
                      files: asTextPackage(bundled.files),
                  },
                  config,
              )
            : undefined

    return (
        <div className="flex max-w-4xl flex-col gap-6">
            <Link
                href="/addons"
                className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
                <ArrowLeft className="size-4" />
                Zurück zu den Add-ons
            </Link>

            {listing.deprecated && (
                <div className="flex items-start gap-3 rounded-lg border border-warn/40 bg-warn/5 p-4 text-sm">
                    <Archive aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" />
                    <div>
                        <p className="font-semibold text-foreground">
                            Dieser Eintrag ist veraltet
                        </p>
                        <p className="mt-0.5 text-muted-foreground">{listing.deprecated.reason}</p>
                        {listing.deprecated.successorId && (
                            <p className="mt-1.5">
                                <Link
                                    href={`/addons/${listing.deprecated.successorId}`}
                                    className="font-medium text-primary underline-offset-2 hover:underline"
                                >
                                    Empfohlener Nachfolger ansehen
                                </Link>
                            </p>
                        )}
                        <p className="mt-1.5 text-muted-foreground">
                            Eine Installation lässt sich nicht mehr vorschlagen. Instanzen, die das
                            Add-on bereits betreiben, sind davon nicht betroffen.
                        </p>
                    </div>
                </div>
            )}

            <header className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        Add-on
                    </span>
                    <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        {originLabel(listing)}
                    </span>
                    {listing.categories.map((category) => (
                        <span
                            key={category}
                            className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                        >
                            {category}
                        </span>
                    ))}
                </div>
                <h1>{listing.displayName}</h1>
                <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
                    {listing.summary}
                </p>
                {listing.description && (
                    <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
                        {listing.description}
                    </p>
                )}

                <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                    <div className="flex gap-1.5">
                        <dt>Herausgeber:</dt>
                        <dd className="font-medium text-foreground">{listing.publisher}</dd>
                    </div>
                    {listing.install?.source.kind === 'repository' && (
                        <div className="flex gap-1.5">
                            <dt>Gelistete Version:</dt>
                            <dd className="font-mono text-xs font-medium text-foreground">
                                {listing.install.source.ref.refType === 'tag'
                                    ? listing.install.source.ref.ref
                                    : listing.install.source.ref.ref.slice(0, 12)}
                            </dd>
                        </div>
                    )}
                    {listing.license && (
                        <div className="flex gap-1.5">
                            <dt>Lizenz:</dt>
                            <dd className="font-medium text-foreground">{listing.license}</dd>
                        </div>
                    )}
                    {listing.wrappedTool && (
                        <div className="flex gap-1.5">
                            <dt>Basiert auf:</dt>
                            <dd className="font-medium text-foreground">
                                {listing.wrappedTool.homepage ? (
                                    <a
                                        href={listing.wrappedTool.homepage}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="underline-offset-2 hover:underline"
                                    >
                                        {listing.wrappedTool.name}
                                    </a>
                                ) : (
                                    listing.wrappedTool.name
                                )}
                                {listing.wrappedTool.license && ` (${listing.wrappedTool.license})`}
                            </dd>
                        </div>
                    )}
                </dl>

                {listing.curation && (
                    <div className="rounded-lg border bg-card p-4 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                            <CurationTierBadge tier={listing.curation.tier} />
                            <span className="text-muted-foreground">
                                {curationHint(listing.curation.tier)}
                            </span>
                        </div>
                        {listing.curation.notes && (
                            <p className="mt-2 text-muted-foreground">{listing.curation.notes}</p>
                        )}
                        <p className="mt-2 text-xs text-muted-foreground">
                            Geprüft von {listing.curation.reviewedBy} am{' '}
                            {listing.curation.reviewedAt}
                        </p>
                    </div>
                )}

                <div className="flex flex-wrap gap-4 text-sm">
                    {listing.install?.source.kind === 'repository' && (
                        <a
                            href={`https://gitlab.com/${listing.install.source.ref.project}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-primary underline-offset-2 hover:underline"
                        >
                            <GitBranch className="size-4" />
                            Repository
                            <ExternalLink className="size-3" />
                        </a>
                    )}
                    {listing.links.documentation && (
                        <a
                            href={listing.links.documentation}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-primary underline-offset-2 hover:underline"
                        >
                            <BookOpen className="size-4" />
                            Dokumentation
                            <ExternalLink className="size-3" />
                        </a>
                    )}
                </div>
            </header>

            {/* What the maintainer declares about fit — never a computed claim:
                this app does not know the instance's Core version. */}
            <section className="flex flex-col gap-3 rounded-lg border bg-card p-5">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <ServerCog className="size-4 text-muted-foreground" />
                    Voraussetzungen
                </h2>

                <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                    <p>
                        Unterstützte CivitasCore-Versionen:{' '}
                        {listing.compatibleCoreVersions.length > 0 ? (
                            <span className="font-medium text-foreground">
                                {listing.compatibleCoreVersions.join(', ')}
                            </span>
                        ) : (
                            <span>vom Herausgeber nicht angegeben</span>
                        )}
                    </p>
                    {listing.curation && <p>Zuletzt geprüft: {listing.curation.reviewedAt}</p>}
                </div>

                <div>
                    <p className="text-sm text-muted-foreground">Braucht von der Plattform:</p>
                    {listing.platformNeeds.length > 0 ? (
                        <ul className="mt-2 flex flex-wrap gap-1.5">
                            {listing.platformNeeds.map((need) => (
                                <li
                                    key={need}
                                    className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-foreground"
                                >
                                    {need}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="mt-1 text-sm text-muted-foreground">
                            Keine besonderen Anforderungen angegeben.
                        </p>
                    )}
                </div>
            </section>

            {/* The install surface: what lands in the deployment repository. */}
            <section className="flex flex-col gap-3 rounded-lg border bg-card p-5">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Package className="size-4 text-muted-foreground" />
                    Was bei einer Installation passiert
                </h2>

                {installable && listing.install ? (
                    <>
                        <p className="text-sm text-muted-foreground">
                            Der Marktplatz schlägt eine Änderung am Deployment-Repository vor:
                            das Paket landet unter <Code>{addonDir(listing.install)}</Code> und eine
                            Zeile registriert die Komponente in <Code>{registrationPath}</Code>.
                        </p>

                        <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">
                            <code>{componentLine(listing.install, '')}</code>
                        </pre>

                        {composed ? (
                            <details className="text-sm text-muted-foreground">
                                <summary className="cursor-pointer underline-offset-2 hover:underline">
                                    {Object.keys(composed.files).length} Dateien im Paket
                                </summary>
                                <ul className="mt-2 flex flex-col gap-0.5">
                                    {Object.keys(composed.files).map((path) => (
                                        <li key={path} className="break-all font-mono text-xs">
                                            {path}
                                        </li>
                                    ))}
                                </ul>
                            </details>
                        ) : (
                            listing.install.source.kind === 'repository' && (
                                <p className="text-sm text-muted-foreground">
                                    Das Paket wird beim Vorschlagen unverändert aus{' '}
                                    <Code>{listing.install.source.ref.project}</Code> geholt,
                                    festgelegt auf{' '}
                                    <Code>{listing.install.source.ref.ref}</Code> — der Marktplatz
                                    hält keine eigene Kopie.
                                </p>
                            )
                        )}

                        <p className="text-sm text-muted-foreground">
                            Erreichbar wird das Add-on anschließend unter{' '}
                            <Code>{listing.install.subdomain}.&lt;Domain&gt;</Code>. Zusammengeführt
                            und ausgerollt wird die Änderung vom Betrieb — der Marktplatz merged
                            nichts.
                        </p>
                    </>
                ) : (
                    <div className="flex flex-col gap-2">
                        <p className="flex items-start gap-2 text-sm text-warn">
                            <CircleAlert className="mt-0.5 size-4 shrink-0" />
                            Diese Listung beschreibt das Add-on, sagt aber noch nicht, wie es
                            installiert wird. Solange das fehlt, kann der Marktplatz keine Änderung
                            vorschlagen.
                        </p>
                        <div>
                            <p className="text-sm text-muted-foreground">Es fehlen:</p>
                            <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
                                {missingForInstall.map((item) => (
                                    <li key={item}>{item}</li>
                                ))}
                            </ul>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            Bis dahin bleibt der Weg über das Repository des Herausgebers und die
                            eigene Deployment-Konfiguration.
                        </p>
                    </div>
                )}
            </section>

            {installable && !listing.deprecated && (
                <section className="flex flex-col gap-3 rounded-lg border bg-card p-5">
                    <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <ShieldCheck className="size-4 text-muted-foreground" />
                        Installation vorschlagen
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        Ziel: <Code>{config.repo || 'kein Repository hinterlegt'}</Code>
                        {config.repo && (
                            <>
                                {' '}
                                auf Branch <Code>{config.baseBranch}</Code>, Umgebung{' '}
                                <Code>{config.environment}</Code>
                            </>
                        )}
                        .
                    </p>
                    {forge !== 'ready' && (
                        <p className="text-sm text-warn">
                            {forge === 'missing-repo'
                                ? 'Ohne hinterlegtes Deployment-Repository lässt sich die Änderung nur manuell übernehmen.'
                                : 'Ohne Zugang zum Deployment-Repository wird kein Pull Request geöffnet.'}
                        </p>
                    )}
                    <div className="w-fit">
                        <AddonInstallButton entryId={listing.id} />
                    </div>
                </section>
            )}

            {listing.origin === 'catalog' && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Globe className="size-3.5" />
                    Eintrag aus dem kuratierten Katalog. Korrekturen laufen über einen Merge
                    Request im Katalog-Repository.
                </p>
            )}
        </div>
    )
}
