import type { NewVersionFill } from '@/lib/export/new-version-fill'

export function newVersionFillUrl(targetKey: string, slug: string, version: string): string {
    return `/api/shares/fill?${new URLSearchParams({ target: targetKey, slug, version })}`
}

export const FILL_REQUEST_FAILED = 'Die Anfrage an den Server ist fehlgeschlagen.'

/** A cancelled request rejects, as `fetch` does; any other failure is answered as `error`. */
export async function requestNewVersionFill(
    fill: { targetKey: string; slug: string; version: string },
    signal?: AbortSignal,
    fetchImpl: typeof fetch = fetch,
): Promise<NewVersionFill> {
    const response = await fetchImpl(newVersionFillUrl(fill.targetKey, fill.slug, fill.version), { cache: 'no-store', ...(signal ? { signal } : {}) })
    const body = (await response.json().catch(() => undefined)) as Partial<NewVersionFill> | undefined
    return typeof body?.status === 'string' ? (body as NewVersionFill) : { status: 'error', detail: FILL_REQUEST_FAILED }
}
