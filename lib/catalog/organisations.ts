import type { ParsedAddon } from '@/lib/addon-catalog/listing'
import type { CatalogSummary, Organisation } from '@/lib/catalog/types'

export const organisationHref = (code: string) => `/organisationen/${code}`

/**
 * The page behind „Federführende Organisation“, which shows the operator, else the publisher.
 * Only for an organisation the catalogue lists: an unknown code stays plain text.
 */
export function leadOrganisationHref(
    entry: Pick<CatalogSummary, 'implementation' | 'maintainerOrg'>,
    organisations: readonly Organisation[],
): string | undefined {
    const code = entry.implementation?.operator ? entry.implementation.operatorOrg : entry.maintainerOrg
    return code && organisations.some((organisation) => organisation.id === code) ? organisationHref(code) : undefined
}

export interface OrganisationEntries {
    led: CatalogSummary[]
    published: CatalogSummary[]
    addons: ParsedAddon[]
}

/** Each use case once, under its stronger role: leading it before publishing it. */
export function entriesOf(code: string, useCases: readonly CatalogSummary[], addons: readonly ParsedAddon[]): OrganisationEntries {
    const led = useCases.filter((entry) => entry.implementation?.operatorOrg === code)
    return {
        led,
        published: useCases.filter((entry) => entry.maintainerOrg === code && !led.includes(entry)),
        addons: addons.filter((addon) => addon.listing.publisherOrg === code),
    }
}

/** „Stadt“, „Gemeinde“ …: the prefix tells nobody apart, so monograms and codes leave it out. */
export const ADMIN_PREFIX =/^(Stadt|Gemeinde|Landkreis|Kreis|Markt|Hansestadt|Samtgemeinde|Verbandsgemeinde|Amt|Bezirk)\s+/i

export function monogram(name: string): string {
    const core = name.replace(ADMIN_PREFIX, '').trim() || name
    const words = core.split(/[\s-]+/).filter(Boolean)
    return (words.length >= 2 ? words[0][0] + words[1][0] : core.slice(0, 2)).toUpperCase()
}
