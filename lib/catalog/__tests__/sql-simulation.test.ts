import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { assembleCatalogEntry } from '@/lib/catalog/assemble'
import { isSqlSimulation, type PackageManifest } from '@/lib/catalog/types'
import { planSimulations } from '@/lib/simulator/registration'

/**
 * The SQL transport, from package to simulator registration.
 *
 * D14 gave the generator a SQL transport but the bundle format was never
 * extended, so a package could not describe one — a use case whose static half
 * came from the simulator had to be wired by hand. These cases pin the shape.
 */
const DIR = path.resolve(import.meta.dirname, '../../mock-catalog/jungbaum-bewaesserung')
const read = (file: string) => JSON.parse(readFileSync(path.join(DIR, file), 'utf8'))

function entry() {
    const assembled = assembleCatalogEntry(read('manifest.json') as PackageManifest, read)
    if (!('bundle' in assembled)) throw new Error('expected a use case')
    return assembled
}

describe('a package that bundles both a SQL and an MQTT scenario', () => {
    it('assembles, and keeps the two transports apart', () => {
        const simulations = entry().bundle.simulations
        expect(simulations).toHaveLength(2)
        const sql = simulations.filter(isSqlSimulation)
        expect(sql).toHaveLength(1)
        expect(sql[0].table.primaryKey).toBe('baum_id')
        expect(sql[0].maxRows).toBeGreaterThan(sql[0].seedRows ?? 0)
    })

    it('registers the table once and every MQTT stream separately', () => {
        const planned = planSimulations(entry(), 'inst-42', 'tcp://broker:1883')
        const sql = planned.filter((p) => p.input.transport.kind === 'sql')
        const mqtt = planned.filter((p) => p.input.transport.kind === 'mqtt')
        // A table is one shape, not one per stream.
        expect(sql).toHaveLength(1)
        expect(mqtt).toHaveLength(8)
        const transport = sql[0].input.transport
        if (transport.kind !== 'sql') throw new Error('expected sql')
        expect(transport.table).toBe('kataster.jungbaeume')
        // Where the platform READS, so the generator can refuse to fill a table
        // in a different database than the one anybody queries (D14).
        expect(transport.readDsn).toContain('fachverfahren')
        expect(sql[0].input.scenario.maxRows).toBe(40)
    })

    it('refuses a field that is not a declared column', () => {
        const manifest = read('manifest.json') as PackageManifest
        expect(() =>
            assembleCatalogEntry(manifest, (file) => {
                const doc = read(file)
                if (file === 'jungbaumkataster.simulation.json') {
                    return { ...doc, fields: { ...doc.fields, tippfehler: { kind: 'now' } } }
                }
                return doc
            }),
        ).toThrow(/not a declared column/)
    })

    it('refuses a SQL scenario pointed at an MQTT datasource', () => {
        const manifest = read('manifest.json') as PackageManifest
        expect(() =>
            assembleCatalogEntry(manifest, (file) => {
                const doc = read(file)
                if (file === 'jungbaumkataster.simulation.json') {
                    return { ...doc, sourceRef: 'Bodenfeuchte-Feed' }
                }
                return doc
            }),
        ).toThrow(/needs a SQL datasource/)
    })
})
