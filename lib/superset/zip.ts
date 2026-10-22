import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'

/**
 * Lightweight, zero-dependency ZIP reader and writer for Superset asset bundles.
 * Uses Node's built-in zlib for compression/decompression and CRC-32 calculation.
 */

export interface ZipEntry {
    name: string
    data: Buffer
}

export function createZip(files: Record<string, string | Buffer>): Buffer {
    const localHeaders: Buffer[] = []
    const centralEntries: Buffer[] = []
    let offset = 0

    const entries = Object.entries(files).map(([name, content]) => ({
        name: name.replace(/\\/g, '/'),
        data: Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8'),
    }))

    for (const entry of entries) {
        const filenameBuf = Buffer.from(entry.name, 'utf-8')
        const uncompressedSize = entry.data.length
        const fileCrc = crc32(entry.data)
        const compressedData = deflateRawSync(entry.data)
        const compressedSize = compressedData.length

        // Local file header (30 bytes + filename)
        const localHeader = Buffer.alloc(30 + filenameBuf.length)
        localHeader.writeUInt32LE(0x04034b50, 0) // signature
        localHeader.writeUInt16LE(20, 4) // version needed
        localHeader.writeUInt16LE(0, 6) // general purpose flag
        localHeader.writeUInt16LE(8, 8) // compression: deflate
        localHeader.writeUInt16LE(0, 10) // last mod time
        localHeader.writeUInt16LE(0, 12) // last mod date
        localHeader.writeUInt32LE(fileCrc, 14) // crc32
        localHeader.writeUInt32LE(compressedSize, 18) // compressed size
        localHeader.writeUInt32LE(uncompressedSize, 22) // uncompressed size
        localHeader.writeUInt16LE(filenameBuf.length, 26) // filename length
        localHeader.writeUInt16LE(0, 28) // extra field length
        filenameBuf.copy(localHeader, 30)

        localHeaders.push(localHeader, compressedData)

        // Central directory header (46 bytes + filename)
        const centralEntry = Buffer.alloc(46 + filenameBuf.length)
        centralEntry.writeUInt32LE(0x02014b50, 0) // signature
        centralEntry.writeUInt16LE(20, 4) // version made by
        centralEntry.writeUInt16LE(20, 6) // version needed
        centralEntry.writeUInt16LE(0, 8) // flags
        centralEntry.writeUInt16LE(8, 10) // compression: deflate
        centralEntry.writeUInt16LE(0, 12) // time
        centralEntry.writeUInt16LE(0, 14) // date
        centralEntry.writeUInt32LE(fileCrc, 16) // crc32
        centralEntry.writeUInt32LE(compressedSize, 20) // compressed size
        centralEntry.writeUInt32LE(uncompressedSize, 24) // uncompressed size
        centralEntry.writeUInt16LE(filenameBuf.length, 28) // filename length
        centralEntry.writeUInt16LE(0, 30) // extra length
        centralEntry.writeUInt16LE(0, 32) // comment length
        centralEntry.writeUInt16LE(0, 34) // disk number start
        centralEntry.writeUInt16LE(0, 36) // internal attrs
        centralEntry.writeUInt32LE(0, 38) // external attrs
        centralEntry.writeUInt32LE(offset, 42) // relative offset of local header
        filenameBuf.copy(centralEntry, 46)

        centralEntries.push(centralEntry)
        offset += localHeader.length + compressedData.length
    }

    const centralDirectory = Buffer.concat(centralEntries)
    const cdSize = centralDirectory.length
    const cdOffset = offset

    // End of central directory record (22 bytes)
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0) // signature
    eocd.writeUInt16LE(0, 4) // disk number
    eocd.writeUInt16LE(0, 6) // disk with CD
    eocd.writeUInt16LE(entries.length, 8) // total entries on this disk
    eocd.writeUInt16LE(entries.length, 10) // total entries
    eocd.writeUInt32LE(cdSize, 12) // size of CD
    eocd.writeUInt32LE(cdOffset, 16) // offset of CD
    eocd.writeUInt16LE(0, 20) // comment length

    return Buffer.concat([...localHeaders, centralDirectory, eocd])
}

export function readZip(buffer: Buffer): Record<string, Buffer> {
    const result: Record<string, Buffer> = {}

    // Find EOCD from the back
    let eocdOffset = -1
    for (let i = buffer.length - 22; i >= 0; i--) {
        if (buffer.readUInt32LE(i) === 0x06054b50) {
            eocdOffset = i
            break
        }
    }
    if (eocdOffset === -1) {
        throw new Error('Not a valid ZIP file: End of Central Directory record not found')
    }

    const totalEntries = buffer.readUInt16LE(eocdOffset + 10)
    const cdOffset = buffer.readUInt32LE(eocdOffset + 16)

    let cursor = cdOffset
    for (let i = 0; i < totalEntries; i++) {
        if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
            throw new Error(`Corrupt central directory entry at offset ${cursor}`)
        }
        const compressionMethod = buffer.readUInt16LE(cursor + 10)
        const compressedSize = buffer.readUInt32LE(cursor + 20)
        const uncompressedSize = buffer.readUInt32LE(cursor + 24)
        const filenameLen = buffer.readUInt16LE(cursor + 28)
        const extraLen = buffer.readUInt16LE(cursor + 30)
        const commentLen = buffer.readUInt16LE(cursor + 32)
        const localHeaderOffset = buffer.readUInt32LE(cursor + 42)

        const filename = buffer.toString('utf-8', cursor + 46, cursor + 46 + filenameLen)
        cursor += 46 + filenameLen + extraLen + commentLen

        // Read local file header to locate compressed data
        if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
            throw new Error(`Corrupt local header for file '${filename}' at offset ${localHeaderOffset}`)
        }
        const localFilenameLen = buffer.readUInt16LE(localHeaderOffset + 26)
        const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28)
        const dataOffset = localHeaderOffset + 30 + localFilenameLen + localExtraLen

        const rawData = buffer.subarray(dataOffset, dataOffset + compressedSize)
        let decompressed: Buffer
        if (compressionMethod === 0) {
            decompressed = Buffer.from(rawData)
        } else if (compressionMethod === 8) {
            decompressed = inflateRawSync(rawData)
        } else {
            throw new Error(`Unsupported compression method ${compressionMethod} for file '${filename}'`)
        }

        if (uncompressedSize > 0 && decompressed.length !== uncompressedSize) {
            throw new Error(`Size mismatch for '${filename}': expected ${uncompressedSize}, got ${decompressed.length}`)
        }

        result[filename] = decompressed
    }

    return result
}
