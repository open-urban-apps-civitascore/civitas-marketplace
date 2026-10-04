import { createHash } from 'node:crypto'

/**
 * CORE URN helpers for the export: parsing, the catalogue's derived identity,
 * and the name normalisation the catalogue packages use.
 *
 * Identity policy on export (decision with Daniel, 2026-09-08): an artifact
 * whose URN already carries scope `standard` came from a catalogue package
 * and KEEPS its identity — re-exporting it must not fork the shared identity.
 * Everything the instance minted itself (any other scope, random
 * disambiguator) is re-identified as a catalogue artifact:
 *
 *   urn:core:standard:<publisher>:<type>:<domain>:<name>:<derived>
 *
 * The disambiguator is DERIVED exactly as Model Forge's
 * `UrnParser.deriveDisambiguator` does for externally identified artifacts:
 * SHA-256 over the stable key `<publisher>#<name>`, one base36 character per
 * hash byte (`hash[i] % 36`), ten characters. Verified against the published
 * packages on 2026-09-08 (`openurbanapps#kiezbaum` → `f1i2sjhgvq`), so an
 * export computes the identical identity a hand-authored package carries.
 */

const DISAMBIGUATOR_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'
const DISAMBIGUATOR_LENGTH = 10

export function deriveDisambiguator(key: string): string {
    const hash = createHash('sha256').update(key, 'utf8').digest()
    let out = ''
    for (let i = 0; i < DISAMBIGUATOR_LENGTH; i++) {
        out += DISAMBIGUATOR_ALPHABET[hash[i] % DISAMBIGUATOR_ALPHABET.length]
    }
    return out
}

export type CoreArtifactType =
    | 'element'
    | 'datastructure'
    | 'dataset'
    | 'mapping'
    | 'pipeline'
    | 'datasource'
    | 'datasink'

export interface CoreUrn {
    scope: string
    owner: string
    type: string
    domain: string
    name: string
    disambiguator: string
    /** Present on a versioned URN, absent on a logical one. */
    version?: string
}

/**
 * `urn:core:<scope>:<owner>:<type>:<domain>:<name>:<disambiguator>[:<version>]`.
 * Returns undefined for anything that is not a CORE URN — callers treat that
 * as "not an identity", never as an error, because connector documents may
 * legitimately carry non-URN references.
 */
export function parseCoreUrn(value: unknown): CoreUrn | undefined {
    if (typeof value !== 'string') return undefined
    const parts = value.split(':')
    if (parts.length < 8 || parts.length > 9 || parts[0] !== 'urn' || parts[1] !== 'core') {
        return undefined
    }
    const [, , scope, owner, type, domain, name, disambiguator, version] = parts
    if (!scope || !owner || !type || !domain || !name || !disambiguator) return undefined
    return { scope, owner, type, domain, name, disambiguator, version }
}

export function isCoreUrn(value: unknown): value is string {
    return parseCoreUrn(value) !== undefined
}

/** The version-free form; a logical URN is returned unchanged. */
export function logicalUrn(urn: string): string {
    const parsed = parseCoreUrn(urn)
    if (!parsed?.version) return urn
    return urn.slice(0, urn.lastIndexOf(':'))
}

/** Scope `standard` marks a catalogue-authored identity that must travel unchanged. */
export function isCatalogAuthored(urn: string): boolean {
    return parseCoreUrn(urn)?.scope === 'standard'
}

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

/** A URN segment must not carry the separator or whitespace; the publisher and domain come from a form. */
export function urnSegment(value: string, fallback: string): string {
    const segment = compactName(value)
    return segment === 'unnamed' ? fallback : segment
}

export function catalogUrn(
    publisher: string,
    type: CoreArtifactType,
    domain: string,
    title: string,
): string {
    const name = compactName(title)
    const disambiguator = deriveDisambiguator(`${publisher}#${name}`)
    return `urn:core:standard:${publisher}:${type}:${domain}:${name}:${disambiguator}`
}
