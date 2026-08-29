import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
    Archive,
    ArrowLeft,
    BookOpen,
    Boxes,
    Building2,
    CircleAlert,
    ExternalLink,
    GitBranch,
    Globe,
    Lock,
    Package,
    ServerCog,
} from 'lucide-react'

import { AddonIcon } from '@/components/catalog/addon-icon'
import { AddonInstallButton } from '@/components/catalog/addon-install-button'
import { Chips } from '@/components/catalog/chip'
import { Code } from '@/components/catalog/code'
import { CurationTierBadge, curationHint } from '@/components/catalog/curation-tier'
import { findAddonListing } from '@/lib/addon-catalog'
import { fetchAddonPackageFacts, NO_PACKAGE_FACTS } from '@/lib/addon-catalog/package-facts'
import { addonDir, componentLine } from '@/lib/deployment-repo/compose'
import {
    deploymentRepoConfig,
    environmentFilePath,
    forgeReadiness,
} from '@/lib/deployment-repo/config'
import { requireSession } from '@/lib/session'

/**
 * One add-on in full, for the person who has to say yes to it.
 *
 * Two sources, no invention: the catalogue supplies the curated half (summary,
 * tier, pinned version), the add-on's own package at that pinned version
 * supplies the technical half (roles, images, charts, parts). Where either is
 * silent, the page says so instead of filling the gap.
 */
