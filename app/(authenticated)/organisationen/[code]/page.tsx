import { notFound } from 'next/navigation'

import { OrganisationView } from '@/components/catalog/organisation-view'
import { listAddons } from '@/lib/addon-catalog'
import { entriesOf } from '@/lib/catalog/organisations'
import { getCatalogSummaries, getOrganisations } from '@/lib/catalog/source'
import { fetchInstalledCatalogEntryIds } from '@/lib/installations'
import { requireSession } from '@/lib/session'

/** One organisation: its contact, and the use cases it leads or publishes. Addressed by its permanent code. */
export default async function OrganisationPage({ params }: { params: Promise<{ code: string }> }) {
    await requireSession()
    const [{ code }, organisations, useCases, { addons }, installedIds] = await Promise.all([
        params,
        getOrganisations(),
        getCatalogSummaries('usecase'),
        listAddons(),
        fetchInstalledCatalogEntryIds(),
    ])
    const organisation = organisations.find((candidate) => candidate.id === code)
    if (!organisation) notFound()

    return <OrganisationView organisation={organisation} entries={entriesOf(code, useCases, addons)} installed={installedIds} />
}
