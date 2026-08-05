import { FlaskConical } from 'lucide-react'

import { InstallButton } from '@/components/catalog/install-button'
import { mockCatalog } from '@/lib/mock-catalog'
import { requireSession } from '@/lib/session'

const PORTAL_URL = process.env.NEXT_PUBLIC_PORTAL_URL ?? 'http://localhost:3000'

/**
 * Dev tool, deliberately throwaway: every catalogue entry in one flat list with
 * its raw identity, fired through the REAL install path. The catalogue pages
 * are the product view; this one is for debugging payloads and responses.
 */
export default async function InstallLabPage() {
    await requireSession()

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center gap-2 rounded-lg border border-warn/50 bg-warn/10 px-4 py-2 text-sm">
                <FlaskConical className="size-4 shrink-0" />
                <span>
                    Install-Lab — Dev-Werkzeug: statische Payloads durch die echte
                    Install-Kette. Wird in P2.2 durch den GitLab-Katalog ersetzt.
                </span>
            </div>

            <h1>Alle Katalog-Einträge</h1>

            <ul className="flex flex-col gap-4">
                {mockCatalog.map(({ manifest }) => (
                    <li
                        key={manifest.id}
                        className="flex flex-col gap-2 rounded-xl border bg-card p-4"
                    >
                        <div className="flex items-baseline gap-3">
                            <span className="font-medium">{manifest.displayName}</span>
                            <span className="text-xs uppercase text-muted-foreground">
                                {manifest.type}
                            </span>
                            <span className="text-xs text-muted-foreground">
                                v{manifest.version}
                            </span>
                        </div>
                        <p className="font-mono text-xs text-muted-foreground">{manifest.id}</p>
                        <div className="flex items-center gap-4">
                            <InstallButton entryId={manifest.id} />
                            <a
                                href={`${PORTAL_URL}/datastructures`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-sm text-primary underline"
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
