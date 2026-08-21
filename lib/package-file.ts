/**
 * One file of a deployment package, carried with its encoding.
 *
 * Encoding has to travel with the content because a package is not guaranteed
 * to be text: a vendored chart archive, an icon or a font would be destroyed by
 * decoding it as UTF-8 and re-serialising it. Anything that is not valid UTF-8
 * is kept as base64 from the moment it is read until the moment it is
 * committed, so the bytes in a pull request are the bytes the maintainer
 * published.
 *
 * Lives in its own module so neither side owns the other: the catalogue reads
 * packages, the deployment-repo layer writes them, and both speak this shape.
 */
export interface PackageFile {
    content: string
    encoding: 'utf8' | 'base64'
}

/** A deployment package, keyed by path relative to the package root. */
export type AddonPackage = Record<string, PackageFile>

/** Wraps files that are known to be text — the bundled add-on's TypeScript sources. */
export function asTextPackage(files: Record<string, string>): AddonPackage {
    return Object.fromEntries(
        Object.entries(files).map(([path, content]) => [path, { content, encoding: 'utf8' as const }]),
    )
}
