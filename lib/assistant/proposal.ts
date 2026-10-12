import { z } from 'zod'

import type { DataStructureEntry } from '@/lib/catalog/types'
import { compactName, deriveDisambiguator, urnSegment } from '@/lib/export/urn'

/**
 * What the assistant proposes when someone describes data to be set up: the
 * content of one data structure. The model only shapes the content; the CORE
 * envelope ($schema, $id, and only the field keywords the catalogue's own
 * structures use) is built here, so a creative answer cannot produce a
 * document the platform refuses.
 */

const FIELD_TYPES = ['string', 'number', 'integer', 'boolean'] as const

export const proposalSchema = z.object({
    title: z.string().min(3).max(80),
    description: z.string().min(10).max(400),
    domain: z.string().min(2).max(40),
    objects: z
        .array(
            z.object({
                name: z.string().min(1).max(60),
                description: z.string().max(300).optional(),
                fields: z
                    .array(
                        z.object({
                            name: z.string().min(1).max(60),
                            type: z.enum(FIELD_TYPES),
                            dateTime: z.boolean().optional(),
                            description: z.string().max(300),
                            required: z.boolean().optional(),
                        }),
                    )
                    .min(1)
                    .max(40),
            }),
        )
        .min(1)
        .max(8),
})

export type StructureProposal = z.infer<typeof proposalSchema>

/** The proposal tool's input schema, as the model sees it. `reply` is the model's explanation. */
export const PROPOSAL_TOOL_SCHEMA: Record<string, unknown> = {
    type: 'object',
    properties: {
        reply: { type: 'string', description: 'Kurze Erklärung des Vorschlags auf Deutsch, 1-3 Sätze.' },
        title: { type: 'string', description: 'Titel der Datenstruktur, deutsch, z. B. "Umwelt-Messstation".' },
        description: { type: 'string', description: 'Ein bis zwei Sätze, was die Struktur beschreibt.' },
        domain: {
            type: 'string',
            description:
                'Fachbereich als ein englisches Wort, klein: environment, mobility, energy, water, buildings, health oder general.',
        },
        objects: {
            type: 'array',
            description: 'Die Objekte der Struktur, z. B. Messstation und Messwert.',
            items: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Objektname in PascalCase, deutsch, ohne Umlaute, z. B. "Messwert".' },
                    description: { type: 'string' },
                    fields: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string', description: 'Feldname in camelCase, ohne Umlaute, z. B. "zeitstempel".' },
                                type: { type: 'string', enum: [...FIELD_TYPES] },
                                dateTime: { type: 'boolean', description: 'true für Zeitpunkte (type ist dann string).' },
                                description: { type: 'string', description: 'Deutsch, mit Einheit, z. B. "Feinstaub PM10 in µg/m³".' },
                                required: { type: 'boolean' },
                            },
                            required: ['name', 'type', 'description'],
                        },
                    },
                },
                required: ['name', 'fields'],
            },
        },
    },
    required: ['reply', 'title', 'description', 'domain', 'objects'],
}

const UMLAUTS: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' }

/** A JSON property or $defs key: ASCII letters, digits and underscore, starting with a letter. */
function identifier(value: string, fallback: string): string {
    const ascii = value.replace(/[äöüÄÖÜß]/g, (c) => UMLAUTS[c] ?? c).replace(/[^A-Za-z0-9_]/g, '')
    return /^[A-Za-z]/.test(ascii) ? ascii : fallback
}

/**
 * The proposal as a catalogue entry of type data structure, in the shape of
 * the catalogue's own structures (`air-quality-station`): JSON Schema 2020-12
 * with one object per `$defs` entry. The identity is fresh per proposal, so a
 * changed proposal installs as a new structure instead of meeting "already
 * installed".
 */
export function proposalToEntry(proposal: StructureProposal, now = Date.now()): DataStructureEntry {
    const name = compactName(proposal.title)
    const domain = urnSegment(proposal.domain, 'general')
    const urn = `urn:core:standard:openurbanapps:datastructure:${domain}:${name}:${deriveDisambiguator(`assistant#${name}#${now}`)}`

    const defs: Record<string, unknown> = {}
    proposal.objects.forEach((object, index) => {
        const properties: Record<string, unknown> = {}
        const required: string[] = []
        for (const field of object.fields) {
            const key = identifier(field.name, `feld${Object.keys(properties).length + 1}`)
            properties[key] = {
                type: field.dateTime ? 'string' : field.type,
                ...(field.dateTime ? { format: 'date-time' } : {}),
                description: field.description,
            }
            if (field.required) required.push(key)
        }
        defs[identifier(object.name, `Objekt${index + 1}`)] = {
            type: 'object',
            ...(object.description ? { description: object.description } : {}),
            properties,
            ...(required.length ? { required } : {}),
        }
    })

    return {
        manifest: {
            id: urn,
            type: 'datastructure',
            displayName: proposal.title,
            description: proposal.description,
            version: '1.0.0',
            maintainer: 'Assistent (Open Urban Apps)',
            license: 'EUPL-1.2',
            keywords: ['assistent'],
        },
        artifact: {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            $id: urn,
            title: proposal.title,
            description: proposal.description,
            $defs: defs,
        },
    }
}
