import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// A static render never submits the form and never refreshes the page.
vi.mock('@/lib/install-actions', () => ({ uninstallInstallation: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('next/link', () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement('a', { href, ...rest }, children),
}))

import { InstallationSection } from '@/components/catalog/installation-section'
import type { DatasetOverview } from '@/lib/datapool-of-dataset'

const DATASET = { id: 'ds-1', name: 'Pegel Rundlauf' }

/** The page section of an installation with one dataset, read with the given overview. */
function render(overview: DatasetOverview | null): string {
    return renderToStaticMarkup(
        createElement(InstallationSection, {
            installation: { id: 'uc-1', dataSets: [DATASET], hasDataSource: true },
            datasets: [{ ...DATASET, overview }],
            dashboards: [],
            streams: null,
        }),
    )
}

/** The opening tag of the uninstall button. */
function uninstallButton(html: string): string {
    const button = (html.match(/<button[^>]*>/g) ?? []).find((tag) => tag.includes('type="submit"'))
    if (!button) throw new Error('no uninstall button in the section')
    return button
}

describe('the uninstall button of an installed use case', () => {
    it.each([
        ['a draft dataset', { datapool: null, status: 'DRAFT' }],
        ['a staged dataset', { datapool: null, status: 'READY' }],
        ['a dataset that was deleted in the portal', null],
    ])('can be clicked for %s, because nothing the page sees is in the way', (_, overview) => {
        // The attribute, not the word: the class names carry Tailwind's `disabled:` variants.
        expect(uninstallButton(render(overview))).not.toContain('disabled=""')
    })

    it('cannot be clicked for a released dataset, and the page says why', () => {
        const html = render({ datapool: null, status: 'AVAILABLE' })
        expect(uninstallButton(html)).toContain('disabled=""')
        expect(uninstallButton(html)).toContain('aria-describedby="uninstall-blocker"')
        expect(html).toContain('Der Datensatz ist im Portal freigegeben.')
    })
})
