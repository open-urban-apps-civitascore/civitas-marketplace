import { describe, expect, it } from 'vitest'
import { draftMetadata, metadataDraft, METADATA_GROUPS, parseExportMetadata, type ExportMetadata } from '@/lib/export/metadata'
import { buildCatalogEntry, applyCatalogEntry } from '@/lib/export/catalog-entry'
import { pinnedRowSchema } from '@/lib/catalog/schema'
import { exportSources } from '@/lib/export/sources'

const metadata: ExportMetadata = {
    themes: ['umwelt-klima', 'planen-bauen'],
    contact: { name: 'Stadtgrün', role: 'Fachbereich', email: 'stadtgruen@kommune.example', url: 'https://kommune.example/kontakt' },
    media: [{ src: 'media/karte.png', alt: 'Karte der Bäume', caption: 'Baumbestand im Stadtgebiet' }],
    implementation: {
        status: 'produktiv', operator: 'Stadtverwaltung',
        parties: { stakeholders: ['Grünflächenamt', 'IT'], serviceProviders: ['Kommunales Rechenzentrum'] },
        stack: ['PostGIS', 'CIVITAS/CORE'],
        resources: { setupCost: 'm', runningCost: 's', effort: 'm', funding: 'Kommunaler Haushalt', note: 'Ohne vorhandene Hardware' },
        logicModel: { input: 'Katasterdaten', output: 'Karte', outcome: 'Abgestimmte Pflege', impact: 'Gesunde Stadtbäume' },
        collaboration: { wanted: false, seeking: 'Erfahrungsaustausch' },
        reference: { url: 'https://kommune.example/baeume', source: 'Kommunales Portal' },
    },
}
function entry() {
    return buildCatalogEntry({ id: 'urn:stadt:usecase:baeume', displayName: 'Bäume', description: 'Stadtbäume',
        version: '1.0.0', maintainer: 'Stadt', license: 'EUPL-1.2', keywords: ['baum'], metadata,
        repoUrl: 'https://gitlab.example/stadt/baeume', path: 'packages/baeume', commitSha: 'a'.repeat(40) })
}