export default async function AddonDetailPage({ params }: { params: Promise<{ id: string }> }) {
    await requireSession()

    const { id } = await params
    const entry = await findAddonListing(id)
    if (!entry) notFound()

    const { listing, missingForInstall } = entry
    const install = listing.install
    const config = deploymentRepoConfig()
    const forge = forgeReadiness(config)

    // Best-effort: an unreachable repository costs the page a section, never
    // its correctness.
    const facts = install ? await fetchAddonPackageFacts(install.source) : NO_PACKAGE_FACTS

    const version = install && (install.source.releaseTag ?? install.source.ref.slice(0, 12))

    // Images and charts are named per part — several parts may share one chart
    // (the geoportal's three all use charts/general), so the part is what tells
    // the rows apart.
    const packageContents = [
        { label: 'Bestandteile', items: facts.parts.map((part) => ({ part })) },
        {
            label: 'Container-Images',
            items: facts.images.map((image) => ({
                part: image.name,
                value: image.tag ? `${image.repository}:${image.tag}` : image.repository,
            })),
        },
        {
            label: 'Helm-Charts',
            items: facts.charts.map((chart) => ({
                part: chart.name,
                value: chart.version ? `${chart.chart}@${chart.version}` : chart.chart,
            })),
        },
    ].filter((group) => group.items.length > 0)

    return (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
            <Link
                href="/add-ons"
                className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
                <ArrowLeft className="size-4" />
                Zurück zu den Add-ons
            </Link>

            {listing.deprecated && (
                <div className="flex items-start gap-3 rounded-lg border border-warn/40 bg-warn/5 p-4 text-sm">
                    <Archive aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" />
                    <div>
                        <p className="font-semibold text-foreground">Dieser Eintrag ist veraltet</p>
                        <p className="mt-0.5 text-muted-foreground">{listing.deprecated.reason}</p>
                        {listing.deprecated.successorId && (
                            <Link
                                href={`/add-ons/${listing.deprecated.successorId}`}
                                className="mt-1.5 inline-block font-medium text-primary underline-offset-2 hover:underline"
                            >
                                Empfohlener Nachfolger ansehen
                            </Link>
                        )}
                        <p className="mt-1.5 text-muted-foreground">
                            Eine Installation lässt sich nicht mehr vorschlagen. Instanzen, die das
                            Add-on bereits betreiben, sind davon nicht betroffen.
                        </p>
                    </div>
                </div>
            )}

            <section className="rounded-xl border border-t-2 border-t-primary bg-card p-6 lg:p-8">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 flex-col items-start gap-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-xs font-semibold uppercase tracking-wider text-primary">
                                Add-on
                            </span>
                            {listing.categories.map((category) => (
                                <span
                                    key={category}
                                    className="rounded-md bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                                >
                                    {category}
                                </span>
                            ))}
                        </div>
                        <div className="flex flex-col items-start gap-2">
                            <h1 className="text-3xl font-bold leading-tight text-foreground lg:text-4xl">
                                {listing.displayName}
                            </h1>
                            {listing.curation && <CurationTierBadge tier={listing.curation.tier} />}
                        </div>
                    </div>
                    <AddonIcon name={listing.displayName} className="size-14 rounded-xl text-lg" />
                </div>

                <p className="mt-4 max-w-3xl text-lg leading-relaxed text-muted-foreground">
                    {listing.summary}
                </p>
                {listing.description && (
                    <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                        {listing.description}
                    </p>
                )}

                <div className="mt-5 flex items-center gap-2.5">
                    <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                        <Building2 className="size-4" />
                    </span>
                    <span className="flex flex-col leading-tight">
                        <span className="text-sm font-medium text-foreground">{listing.publisher}</span>
                        <span className="text-xs text-muted-foreground">Herausgeber</span>
                    </span>
                </div>

                {install && !listing.deprecated && (
                    <div className="mt-5 flex flex-col items-start gap-1.5">
                        <AddonInstallButton entryId={listing.id} />
                        <p className="text-xs text-muted-foreground">
                            Öffnet einen Pull Request im Deployment-Repository
                            {config.repo && <> <Code>{config.repo}</Code></>}. Zusammengeführt und
                            ausgerollt wird die Änderung vom Betrieb.
                        </p>
                        {forge !== 'ready' && (
                            <p className="text-xs text-warn">
                                {forge === 'missing-repo'
                                    ? 'Ohne hinterlegtes Deployment-Repository lässt sich die Änderung nur manuell übernehmen.'
                                    : 'Ohne Zugang zum Deployment-Repository wird kein Pull Request geöffnet.'}
                            </p>
                        )}
                    </div>
                )}
            </section>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
                <div className="flex flex-col gap-6">
                    <section className="rounded-md border bg-card p-6">
                        <h2 className="text-lg font-semibold text-foreground">
                            Integration in CIVITAS/CORE
                        </h2>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <Feature icon={Lock} title="Single-Sign-On">
                                {facts.hasSso ? (
                                    <>
                                        <p>Anmeldung über Keycloak — dieselben Nutzer:innen wie im Portal.</p>
                                        {facts.ssoRoles.length > 0 && (
                                            <>
                                                <p className="mt-2 text-xs">Rollen, die angelegt werden:</p>
                                                <div className="mt-1.5">
                                                    <Chips items={facts.ssoRoles} />
                                                </div>
                                            </>
                                        )}
                                    </>
                                ) : (
                                    <p>Das Paket legt keinen eigenen Keycloak-Client an.</p>
                                )}
                            </Feature>

                            <Feature icon={Globe} title="Erreichbarkeit">
                                <p>
                                    {install ? (
                                        <>
                                            Nach dem Ausrollen erreichbar unter{' '}
                                            <Code>{install.subdomain}.&lt;Domain der Instanz&gt;</Code> —
                                            über das vorhandene Gateway, ohne eigenen Einstiegspunkt.
                                        </>
                                    ) : (
                                        'Diese Listung nennt keine Adresse.'
                                    )}
                                </p>
                            </Feature>
                        </div>
                    </section>

                    {packageContents.length > 0 && (
                        <section className="rounded-md border bg-card p-6">
                            <div className="flex items-center gap-2">
                                <Boxes className="size-4 text-muted-foreground" />
                                <h2 className="text-lg font-semibold text-foreground">
                                    Was installiert wird
                                </h2>
                            </div>
                            <p className="mt-1.5 text-sm text-muted-foreground">
                                Gelesen aus dem Paket in Version{' '}
                                <span className="font-mono text-xs">{version}</span>.
                            </p>
                            {packageContents.map((group) => (
                                <div key={group.label} className="mt-4">
                                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                        {group.label}
                                    </p>
                                    <ul className="mt-1.5 flex flex-col gap-1">
                                        {group.items.map((item, index) => (
                                            <li
                                                key={`${item.part}-${index}`}
                                                className="break-all font-mono text-xs text-muted-foreground"
                                            >
                                                <span className="text-foreground">{item.part}</span>
                                                {'value' in item && <> · {item.value}</>}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ))}
                        </section>
                    )}

                    <section className="rounded-md border bg-card p-6">
                        <div className="flex items-center gap-2">
                            <Package className="size-4 text-muted-foreground" />
                            <h2 className="text-lg font-semibold text-foreground">
                                Was im Deployment-Repository landet
                            </h2>
                        </div>

                        {install ? (
                            <>
                                <p className="mt-3 text-sm text-muted-foreground">
                                    Das Paket landet unter <Code>{addonDir(install)}</Code>, eine Zeile
                                    registriert die Komponente in{' '}
                                    <Code>{environmentFilePath(config)}</Code>:
                                </p>
                                <pre className="mt-3 overflow-x-auto rounded bg-muted p-3 text-xs">
                                    <code>{componentLine(install, '')}</code>
                                </pre>
                                <p className="mt-3 text-sm text-muted-foreground">
                                    Die Dateien werden unverändert aus{' '}
                                    <Code>{install.source.project}</Code> geholt, festgelegt auf{' '}
                                    <Code>{install.source.releaseTag ?? install.source.ref.slice(0, 12)}</Code>
                                    {install.source.releaseTag && /^[0-9a-f]{40}$/i.test(install.source.ref) && (
                                        <>
                                            {' '}
                                            (Commit <Code>{install.source.ref.slice(0, 12)}</Code>)
                                        </>
                                    )}{' '}
                                    — der Marktplatz hält keine eigene Kopie.
                                </p>
                            </>
                        ) : (
                            <div className="mt-3 flex flex-col gap-2">
                                <p className="flex items-start gap-2 text-sm text-warn">
                                    <CircleAlert className="mt-0.5 size-4 shrink-0" />
                                    Diese Listung beschreibt das Add-on, sagt aber noch nicht, wie es
                                    installiert wird.
                                </p>
                                <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
                                    {missingForInstall.map((item) => (
                                        <li key={item}>{item}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </section>
                </div>

                <aside className="flex flex-col gap-6">
                    <section className="rounded-md border bg-card p-5">
                        <h2 className="text-sm font-semibold text-foreground">Details</h2>
                        <dl className="mt-3">
                            <Row label="Herausgeber">{listing.publisher}</Row>
                            {version && (
                                <Row label="Gelistete Version">
                                    <span className="font-mono text-xs">{version}</span>
                                </Row>
                            )}
                            {listing.license && <Row label="Lizenz">{listing.license}</Row>}
                            {listing.wrappedTool && (
                                <Row label="Basiert auf">
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
                                    {listing.wrappedTool.license && ` · ${listing.wrappedTool.license}`}
                                </Row>
                            )}
                        </dl>

                        <p className="mt-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            Kompatibilität
                        </p>
                        <div className="mt-2">
                            {listing.compatibleCoreVersions.length > 0 ? (
                                <Chips
                                    items={listing.compatibleCoreVersions.map((v) => `Core ${v}`)}
                                />
                            ) : (
                                <p className="text-sm text-muted-foreground">
                                    vom Herausgeber nicht angegeben
                                </p>
                            )}
                        </div>
                    </section>

                    {listing.curation && (
                        <section className="rounded-md border bg-card p-5">
                            <h2 className="text-sm font-semibold text-foreground">Kuratierung</h2>
                            <div className="mt-3">
                                <CurationTierBadge tier={listing.curation.tier} />
                            </div>
                            <p className="mt-2 text-sm text-muted-foreground">
                                {curationHint(listing.curation.tier)}
                            </p>
                            {listing.curation.notes && (
                                <p className="mt-2 text-sm text-muted-foreground">
                                    {listing.curation.notes}
                                </p>
                            )}
                            <p className="mt-2 text-xs text-muted-foreground">
                                Geprüft von {listing.curation.reviewedBy} am{' '}
                                {listing.curation.reviewedAt}
                            </p>
                        </section>
                    )}

                    <section className="rounded-md border bg-card p-5">
                        <div className="flex items-center gap-2">
                            <ServerCog className="size-4 text-muted-foreground" />
                            <h2 className="text-sm font-semibold text-foreground">
                                Braucht von der Plattform
                            </h2>
                        </div>
                        <div className="mt-3">
                            {listing.platformNeeds.length > 0 ? (
                                <Chips items={listing.platformNeeds} />
                            ) : (
                                <p className="text-sm text-muted-foreground">
                                    Keine besonderen Anforderungen angegeben.
                                </p>
                            )}
                        </div>
                    </section>

                    <section className="flex flex-col gap-2 rounded-md border bg-card p-5 text-sm">
                        {install && (
                            <ExternalLinkRow
                                icon={GitBranch}
                                href={`https://gitlab.com/${install.source.project}`}
                            >
                                Repository
                            </ExternalLinkRow>
                        )}
                        {listing.links.documentation && (
                            <ExternalLinkRow icon={BookOpen} href={listing.links.documentation}>
                                Dokumentation
                            </ExternalLinkRow>
                        )}
                    </section>
                </aside>
            </div>

            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Globe className="size-3.5" />
                Eintrag aus dem kuratierten Katalog. Korrekturen laufen über einen Merge Request im
                Katalog-Repository.
            </p>
        </div>
    )
}

function Feature({
    icon: Icon,
    title,
    children,
}: {
    icon: typeof Lock
    title: string
    children: React.ReactNode
}) {
    return (
        <div className="rounded-lg bg-primary/5 p-4">
            <div className="flex items-center gap-2 text-primary">
                <Icon className="size-5" />
                <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            </div>
            <div className="mt-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
        </div>
    )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-3 border-b border-border/60 py-2.5 text-sm last:border-b-0">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right font-medium text-foreground">{children}</dd>
        </div>
    )
}

function ExternalLinkRow({
    icon: Icon,
    href,
    children,
}: {
    icon: typeof GitBranch
    href: string
    children: React.ReactNode
}) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-primary underline-offset-2 hover:underline"
        >
            <Icon className="size-4" />
            {children}
            <ExternalLink className="size-3" />
        </a>
    )
}
