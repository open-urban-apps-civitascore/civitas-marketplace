import { describe, expect, it } from 'vitest'

import { assembleCatalogEntry } from '@/lib/catalog/assemble'
import { isDataStructureEntry, type CatalogEntry, type UseCaseEntry } from '@/lib/catalog/types'
import { isCoreUrn, logicalUrn } from '@/lib/export/urn'
import { mockPackages } from '@/lib/mock-catalog'
import {
    DESCRIPTION_MAX_LENGTH,
    InstallPayloadError,
    buildInstallationRequest,
    clampDescription,
    describeInstallFailure,
    describeUninstallFailure,
    readFailure,
    resolveBrokerOverride,
    summarizeInstallation,
    versionProvenance,
    type InstallationRequest,
    type PackageMemberKind,
    type PackageMemberRequest,
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

const TRAFFIC = 'urn:openurbanapps:usecase:verkehrszaehlung'
const POOL = '3f1c2a9e-6d0b-4c57-9a41-0e5b7d2c8f10'

function entryOf(id: string): CatalogEntry {
    const pkg = mockPackages.find((candidate) => candidate.manifest.id === id)!
    return assembleCatalogEntry(pkg.manifest, (file) => pkg.files[file])
}

/** A deep copy, so a test that bends a package does not bend the fixtures the other tests read. */
function bundleOf(id: string): UseCaseEntry {
    const entry = entryOf(id)
    if (isDataStructureEntry(entry)) throw new Error(`${id} is not a use case`)
    return structuredClone(entry)
}

function shippedUseCases(): UseCaseEntry[] {
    return mockPackages
        .filter((pkg) => pkg.manifest.type === 'usecase')
        .map((pkg) => bundleOf(pkg.manifest.id))
}

function membersOf(request: InstallationRequest, kind: PackageMemberKind): PackageMemberRequest[] {
    return request.package.members.filter((member) => member.kind === kind)
}

function nodesOf(member: PackageMemberRequest): Record<string, unknown>[] {
    return member.content.nodes as Record<string, unknown>[]
}

/** Every URN a member uses to point at another artifact. */
function referencesOf(member: PackageMemberRequest): string[] {
    const fields: unknown[] =
        member.kind === 'pipeline'
            ? nodesOf(member).flatMap((node) => [
                  node.sourceRef,
                  node.lookupSourceRef,
                  node.mappingRef,
                  node.sinkRef,
              ])
            : member.kind === 'mapping'
              ? [member.content.source, member.content.target]
              : member.kind === 'datasource' || member.kind === 'datasink'
                ? [member.content.element]
                : []
    return fields.filter((value): value is string => typeof value === 'string')
}

describe('buildInstallationRequest', () => {
    it('sends the package header and the chosen datapool', () => {
        const request = buildInstallationRequest(bundleOf(TRAFFIC), POOL)
        expect(request.datapoolId).toBe(POOL)
        expect(request.package).toMatchObject({
            id: TRAFFIC,
            version: '1.5.0',
            title: 'Verkehrszählung',
        })
    })

    it('lists every member once, plus the dataset the use case becomes', () => {
        const request = buildInstallationRequest(bundleOf(TRAFFIC), POOL)
        expect(request.package.members.map((member) => member.kind)).toEqual([
            'datastructure',
            'datastructure',
            'datasource',
            'dataset',
            'mapping',
            'datasink',
            'pipeline',
        ])
    })

    it('derives the dataset from the manifest, in the namespace of the package', () => {
        const [dataset] = membersOf(buildInstallationRequest(bundleOf(TRAFFIC), POOL), 'dataset')
        expect(dataset.name).toBe('Verkehrszählung')
        expect(dataset.urn).toMatch(
            /^urn:core:standard:openurbanapps:dataset:mobility:verkehrszaehlung:[0-9a-z]{10}$/,
        )
        // Open data is the operator's call; a package must not publish on their behalf.
        expect(dataset.content).toEqual({ openDataAccess: false })
    })

    it('translates the titles a pipeline names into the package URNs of its siblings', () => {
        const entry = bundleOf(TRAFFIC)
        const [pipeline] = membersOf(buildInstallationRequest(entry, POOL), 'pipeline')
        const byId = Object.fromEntries(
            nodesOf(pipeline).map((node) => [String(node.id), node] as const),
        )

        expect(byId['n-source'].sourceRef).toBe(entry.bundle.dataSources[0].document.id)
        expect(byId['n-sink'].sinkRef).toBe(entry.bundle.dataSinks[0].document.id)
        // Authored as a URN already, so it is not looked up at all.
        expect(byId['n-mapping'].mappingRef).toBe(entry.bundle.mappings[0].mappingUrn)
    })

    it('leaves the package it was given untouched', () => {
        const entry = bundleOf(TRAFFIC)
        const before = structuredClone(entry)
        buildInstallationRequest(entry, POOL)
        expect(entry).toEqual(before)
    })

    it('carries the rest of the graph as authored', () => {
        const entry = bundleOf(TRAFFIC)
        const [pipeline] = membersOf(buildInstallationRequest(entry, POOL), 'pipeline')
        const authored = entry.bundle.pipelines[0].model
        expect(pipeline.content.edges).toEqual(authored.edges)
        expect(nodesOf(pipeline).map((node) => node['x-ui-position'])).toEqual(
            (authored.nodes as Record<string, unknown>[]).map((node) => node['x-ui-position']),
        )
    })

    it('drops client_id from a source and keeps every other field', () => {
        const entry = bundleOf(TRAFFIC)
        const authored = entry.bundle.dataSources[0].document
        // The fixture is a copy of the package repository; once the package stops shipping the
        // field, this test has nothing left to prove and should go with it.
        expect(authored).toHaveProperty('client_id')

        const [source] = membersOf(buildInstallationRequest(entry, POOL), 'datasource')
        expect(source.content).not.toHaveProperty('client_id')
        const kept = { ...authored }
        delete kept.client_id
        expect(source.content).toEqual(kept)
    })

    it('keeps every reference of every shipped package inside the package', () => {
        for (const entry of shippedUseCases()) {
            const { members } = buildInstallationRequest(entry, POOL).package
            const identities = new Set(members.map((member) => logicalUrn(member.urn)))
            for (const member of members) {
                for (const reference of referencesOf(member)) {
                    // Structures the platform publishes itself belong to no package.
                    if (reference.startsWith('urn:core:platform:')) continue
                    expect(
                        identities.has(logicalUrn(reference)),
                        `${entry.manifest.id}: ${member.name} → ${reference}`,
                    ).toBe(true)
                }
            }
        }
    })

    it('gives every member of every shipped package an identity of its own', () => {
        for (const entry of shippedUseCases()) {
            const { members } = buildInstallationRequest(entry, POOL).package
            for (const member of members) {
                expect(isCoreUrn(member.urn), `${entry.manifest.id}: ${member.name}`).toBe(true)
            }
            const identities = members.map((member) => logicalUrn(member.urn))
            expect(new Set(identities).size, entry.manifest.id).toBe(identities.length)
        }
    })

    it('tells apart two pipelines of the same name in two packages', () => {
        const importOf = (id: string) =>
            membersOf(buildInstallationRequest(bundleOf(id), POOL), 'pipeline').find(
                (member) => member.name === 'Kataster-Import',
            )!.urn

        expect(importOf('urn:openurbanapps:usecase:kiez-baumkataster')).not.toBe(
            importOf('urn:openurbanapps:usecase:jungbaum-bewaesserung'),
        )
    })

    it('keeps every description it sends within the portal limit', () => {
        for (const entry of shippedUseCases()) {
            for (const member of buildInstallationRequest(entry, POOL).package.members) {
                if (member.description === undefined) continue
                expect(
                    member.description.length,
                    `${entry.manifest.id}: ${member.name}`,
                ).toBeLessThanOrEqual(DESCRIPTION_MAX_LENGTH)
            }
        }
    })

    it('describes structures, sources and the dataset even when the package does not', () => {
        const entry = bundleOf(TRAFFIC)
        delete entry.bundle.dataStructures[0].description
        delete entry.bundle.dataSources[0].document.description

        const request = buildInstallationRequest(entry, POOL)
        // The platform refuses these three kinds without a description, and one missing sentence
        // is no reason to fail a whole install.
        expect(membersOf(request, 'datastructure')[0].description).toBe(
            'Aus Paket Verkehrszählung 1.5.0',
        )
        expect(membersOf(request, 'datasource')[0].description).toBe(
            'Aus Paket Verkehrszählung 1.5.0',
        )
    })

    it('sends the same request for the same package, every time', () => {
        expect(buildInstallationRequest(bundleOf(TRAFFIC), POOL)).toEqual(
            buildInstallationRequest(bundleOf(TRAFFIC), POOL),
        )
    })

    it('passes a reference through that already is a URN', () => {
        const entry = bundleOf(TRAFFIC)
        const installed = 'urn:core:platform:civitas:datasource:common:bestandsquelle:k3v9q0x1zt'
        const nodes = entry.bundle.pipelines[0].model.nodes as Record<string, unknown>[]
        nodes.find((node) => node.id === 'n-source')!.sourceRef = installed

        const [pipeline] = membersOf(buildInstallationRequest(entry, POOL), 'pipeline')
        expect(nodesOf(pipeline).find((node) => node.id === 'n-source')!.sourceRef).toBe(installed)
    })

    it('refuses a pipeline that names a title the package does not contain', () => {
        const entry = bundleOf(TRAFFIC)
        const nodes = entry.bundle.pipelines[0].model.nodes as Record<string, unknown>[]
        nodes.find((node) => node.id === 'n-sink')!.sinkRef = 'Tabelle, die es nicht gibt'

        expect(() => buildInstallationRequest(entry, POOL)).toThrow(InstallPayloadError)
        // The message has to name the pipeline, the field and the title: that is everything the
        // package author needs, and nothing the platform could have told them.
        expect(() => buildInstallationRequest(entry, POOL)).toThrow(
            /Zählung zu Messung.*sinkRef.*Tabelle, die es nicht gibt/,
        )
    })

    it('refuses a title that two members share', () => {
        const entry = bundleOf(TRAFFIC)
        const twin = structuredClone(entry.bundle.dataSources[0])
        twin.document.id =
            'urn:core:standard:openurbanapps:datasource:mobility:zweiterfeed:a1b2c3d4e5'
        entry.bundle.dataSources.push(twin)

        expect(() => buildInstallationRequest(entry, POOL)).toThrow(/mehrere Mitglieder/)
    })

    it('refuses two members with the same identity', () => {
        const entry = bundleOf(TRAFFIC)
        const twin = structuredClone(entry.bundle.dataSinks[0])
        twin.document.title = 'Zweite Tabelle'
        entry.bundle.dataSinks.push(twin)

        expect(() => buildInstallationRequest(entry, POOL)).toThrow(/dieselbe Kennung/)
    })

    it('refuses a member whose identity is not a CORE URN', () => {
        const entry = bundleOf(TRAFFIC)
        entry.bundle.dataSources[0].document.id = 'zaehlstellen-feed'

        expect(() => buildInstallationRequest(entry, POOL)).toThrow(
            /Datenquelle „Zählstellen-Feed“.*CORE-URN/,
        )
    })

    it('installs a structure entry as a package of one, without a datapool', () => {
        const pkg = mockPackages.find((candidate) => candidate.manifest.type === 'datastructure')!
        const request = buildInstallationRequest(entryOf(pkg.manifest.id), POOL)

        // A structure belongs to no datapool; sending one would ask the platform for a permission
        // the install does not need.
        expect(request.datapoolId).toBeUndefined()
        expect(request.package.members).toHaveLength(1)
        expect(request.package.members[0]).toMatchObject({
            kind: 'datastructure',
            urn: pkg.manifest.id,
            name: pkg.manifest.displayName,
        })
    })
})

describe('summarizeInstallation', () => {
    const line = (artifactType: string, name = artifactType) => ({ artifactType, name })

    it('counts what the platform recorded, kind by kind', () => {
        const summary = summarizeInstallation(
            {
                dataSetName: 'Verkehrszählung',
                artifacts: [
                    line('DATA_STRUCTURE'),
                    line('DATA_STRUCTURE'),
                    line('DATA_SOURCE'),
                    line('DATA_SET'),
                    line('MAPPING'),
                    line('DATA_SINK'),
                    line('PIPELINE'),
                ],
            },
            'Paketname',
        )
        expect(summary).toBe(
            'Dataset „Verkehrszählung“ als Entwurf angelegt · 2 Struktur(en) · 1 Quelle(n) · 1 Mapping(s) · 1 Senke(n) · 1 Pipeline(s)',
        )
    })

    it('names a kind that came out as zero instead of leaving it out', () => {
        const summary = summarizeInstallation(
            { artifacts: [line('DATA_STRUCTURE'), line('DATA_SET')] },
            'Paketname',
        )
        expect(summary).toContain('Dataset „Paketname“')
        expect(summary).toContain('0 Senke(n)')
        expect(summary).toContain('0 Pipeline(s)')
    })

    it('reports a structure on its own by name and URN', () => {
        const urn = 'urn:core:platform:civitas:datastructure:common:luftmessstation:4f2k9d0a1b'
        expect(
            summarizeInstallation(
                { artifacts: [{ artifactType: 'DATA_STRUCTURE', name: 'Luftmessstation', urn }] },
                'Paketname',
            ),
        ).toBe(`Datenstruktur „Luftmessstation“ angelegt · ${urn}`)
    })
})

describe('readFailure', () => {
    it('reads the sentence of a backend problem', () => {
        expect(readFailure(JSON.stringify({ status: 409, detail: 'Schon installiert.' }))).toEqual({
            detail: 'Schon installiert.',
        })
    })

    it('reads the bare reason the gateway policy answers with', () => {
        expect(readFailure('unknown_endpoint')).toEqual({ reason: 'unknown_endpoint' })
        expect(readFailure('"permission_denied"')).toEqual({ reason: 'permission_denied' })
    })

    it('takes an error page for nobody’s message', () => {
        expect(readFailure(`<html><body>${'Bad Gateway '.repeat(20)}</body></html>`)).toEqual({})
        expect(readFailure('')).toEqual({})
    })
})

describe('describeInstallFailure', () => {
    const problem = (detail: string) => JSON.stringify({ detail })

    it('passes the backend’s own sentence on for a conflict and for a rejected package', () => {
        expect(describeInstallFailure(409, 'Conflict', problem('Schon installiert.'))).toEqual({
            status: 'conflict',
            detail: 'Schon installiert.',
        })
        expect(describeInstallFailure(400, 'Bad Request', problem('Member needs a name.'))).toEqual({
            status: 'invalid',
            detail: 'Member needs a name.',
        })
    })

    it('names the missing permission when the gateway denies the install', () => {
        const failure = describeInstallFailure(403, 'Forbidden', 'permission_denied')
        expect(failure.status).toBe('error')
        expect(failure.detail).toContain('INSTALLATION_CREATE')
    })

    it('keeps the backend’s sentence when the backend itself refuses', () => {
        expect(
            describeInstallFailure(403, 'Forbidden', problem('No access to this datapool.')).detail,
        ).toBe('No access to this datapool.')
    })

    it('says so when the platform does not offer installations at all', () => {
        expect(describeInstallFailure(403, 'Forbidden', 'unknown_endpoint').detail).toContain(
            'POST /v1/installations',
        )
    })

    it('falls back to the status line when nothing else was said', () => {
        expect(describeInstallFailure(502, 'Bad Gateway', '').detail).toBe('502 Bad Gateway')
    })
})

describe('describeUninstallFailure', () => {
    it.each([
        [403, 'unknown_endpoint'],
        [405, ''],
        [404, ''],
    ])('says that uninstalling is not available yet (%i %s)', (httpStatus, body) => {
        const failure = describeUninstallFailure(httpStatus, 'status', body)
        expect(failure.status).toBe('error')
        expect(failure.detail).toContain('noch nicht deinstallieren')
    })

    it('does not mistake an unknown installation for a missing feature', () => {
        const body = JSON.stringify({ detail: 'Installation not found.' })
        expect(describeUninstallFailure(404, 'Not Found', body).detail).toBe(
            'Installation not found.',
        )
    })

    it('reports a refusal by the platform as a conflict, in its own words', () => {
        const body = JSON.stringify({ detail: 'The dataset is released.' })
        expect(describeUninstallFailure(409, 'Conflict', body)).toEqual({
            status: 'conflict',
            detail: 'The dataset is released.',
        })
    })
})
