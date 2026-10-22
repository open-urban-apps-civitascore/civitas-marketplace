import { describe, expect, it } from 'vitest'

import {
    catalogUrn,
    compactName,
    deriveDisambiguator,
    isCatalogAuthored,
    logicalUrn,
    parseCoreUrn,
    slugify,
} from '@/lib/export/urn'

describe('deriveDisambiguator', () => {
    // Calibrated against the published packages: the export must compute the
    // identities a hand-authored package carries, or re-installs would duplicate.
    it('reproduces the catalogue identities of the Kiez-Baumkataster package', () => {
        expect(deriveDisambiguator('openurbanapps#kiezbaum')).toBe('f1i2sjhgvq')
        expect(deriveDisambiguator('openurbanapps#baumkatasterzeile')).toBe('ny4qd9zowt')
        expect(deriveDisambiguator('openurbanapps#katasterzukiezbaum')).toBe('jd1uf7qtd1')
        expect(deriveDisambiguator('openurbanapps#baumkatasterdb')).toBe('al7cx8sr5i')
    })

    it('is ten base36 characters and stable', () => {
        const token = deriveDisambiguator('musterstadt#irgendwas')
        expect(token).toMatch(/^[0-9a-z]{10}$/)
        expect(deriveDisambiguator('musterstadt#irgendwas')).toBe(token)
    })
})

describe('compactName / slugify', () => {
    it('folds titles to the URN name segment the packages use', () => {
        expect(compactName('Kiez-Baum')).toBe('kiezbaum')
        expect(compactName('Baumkataster-DB')).toBe('baumkatasterdb')
        expect(compactName('Luftmessung')).toBe('luftmessung')
        expect(compactName('Kiez-Bäume-Tabelle')).toBe('kiezbaeumetabelle')
        expect(compactName('Kataster → Kiez-Baum')).toBe('katasterkiezbaum')
    })

    it('makes file-name-safe slugs', () => {
        expect(slugify('Kiez-Bäume-Tabelle')).toBe('kiez-baeume-tabelle')
        expect(slugify('Kataster → Kiez-Baum')).toBe('kataster-kiez-baum')
        expect(slugify('   ')).toBe('unnamed')
    })
})

describe('CORE URN helpers', () => {
    const versioned = 'urn:core:standard:openurbanapps:datastructure:environment:kiezbaum:f1i2sjhgvq:1.0.0'
    const logical = 'urn:core:standard:openurbanapps:datastructure:environment:kiezbaum:f1i2sjhgvq'

    it('parses both forms and strips the version', () => {
        expect(parseCoreUrn(versioned)?.version).toBe('1.0.0')
        expect(parseCoreUrn(logical)?.version).toBeUndefined()
        expect(logicalUrn(versioned)).toBe(logical)
        expect(logicalUrn(logical)).toBe(logical)
        expect(parseCoreUrn('urn:openurbanapps:usecase:kiez-baumkataster')).toBeUndefined()
    })

    it('recognises catalogue-authored identities by scope', () => {
        expect(isCatalogAuthored(logical)).toBe(true)
        expect(isCatalogAuthored('urn:core:instance:musterstadt:datastructure:default:x:abcdefghij')).toBe(false)
    })

    it('builds a catalogue URN from publisher, kind, domain and title', () => {
        expect(catalogUrn('openurbanapps', 'datastructure', 'environment', 'Kiez-Baum')).toBe(logical)
    })
})