describe('sharing metadata', () => {
    it('round-trips every descriptive schema field, including explicit false and all media fields', () => {
        const draft = metadataDraft(metadata)
        expect(parseExportMetadata(JSON.stringify(draftMetadata(draft)))).toEqual({ data: metadata })
        expect(pinnedRowSchema.parse(entry())).toMatchObject(metadata)
    })
    it('leaves unknown optional information absent', () => {
        expect(draftMetadata(metadataDraft())).toEqual({})
        expect(parseExportMetadata('')).toEqual({ data: {} })
    })
    it.each([
        { contact: { name: 'Amt' } },
        { contact: { email: 'bad-address' } },
        { implementation: { reference: { source: 'Portal' } } },
        { implementation: { collaboration: { seeking: 'Partner' } } },
        { implementation: { resources: { effort: '50 Tage' } } },
        { media: [{ src: '../private.png', alt: 'Bild' }] },
        { media: [{ src: 'media/image.png', alt: '' }] },
        { themes: ['made-up-theme'] },
        { curation: { tier: 'verified' } },
        { deploymentRef: { ref: 'main' } },
        { revoked: true },
    ])('rejects incomplete, invalid or process-owned fields: %j', (value) => {
        expect(parseExportMetadata(JSON.stringify(value)).error).toBeTruthy()
    })
    it('does not silently discard partially completed contact or media blocks', () => {
        const draft = metadataDraft()
        draft.fields['contact.name'] = 'Amt'
        draft.media = [{ src: 'media/image.png', alt: '', caption: '' }]
        const result = parseExportMetadata(JSON.stringify(draftMetadata(draft)))
        expect(result.error).toContain('contact')
        expect(result.error).toContain('media.0.alt')
    })
    it('updates metadata even at the same version and pin, requiring fresh review', () => {
        const previous = { ...entry(), curation: { tier: 'verified', reviewedBy: 'Team', reviewedAt: '2026-09-24' } }
        const index = JSON.stringify({ version: '3.0.0', useCases: [previous] })
        expect(applyCatalogEntry(index, entry()).status).toBe('unchanged')
        const edit = applyCatalogEntry(index, { ...entry(), description: 'Aktualisierte Beschreibung' })
        expect(edit.status).toBe('replaced')
        if (edit.status !== 'replaced' && edit.status !== 'added') return
        const row = JSON.parse(edit.content).useCases[0]
        expect(row.description).toBe('Aktualisierte Beschreibung')
        expect(row.curation).toBeUndefined()
        expect(row.implementation).toEqual(metadata.implementation)
    })
    it('declares every form field at a path the schema keeps', () => {
        // The field model is keyed by dotted strings, so a typo type-checks. The
        // check that catches one is whether the value SURVIVES validation:
        // `exportMetadataSchema` is strict at the top level and its nested blocks
        // strip what they do not declare, so a mistyped path is silently dropped
        // — which is exactly the bug, and what walking the pre-validation object
        // could never see.
        const draft = metadataDraft()
        for (const field of METADATA_GROUPS.flatMap((group) => group.fields)) {
            draft.fields[field.path] = field.options
                ? Object.keys(field.options)[0]
                : field.kind === 'email'
                  ? 'amt@kommune.example'
                  : field.kind === 'url'
                    ? 'https://kommune.example/seite'
                    : field.kind === 'list'
                      ? 'Erster\nZweiter'
                      : 'Wert'
        }
        draft.themes = ['umwelt-klima']
        draft.media = [{ src: 'media/bild.png', alt: 'Bild', caption: '' }]

        const result = parseExportMetadata(JSON.stringify(draftMetadata(draft)))
        expect(result.error).toBeUndefined()

        for (const field of METADATA_GROUPS.flatMap((group) => group.fields)) {
            let node: unknown = result.data
            for (const part of field.path.split('.')) {
                node = node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined
            }
            expect(node, `${field.path} did not survive validation — is it a real schema path?`).toBeDefined()
        }
    })

    it('offers the 36-month total the catalogue asks for', () => {
        const paths = METADATA_GROUPS.flatMap((group) => group.fields).map((field) => field.path)
        expect(paths).toContain('implementation.resources.totalCost')
    })

    it('lets an author CLEAR a field they had filled in before', () => {
        // Owned keys are the export's to set and to clear. Carrying an emptied
        // one over would mean a contact removed in the form silently returns.
        const index = JSON.stringify({ version: '3.0.0', useCases: [entry()] })
        const cleared = buildCatalogEntry({
            id: 'urn:stadt:usecase:baeume', displayName: 'Bäume', description: 'Stadtbäume',
            version: '1.0.0', maintainer: 'Stadt', license: 'EUPL-1.2', keywords: ['baum'],
            metadata: { ...metadata, contact: undefined, media: undefined },
            repoUrl: 'https://gitlab.example/stadt/baeume', path: 'packages/baeume', commitSha: 'a'.repeat(40),
        })
        const edit = applyCatalogEntry(index, cleared)
        expect(edit.status).toBe('replaced')
        if (edit.status !== 'replaced' && edit.status !== 'added') return
        const row = JSON.parse(edit.content).useCases[0]
        expect(row.contact).toBeUndefined()
        expect(row.media).toBeUndefined()
        expect(row.themes).toEqual(metadata.themes)
    })

    it('keeps a release tag when the pin is unchanged, drops it when the commit moves', () => {
        const tagged = { ...entry(), deploymentRef: { ...(entry().deploymentRef as object), releaseTag: 'v2.0.0' } }
        const index = JSON.stringify({ version: '3.0.0', useCases: [tagged] })
        // Same commit, changed prose: the tag still names that commit.
        const same = applyCatalogEntry(index, { ...entry(), description: 'Neu' })
        expect(same.status).toBe('replaced')
        if (same.status !== 'replaced' && same.status !== 'added') return
        expect(JSON.parse(same.content).useCases[0].deploymentRef.releaseTag).toBe('v2.0.0')
        // A re-share of exactly the same content is not a change at all.
        expect(applyCatalogEntry(index, entry()).status).toBe('unchanged')
        // A different commit invalidates the old tag.
        const moved = applyCatalogEntry(index, { ...entry(), deploymentRef: { ...(entry().deploymentRef as object), ref: 'b'.repeat(40) } })
        if (moved.status !== 'replaced' && moved.status !== 'added') return
        expect(JSON.parse(moved.content).useCases[0].deploymentRef.releaseTag).toBeNull()
    })

    it('writes keys in the order the hand-curated rows use', () => {
        // Checked against index.json: identity, themes, the pin, then the rest.
        // Any other order turns a one-field change into a whole-row diff for
        // whoever reviews the merge request.
        expect(Object.keys(entry())).toEqual([
            'id', 'type', 'displayName', 'description', 'version', 'maintainer',
            'license', 'keywords', 'themes', 'deploymentRef', 'contact', 'media',
            'implementation',
        ])
    })

    it('leaves a replaced row in the same key order, extras last', () => {
        const previous = { ...entry(), deprecated: { reason: 'Nachfolger vorhanden.' } }
        const index = JSON.stringify({ version: '3.0.0', useCases: [previous] })
        const edit = applyCatalogEntry(index, { ...entry(), description: 'Neu' })
        if (edit.status !== 'replaced' && edit.status !== 'added') return
        expect(Object.keys(JSON.parse(edit.content).useCases[0])).toEqual([
            ...Object.keys(entry()),
            'deprecated',
        ])
    })

    it('refuses to re-share onto a withdrawn id instead of reporting success', () => {
        // `revoked` is curator-owned and survives the write, so without this the
        // author would be told the entry landed while the catalogue kept hiding
        // it. Reinstating a withdrawal is a curation decision.
        const previous = { ...entry(), revoked: true, revokedReason: 'Repository nicht mehr öffentlich.' }
        const index = JSON.stringify({ version: '3.0.0', useCases: [previous] })
        const edit = applyCatalogEntry(index, { ...entry(), description: 'Neu' })
        expect(edit.status).toBe('withdrawn')
        if (edit.status !== 'withdrawn') return
        expect(edit.reason).toBe('Repository nicht mehr öffentlich.')
    })

    it('carries curator-only fields across a re-export, but never the verdict', () => {
        const previous = {
            ...entry(),
            deprecated: { reason: 'Nachfolger vorhanden.', successorId: 'urn:stadt:usecase:neu' },
            curation: { tier: 'verified', reviewedBy: 'Team', reviewedAt: '2026-09-24' },
        }
        const index = JSON.stringify({ version: '3.0.0', useCases: [previous] })
        const edit = applyCatalogEntry(index, { ...entry(), description: 'Neu' })
        expect(edit.status).toBe('replaced')
        if (edit.status !== 'replaced' && edit.status !== 'added') return
        const row = JSON.parse(edit.content).useCases[0]
        expect(row.deprecated).toEqual(previous.deprecated)
        expect(row.curation).toBeUndefined()
    })

    it('offers only readable datasets and prefills only an unambiguous active installation', () => {
        const parsed = pinnedRowSchema.parse(entry())
        const row = { ...parsed, deploymentRef: { ...parsed.deploymentRef, releaseTag: parsed.deploymentRef.releaseTag ?? null, path: parsed.deploymentRef.path ?? '.' } }
        const sources = exportSources([{ id: 'local', name: 'Lokale Bäume' }, { id: 'own', name: 'Bäume' }], [
            { dataSetId: 'local', catalogEntryId: row.id },
            { dataSetId: 'inaccessible', catalogEntryId: row.id },
            { dataSetId: 'own', catalogEntryId: row.id, uninstalledAt: '2026-09-20' },
        ], [row])
        expect(sources).toHaveLength(2)
        // Package fields carry over; the previous operator's account of THEIR
        // deployment does not. Prefilling it would put another municipality's
        // operator, costs, funding and named contact into a submission whose
        // output is a public, git-mirrored row (D12: supplied is not copied).
        expect(sources[0].catalog?.metadata).toEqual({ themes: metadata.themes })
        expect(sources[0].catalog?.metadata.contact).toBeUndefined()
        expect(sources[0].catalog?.metadata.implementation).toBeUndefined()
        expect(sources[0].catalog?.metadata.media).toBeUndefined()
        expect(sources[0].catalog?.displayName).toBe('Bäume')
        expect(sources[0].catalog).not.toHaveProperty('curation')
        expect(sources[1].catalog).toBeUndefined()
        expect(exportSources([{ id: 'local', name: 'Bäume' }], [
            { dataSetId: 'local', catalogEntryId: row.id }, { dataSetId: 'local', catalogEntryId: 'another' },
        ], [row])[0].catalog).toBeUndefined()
    })
})
