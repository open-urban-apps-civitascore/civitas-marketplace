import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { Readable } from 'node:stream'

import { getAccessToken } from '@/lib/session'

/**
 * Map images for the map page, fetched from a dataset's OWS API on the
 * platform's gateway with the signed-in user's token.
 *
 * A map viewer requests its images as plain image loads, which cannot carry a
 * token; without this detour the API would have to be public (the dataset's
 * Open Data flag). Here the gateway and its policy check the user's own token,
 * so the page shows exactly what the user may read, and nothing is published.
 * Only map requests pass: the parameters of a WMS GetMap or GetCapabilities.
 */

const FORWARDED_PARAMETERS = new Set([
    'service',
    'request',
    'version',
    'layers',
    'styles',
    'format',
    'transparent',
    'width',
    'height',
    'srs',
    'crs',
    'bbox',
])

const DATASET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/

/**
 * A GET through node:http rather than fetch: fetch drops a Host header without
 * a word (it is a forbidden header name), and the gateway's local routes are
 * scoped to a host. Without it the request falls into the portal backend's
 * catch-all route, and the policy answers `unknown_endpoint`.
 */
function get(url: URL, headers: Record<string, string>): Promise<Response> {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest
    return new Promise((resolve, reject) => {
        const outgoing = send(url, { method: 'GET', headers }, (incoming) => {
            const contentType = incoming.headers['content-type']
            resolve(
                new Response(Readable.toWeb(incoming) as unknown as ReadableStream, {
                    status: incoming.statusCode ?? 502,
                    headers: {
                        'Content-Type': typeof contentType === 'string' ? contentType : 'application/octet-stream',
                        'Cache-Control': 'no-store',
                    },
                }),
            )
        })
        outgoing.on('error', reject)
        outgoing.end()
    })
}

export async function GET(request: Request, { params }: { params: Promise<{ datasetId: string; slug: string }> }) {
    const { datasetId, slug } = await params
    if (!DATASET_ID.test(datasetId) || !SLUG.test(slug)) {
        return new Response('Unbekannter Kartendienst', { status: 400 })
    }
    const gateway = process.env.OWS_GATEWAY_URL
    if (!gateway) return new Response('OWS_GATEWAY_URL ist nicht gesetzt', { status: 503 })

    const query = new URLSearchParams()
    for (const [key, value] of new URL(request.url).searchParams) {
        if (FORWARDED_PARAMETERS.has(key.toLowerCase())) query.set(key, value)
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${await getAccessToken()}` }
    // Locally the gateway's routes are scoped to a host name (api.localhost).
    if (process.env.OWS_GATEWAY_HOST) headers.Host = process.env.OWS_GATEWAY_HOST

    try {
        return await get(new URL(`${gateway.replace(/\/$/, '')}/v1/datasets/${datasetId}/${slug}?${query}`), headers)
    } catch (error) {
        return new Response(`Gateway nicht erreichbar: ${error instanceof Error ? error.message : String(error)}`, {
            status: 502,
        })
    }
}
