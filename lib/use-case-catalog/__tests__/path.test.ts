import { describe, expect, it } from 'vitest'

import { pinnedRowSchema } from '@/lib/catalog/schema'
import {
    catalogEntryHref,
    catalogEntryPath,
    isCanonicalPath,
    matchesEntryPath,
    resolveEntryPath,
} from '@/lib/use-case-catalog/path'

const SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4'

function row(id: string) {
    return {
        id,
        type: 'usecase',
        displayName: 'X',
        description: 'X',
        version: '1.0.0',
        maintainer: 'Open Urban Apps',
        license: 'EUPL-1.2',
        keywords: [],
        deploymentRef: { url: 'https://gitlab.example/repo', ref: SHA },
    }
}

describe('catalogEntryPath', () => {
    it('drops the constant parts and keeps publisher and name', () => {
        expect(catalogEntryPath('urn:openurbanapps:usecase:verkehrszaehlung')).toEqual({
            publisher: 'openurbanapps',
            slug: 'verkehrszaehlung',
        })
        expect(catalogEntryHref('urn:openurbanapps:usecase:pegelkarte-hassfurt')).toBe(
            '/use-cases/openurbanapps/pegelkarte-hassfurt',
        )
    })

    it('is a verbatim copy for an id the schema accepts, not a transformation', () => {
        // This is the property the whole scheme rests on. Because the address is
        // two segments of a conforming id copied as-is, distinct ids cannot share
        // an address, so uniqueness of the address follows from uniqueness of the
        // id — which the catalogue already guarantees.
        const id = 'urn:openurbanapps:usecase:multisensor-strassenzustand-hassfurt'
        const { publisher, slug } = catalogEntryPath(id)
        expect(id).toBe(`urn:${publisher}:usecase:${slug}`)
    })

    it('accepts a request in any casing', () => {
        expect(matchesEntryPath('urn:openurbanapps:usecase:verkehrszaehlung', 'OpenUrbanApps', 'Verkehrszaehlung')).toBe(true)
    })

    it('never throws on an id shape it was not designed for', () => {
        // The one data structure in the live catalogue is a CORE URN with eight
        // segments. It has no detail route, but the helper still has to answer.
        const path = catalogEntryPath('urn:core:standard:openurbanapps:datastructure:umwelt:baumkataster:hc1l880p1w')
        expect(path.publisher).toBeTruthy()
        expect(path.slug).toBeTruthy()
        expect(catalogEntryPath('nonsense').slug).toBeTruthy()
    })
})

describe('the ids that could collide are the ones the schema refuses', () => {
    it('rejects an id whose extra colon would flatten into another entry’s address', () => {
        // `a-b` and `a:b` both flatten to `a-b`. The schema refuses the second,
        // so the collision cannot reach the catalogue in the first place.
        expect(catalogEntryPath('urn:xy:usecase:a-b')).toEqual(catalogEntryPath('urn:xy:usecase:a:b'))
        expect(pinnedRowSchema.safeParse(row('urn:xy:usecase:a-b')).success).toBe(true)
        expect(pinnedRowSchema.safeParse(row('urn:xy:usecase:a:b')).success).toBe(false)
    })

    it('rejects a trailing or leading hyphen, which the address would trim away', () => {
        // `a-b-` and `a-b` address the same page. Both were once valid ids, and
        // the router then refused to serve EITHER of them.
        expect(catalogEntryPath('urn:xy:usecase:a-b-').slug).toBe('a-b')
        for (const id of ['urn:xy:usecase:a-b-', 'urn:xy:usecase:-a-b', 'urn:xy:usecase:a-b--']) {
            expect(pinnedRowSchema.safeParse(row(id)).success, id).toBe(false)
        }
        // A doubled hyphen INSIDE the name survives the address untouched, so it
        // stays legal — the rule is about what gets trimmed, not about looks.
        expect(pinnedRowSchema.safeParse(row('urn:xy:usecase:a--b')).success).toBe(true)
    })

    it('holds the verbatim-copy property for every id the schema accepts', () => {
        for (const name of ['ab', 'a-b', 'a--b', 'x9', 'multisensor-strassenzustand-hassfurt']) {
            const id = `urn:openurbanapps:usecase:${name}`
            expect(pinnedRowSchema.safeParse(row(id)).success, id).toBe(true)
            const { publisher, slug } = catalogEntryPath(id)
            expect(`urn:${publisher}:usecase:${slug}`, id).toBe(id)
        }
    })

    it('rejects upper case and umlauts, which normalise into each other', () => {
        for (const id of ['urn:xy:usecase:Gruen', 'urn:xy:usecase:grün', 'urn:xy:usecase:a_b', 'urn:XY:usecase:ab']) {
            expect(pinnedRowSchema.safeParse(row(id)).success, id).toBe(false)
        }
    })

    it('still accepts a data structure with its platform-owned CORE URN', () => {
        const structure = {
            ...row('urn:core:standard:openurbanapps:datastructure:umwelt:baumkataster:hc1l880p1w'),
            type: 'datastructure',
        }
        expect(pinnedRowSchema.safeParse(structure).success).toBe(true)
    })
})

describe('isCanonicalPath', () => {
    it('accepts only the exact spelling the catalogue uses', () => {
        const id = 'urn:openurbanapps:usecase:verkehrszaehlung'
        expect(isCanonicalPath(id, 'openurbanapps', 'verkehrszaehlung')).toBe(true)
        // All of these resolve, and all of them must redirect.
        for (const [publisher, slug] of [
            ['OpenUrbanApps', 'verkehrszaehlung'],
            ['openurbanapps', 'Verkehrszaehlung'],
            ['openurbanapps', '--verkehrszaehlung--'],
            ['openurbanapps', 'verkehrszaehlung!!!'],
        ] as const) {
            expect(matchesEntryPath(id, publisher, slug), `${publisher}/${slug}`).toBe(true)
            expect(isCanonicalPath(id, publisher, slug), `${publisher}/${slug}`).toBe(false)
        }
    })
})

describe('resolveEntryPath', () => {
    it('finds the one entry an address names', () => {
        const entries = [row('urn:openurbanapps:usecase:a'), row('urn:openurbanapps:usecase:b')]
        expect(resolveEntryPath(entries, 'openurbanapps', 'b')?.id).toBe('urn:openurbanapps:usecase:b')
        expect(resolveEntryPath(entries, 'openurbanapps', 'c')).toBeUndefined()
    })

    it('refuses to guess if two entries somehow share an address', () => {
        // Unreachable for conforming ids — kept because a tombstone or a legacy
        // row is not held to that format, and serving the wrong entry's costs to
        // a municipality is the one outcome worth a 404.
        const entries = [row('urn:xy:usecase:a-b'), row('urn:xy:usecase:a:b')]
        expect(resolveEntryPath(entries, 'xy', 'a-b')).toBeUndefined()
    })
})
