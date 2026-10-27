/** The names the export derives from a title, apart from `urn.ts` and its node:crypto, so the browser can make a short name. */

const UMLAUTS: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }

/**
 * The URN name segment the catalogue packages use: lowercase, umlauts
 * transliterated, everything that is not a letter or digit dropped
 * ("Kiez-Baum" → "kiezbaum", "Baumkataster-DB" → "baumkatasterdb"). It is
 * also the second half of the derivation key, so it must be stable: the same
 * title always yields the same identity.
 */
export function compactName(title: string): string {
    const lowered = title.trim().toLowerCase().replace(/[äöüß]/g, (c) => UMLAUTS[c] ?? c)
    const stripped = lowered.normalize('NFD').replace(/[̀-ͯ]/g, '')
    const compact = stripped.replace(/[^a-z0-9]/g, '')
    return compact || 'unnamed'
}

/** A file-name-safe slug: lowercase, umlauts transliterated, runs of other characters become one dash. */
export function slugify(title: string): string {
    const lowered = title.trim().toLowerCase().replace(/[äöüß]/g, (c) => UMLAUTS[c] ?? c)
    const stripped = lowered.normalize('NFD').replace(/[̀-ͯ]/g, '')
    const slug = stripped.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    return slug || 'unnamed'
}
