'use client'

import { useEffect, useRef } from 'react'

import type { BoundingBox } from '@/lib/installation-map'

/**
 * OpenStreetMap with the installation's layer on top. The layer's images come
 * through the marketplace (`wmsUrl`, see app/api/ows), which adds the user's
 * token. Leaflet is loaded in the browser only: it reads `window` on import.
 */
export function InstallationMapView({
    wmsUrl,
    layerName,
    bbox,
}: {
    wmsUrl: string
    layerName: string
    bbox: BoundingBox | null
}) {
    const container = useRef<HTMLDivElement>(null)
    const minX = bbox?.minX
    const minY = bbox?.minY
    const maxX = bbox?.maxX
    const maxY = bbox?.maxY

    useEffect(() => {
        let cancelled = false
        let map: import('leaflet').Map | undefined

        void import('leaflet').then((L) => {
            if (cancelled || !container.current) return
            map = L.map(container.current)
            L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
            }).addTo(map)
            // Larger tiles mean fewer requests, each of which passes the token exchange.
            L.tileLayer
                .wms(wmsUrl, { layers: layerName, format: 'image/png', transparent: true, version: '1.1.1', tileSize: 512 })
                .addTo(map)
            if (minX !== undefined && minY !== undefined && maxX !== undefined && maxY !== undefined) {
                map.fitBounds([
                    [minY, minX],
                    [maxY, maxX],
                ])
            } else {
                map.setView([51.16, 10.45], 6)
            }
        })

        return () => {
            cancelled = true
            map?.remove()
        }
    }, [wmsUrl, layerName, minX, minY, maxX, maxY])

    return <div ref={container} className="h-[70vh] w-full overflow-hidden rounded-md border" />
}
