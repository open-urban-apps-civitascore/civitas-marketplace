import { createHash } from 'node:crypto'

import { compactName } from '@/lib/export/names'

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

// Apart from the hash (`names.ts`), so the share pages can make a short name in the browser.
export { compactName, slugify } from '@/lib/export/names'

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
