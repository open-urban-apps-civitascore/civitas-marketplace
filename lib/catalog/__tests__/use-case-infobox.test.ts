import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { UseCaseInfobox } from '@/components/catalog/use-case-infobox'
import type { CatalogSummary } from '@/lib/catalog/types'

const entry = (contact: CatalogSummary['contact']) =>
    ({ id: 'urn:stadt:usecase:baeume', displayName: 'Bäume', description: 'Bäume', maintainer: 'Stadt', contact }) as CatalogSummary

const mailLink = (html: string) => html.match(/<a href="mailto:[^"]*" class="([^"]*)"/)?.[1] ?? ''

describe('the contact in „Auf einen Blick“', () => {
    it('makes an e-mail alone the line itself, and lets a long address wrap', () => {
        const alone = mailLink(renderToStaticMarkup(createElement(UseCaseInfobox, { entry: entry({ email: 'stadtgruen-baumkataster@beispielstadt.example' }) })))
        expect(alone).toContain('break-all')
        expect(alone).not.toContain('text-xs')
        const named = mailLink(renderToStaticMarkup(createElement(UseCaseInfobox, { entry: entry({ name: 'Grünflächenamt', email: 'gruen@beispielstadt.example' }) })))
        expect(named).toContain('text-xs')
        expect(named).toContain('break-all')
    })
})
