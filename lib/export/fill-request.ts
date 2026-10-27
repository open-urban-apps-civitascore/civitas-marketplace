import type { NewVersionFill } from '@/lib/export/new-version-fill'

/**
 * How the wizard asks `/api/shares/fill` for the Steckbrief of a new version.
 * The route answers a `NewVersionFill` whatever happens; `signal` cancels a
 * request once the person chooses another dataset.
 */

export function newVersionFillUrl(targetKey: string, slug: string, version: string): string {
    return `/api/shares/fill?${new URLSearchParams({ target: targetKey, slug, version })}`
}

/** Said where the route could not be asked, or answered no such thing. */
export const FILL_REQUEST_FAILED = 'Die Anfrage an den Server ist fehlgeschlagen.'

/** The route's answer; a cancelled request rejects, as `fetch` does, so the caller drops it. */
export async function requestNewVersionFill(
    fill: { targetKey: string; slug: string; version: string },
    signal?: AbortSignal,
    fetchImpl: typeof fetch = fetch,
): Promise<NewVersionFill> {
    const response = await fetchImpl(newVersionFillUrl(fill.targetKey, fill.slug, fill.version), { cache: 'no-store', ...(signal ? { signal } : {}) })
    const body = (await response.json().catch(() => undefined)) as Partial<NewVersionFill> | undefined
    return typeof body?.status === 'string' ? (body as NewVersionFill) : { status: 'error', detail: FILL_REQUEST_FAILED }
}
