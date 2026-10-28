import { createHash } from 'node:crypto'

import { compactName } from '@/lib/export/names'

const DISAMBIGUATOR_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'
const DISAMBIGUATOR_LENGTH = 10

/** Must stay identical to Model Forge's `UrnParser.deriveDisambiguator`. */
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
    version?: string
}

/** Undefined for anything else, which is no error: connector documents may carry non-URN references. */
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

export function logicalUrn(urn: string): string {
    const parsed = parseCoreUrn(urn)
    if (!parsed?.version) return urn
    return urn.slice(0, urn.lastIndexOf(':'))
}

/** Scope `standard` marks a catalogue-authored identity that must travel unchanged. */
export function isCatalogAuthored(urn: string): boolean {
    return parseCoreUrn(urn)?.scope === 'standard'
}

export { compactName, slugify } from '@/lib/export/names'

/** Publisher and domain come from a form: no separator or whitespace may reach the URN. */
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
