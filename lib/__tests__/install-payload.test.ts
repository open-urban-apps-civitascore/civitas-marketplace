import { describe, expect, it } from 'vitest'

import { mockPackages } from '@/lib/mock-catalog'
import {
    DESCRIPTION_MAX_LENGTH,
    clampDescription,
    resolveBrokerOverride,
    versionProvenance,
} from '@/lib/install-payload'

/** Every description the install path sends to the portal, across all shipped packages. */
function shippedDescriptions(): { where: string; text: unknown }[] {
    return mockPackages.flatMap((pkg) => [
        { where: `${pkg.manifest.id} (manifest)`, text: pkg.manifest.description },
        ...Object.entries(pkg.files).map(([file, document]) => ({
            where: `${pkg.manifest.id} → ${file}`,
            text: document.description,
        })),
    ])
}

describe('clampDescription', () => {
    it('passes a description that already fits through unchanged', () => {
        expect(clampDescription('Zählstellen und ihre Zählungen.')).toBe(
            'Zählstellen und ihre Zählungen.',
        )
    })

    it('keeps every shipped description within the portal limit', () => {
        // The portal applies this limit in the form, not in the API: an over-long text imports
        // without complaint and only blocks the first edit someone tries to save. A fixture that
        // grows past the limit therefore fails here rather than in a user's face.
        // Not every member kind carries a description (simulations do not), so an absent one is
        // not a finding — an over-long one is.
        for (const { where, text } of shippedDescriptions()) {
            const clamped = clampDescription(text)
            if (clamped === undefined) continue
            expect(clamped.length, where).toBeLessThanOrEqual(DESCRIPTION_MAX_LENGTH)
        }
    })

    it('cuts an over-long description at a word boundary and marks the cut', () => {
        const clamped = clampDescription(`${'wort '.repeat(40)}ende`)!
        expect(clamped.length).toBeLessThanOrEqual(DESCRIPTION_MAX_LENGTH)
        expect(clamped.endsWith('wort…')).toBe(true)
    })

    it('does not leave dangling punctuation in front of the ellipsis', () => {
        const clamped = clampDescription(`${'a'.repeat(140)} — Zusatz, der nicht mehr passt`)!
        expect(clamped.endsWith('a…')).toBe(true)
    })

    it('cuts hard when the text has no word boundary to honour', () => {
        const clamped = clampDescription('x'.repeat(400))!
        expect(clamped.length).toBe(DESCRIPTION_MAX_LENGTH)
    })

    it('drops a description that is not a string', () => {
        // Connector documents are untyped JSON; a number in that slot is an authoring error, and
        // coercing it would put "42" in front of a user as if someone had written it.
        expect(clampDescription(42)).toBeUndefined()
        expect(clampDescription(undefined)).toBeUndefined()
    })
})

describe('versionProvenance', () => {
    it('names the package and version it came from', () => {
        expect(versionProvenance('Verkehrszählung', '1.5.0')).toBe('Aus Paket Verkehrszählung 1.5.0')
    })

    it('stays within the portal limit for every shipped package', () => {
        for (const pkg of mockPackages) {
            const line = versionProvenance(pkg.manifest.displayName, pkg.manifest.version)
            expect(line.length, pkg.manifest.id).toBeLessThanOrEqual(DESCRIPTION_MAX_LENGTH)
        }
    })

    it('truncates a pathologically long package name rather than exceeding the limit', () => {
        const line = versionProvenance('X'.repeat(500), '2.0.0')
        expect(line.length).toBeLessThanOrEqual(DESCRIPTION_MAX_LENGTH)
        // The version survives the truncation — it is the part that identifies which release the
        // structure came from.
        expect(line.endsWith('2.0.0')).toBe(true)
    })
})

describe('resolveBrokerOverride', () => {
    it('demo mode applies the platform-side demo broker to the datasource', () => {
        expect(resolveBrokerOverride('demo', '', 'tcp://mosquitto.demo.svc:1883')).toBe(
            'tcp://mosquitto.demo.svc:1883',
        )
    })

    it('demo mode without DEMO_DATASOURCE_BROKER_URL leaves the package default standing', () => {
        expect(resolveBrokerOverride('demo', '', undefined)).toBe('')
        expect(resolveBrokerOverride('demo', '', '   ')).toBe('')
    })

    it('custom mode uses the user address and ignores the demo broker', () => {
        expect(resolveBrokerOverride('custom', ' tcp://city-broker:1883 ', 'tcp://demo:1883')).toBe(
            'tcp://city-broker:1883',
        )
    })

    it('later mode never overrides, whatever is configured', () => {
        expect(resolveBrokerOverride('later', 'tcp://typed-anyway:1883', 'tcp://demo:1883')).toBe('')
    })
})
