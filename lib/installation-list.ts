/**
 * Reads the installations of this instance (`GET /v1/installations`) completely.
 *
 * The platform answers in pages, and its default page holds 20 rows. A reader
 * that takes one page hides the older installations without a word. An
 * instance collects rows quickly, because an uninstalled installation stays in
 * the record. The catalogue badge and the page "Installiert" both read through
 * here, so that they cannot disagree about what is installed.
 *
 * No session import on purpose: the caller passes the token, and the module
 * stays testable without the framework.
 */

const PAGE_SIZE = 200

/** A guard against a platform that ignores `page`. Far beyond any instance today. */
const MAX_PAGES = 25

export type InstallationList<Row> =
    | {
          ok: true
          rows: Row[]
          /** False when the page guard stopped the read: the oldest rows are missing. */
          isComplete: boolean
      }
    | { ok: false; status: number; statusText: string }

export async function readAllInstallations<Row>(accessToken: string): Promise<InstallationList<Row>> {
    const rows: Row[] = []
    for (let page = 0; page < MAX_PAGES; page++) {
        const res = await fetch(
            `${process.env.API_BASE_URL}:${process.env.API_PORT}/v1/installations?size=${PAGE_SIZE}&page=${page}`,
            {
                headers: { Authorization: `Bearer ${accessToken}` },
                cache: 'no-store',
            },
        )
        if (!res.ok) return { ok: false, status: res.status, statusText: res.statusText }

        const body = (await res.json()) as { content?: Row[] }
        const content = body.content ?? []
        rows.push(...content)
        // A page that is not full is the last one. The rule needs no page
        // metadata, so it holds for each shape the platform gives a page in.
        if (content.length < PAGE_SIZE) return { ok: true, rows, isComplete: true }
    }
    return { ok: true, rows, isComplete: false }
}

/**
 * Active installations and the history, each in the order the platform gave
 * (newest first). An uninstalled installation is history: its lines say what it
 * created, not what exists.
 */
export function partitionInstallations<Row extends { uninstalledAt?: string | null }>(
    rows: Row[],
): { active: Row[]; history: Row[] } {
    return {
        active: rows.filter((row) => !row.uninstalledAt),
        history: rows.filter((row) => Boolean(row.uninstalledAt)),
    }
}
