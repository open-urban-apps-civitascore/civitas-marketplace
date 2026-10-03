import { describe, expect, it } from 'vitest'
import { createZip, readZip } from '../zip'

describe('zip reader & writer', () => {
    it('creates and reads back a ZIP archive with multiple files', () => {
        const originalFiles: Record<string, string> = {
            'metadata.yaml': 'version: 1.0.0\ntype: Dashboard\n',
            'dashboards/traffic.yaml': 'dashboard_title: Traffic Monitoring\nslug: traffic\n',
            'charts/speed_chart.yaml': 'slice_name: Average Speed\nviz_type: line\n',
            'datasets/payload_data/verkehrsmessung.yaml': 'table_name: verkehrsmessung\nschema: ds_template\n',
        }

        const zipBuffer = createZip(originalFiles)
        expect(Buffer.isBuffer(zipBuffer)).toBe(true)
        expect(zipBuffer.length).toBeGreaterThan(0)

        const extracted = readZip(zipBuffer)
        expect(Object.keys(extracted).sort()).toEqual(Object.keys(originalFiles).sort())

        for (const [name, content] of Object.entries(originalFiles)) {
            expect(extracted[name].toString('utf-8')).toBe(content)
        }
    })

    it('handles binary buffer inputs correctly', () => {
        const binaryData = Buffer.from([0x00, 0xff, 0x12, 0x34, 0x56, 0x78])
        const zipBuffer = createZip({ 'binary.bin': binaryData })
        const extracted = readZip(zipBuffer)
        expect(extracted['binary.bin']).toEqual(binaryData)
    })

    it('throws on non-zip buffers', () => {
        const garbage = Buffer.from('this is not a zip file')
        expect(() => readZip(garbage)).toThrow(/Not a valid ZIP file/)
    })
})
