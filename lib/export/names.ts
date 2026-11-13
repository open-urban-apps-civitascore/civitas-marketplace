// Apart from urn.ts and its node:crypto, so the browser can derive a short name too.

const UMLAUTS: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }

/** Part of the derivation key, so it must never change: same title, same identity. */
export function compactName(title: string): string {
    return compactLetters(title) || 'unnamed'
}

/** Lower-case letters and digits only; empty when the title has none. */
export function compactLetters(title: string): string {
    const lowered = title.trim().toLowerCase().replace(/[äöüß]/g, (c) => UMLAUTS[c] ?? c)
    const stripped = lowered.normalize('NFD').replace(/[̀-ͯ]/g, '')
    return stripped.replace(/[^a-z0-9]/g, '')
}

export function slugify(title: string): string {
    const lowered = title.trim().toLowerCase().replace(/[äöüß]/g, (c) => UMLAUTS[c] ?? c)
    const stripped = lowered.normalize('NFD').replace(/[̀-ͯ]/g, '')
    const slug = stripped.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    return slug || 'unnamed'
}
