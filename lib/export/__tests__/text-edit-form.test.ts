import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/session', () => ({ requireSession: vi.fn(), getAccessToken: vi.fn() }))
vi.mock('@/lib/export/text-edit-actions', () => ({ proposeTextEdit: vi.fn(), withdrawTextEdit: vi.fn() }))
vi.mock('@/components/export/share-listing-provider', () => ({ useShareListingReload: () => () => {}, useShareView: vi.fn() }))
vi.mock('next/link', () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement('a', { href, ...rest }, children),
}))

import { Published } from '@/components/export/published-shares'
import { TextEditForm } from '@/components/export/text-edit-form'
import { strictProblemsOf } from './wording-rules'
import type { SharedPackageRow } from '@/lib/export/share-listing'
import { shareTabs } from '@/lib/export/share-tabs'

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

const steckbrief = {
    from: '1.2.0', targetKey: 't', displayName: 'Bäume', description: 'Stadtbäume', publisher: 'stadt', slug: 'baeume',
    maintainer: 'Stadt Musterstadt', license: 'EUPL-1.2', keywords: 'baum', metadata: { contact: { email: 'amt@stadt.example' } }, full: true,
}

describe('the form „Texte ändern“', () => {
    const html = renderToStaticMarkup(createElement(TextEditForm, { edit: { targetKey: 't', slug: 'baeume', version: '1.2.0' }, steckbrief }))

    it('starts from the entry’s texts and says what stays', () => {
        expect(html).toContain('value="Bäume"')
        expect(html).toContain('value="amt@stadt.example"')
        expect(text(html)).toContain('Das Paket bleibt unverändert (Version 1.2.0), ebenso Herausgeber (Stadt Musterstadt) und Lizenz (EUPL-1.2).')
    })

    it('has nothing to propose until something changed, and no field for what stays', () => {
        expect(text(html)).toContain('Noch nichts geändert.')
        expect(text(html)).not.toContain('Das ändert sich')
        expect(html).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*Änderung vorschlagen/)
        expect(html).not.toContain('Lizenz *')
        expect(html).not.toContain('Herausgeber *')
    })

    it('keeps to the wording of the share pages', () => {
        expect(strictProblemsOf(text(html))).toEqual([])
    })
})

describe('a listed row with a text change open', () => {
    it('offers to withdraw it rather than a second one', () => {
        const HERE = 'https://portal.hier.example'
        const row: SharedPackageRow = {
            key: 't#export/baeume-1.2.0', targetKey: 't', targetLabel: 'Ablage', slug: 'baeume', version: '1.2.0', displayName: 'Bäume',
            bundleMr: { url: 'https://gitlab.example/1', state: 'merged' },
            source: { kind: 'dataset', id: 'ds', instance: HERE },
            packageId: 'urn:stadt:usecase:baeume',
            bundle: { state: 'on-base', packageId: 'urn:stadt:usecase:baeume', verification: { state: 'verified' } },
            catalog: { state: 'listed' },
            proposals: [{ kind: 'catalog', iid: 2, url: 'https://gitlab.example/2', state: 'merged' }],
            textChange: { iid: 33, url: 'https://gitlab.example/33', state: 'opened' },
        }
        const shown = text(renderToStaticMarkup(createElement(Published, { rows: shareTabs([row], { instance: HERE }).published, instance: HERE })))
        expect(shown).toContain('Textänderung in Prüfung (Vorschlag !33)')
        expect(shown).toContain('Textänderung zurückziehen')
        expect(shown).not.toContain('Texte ändern')
        expect(strictProblemsOf(shown)).toEqual([])
    })
})
