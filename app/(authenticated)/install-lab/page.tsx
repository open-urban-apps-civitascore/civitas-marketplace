import { mockCatalog } from '@/lib/mock-catalog'
import { requireSession } from '@/lib/session'
import { InstallButton } from './install-button'

const PORTAL_URL = process.env.NEXT_PUBLIC_PORTAL_URL ?? 'http://localhost:3000'

/**
 * Dev tool, deliberately throwaway: static catalogue payloads fired through
 * the REAL install path (server action → user token → gateway → import
 * endpoint). P2.2 replaces the payload source with the GitLab catalogue;
 * everything else on this page is the production install flow.
 */
export default async function InstallLabPage() {
    await requireSession()

    return (
        <div className="flex flex-col gap-6">
            <div className="rounded border border-amber-400 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                Install-Lab — Dev-Werkzeug: statische Payloads durch die echte Install-Kette.
                Wird in P2.2 durch den GitLab-Katalog ersetzt.
            </div>

            <h1 className="text-xl font-semibold">Installierbare Artefakte (Mock-Katalog)</h1>

            <ul className="flex flex-col gap-4">
                {mockCatalog.map(({ manifest }) => (
                    <li
                        key={manifest.id}
                        className="flex flex-col gap-2 rounded border border-black/10 p-4 dark:border-white/15"
                    >
                        <div className="flex items-baseline gap-3">
                            <span className="font-medium">{manifest.displayName}</span>
                            <span className="text-xs uppercase opacity-60">{manifest.type}</span>
                            <span className="text-xs opacity-60">v{manifest.version}</span>
                        </div>
                        <p className="text-sm opacity-80">{manifest.description}</p>
                        <p className="font-mono text-xs opacity-60">{manifest.id}</p>
                        <div className="flex items-center gap-4">
                            <InstallButton entryId={manifest.id} />
                            <a
                                href={`${PORTAL_URL}/datastructures`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-sm text-blue-700 underline dark:text-blue-400"
                            >
                                Im Portal ansehen
                            </a>
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    )
}
