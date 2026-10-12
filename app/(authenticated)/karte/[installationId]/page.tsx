import 'leaflet/dist/leaflet.css'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { InstallationMapView } from '@/components/installed/installation-map'
import { loadInstallationMap } from '@/lib/installation-map'
import { requireSession } from '@/lib/session'

/** The map of one installation: its OWS layer over OpenStreetMap. */
export default async function InstallationMapPage({ params }: { params: Promise<{ installationId: string }> }) {
    await requireSession()
    const { installationId } = await params
    const map = await loadInstallationMap(installationId)
    const back = `/installed?installation=${encodeURIComponent(installationId)}`

    return (
        <div className="flex flex-col gap-4">
            <Link
                href={back}
                className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
                <ArrowLeft className="size-4" />
                Zur Übersicht der Installation
            </Link>
            {map ? (
                <>
                    <div>
                        <h1>{map.title}</h1>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Ebene „{map.layerTitle}“ aus der API „{map.apiSlug}“ (WMS), über OpenStreetMap. Punkte
                            erscheinen, sobald der Datensatz freigegeben ist und Daten geliefert hat; jede Nachricht
                            ist ein Punkt, die einer Station liegen übereinander.
                        </p>
                    </div>
                    <InstallationMapView
                        wmsUrl={`/api/ows/${map.datasetId}/${map.apiSlug}`}
                        layerName={map.layerName}
                        bbox={map.bbox}
                    />
                </>
            ) : (
                <p className="text-sm text-muted-foreground">
                    Diese Installation ist nicht (mehr) aktiv oder bringt keine Karte mit.
                </p>
            )}
        </div>
    )
}
