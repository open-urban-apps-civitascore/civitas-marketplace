import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { TextEditForm } from '@/components/export/text-edit-form'
import { PageHeader } from '@/components/ui/layout'
import { Notice } from '@/components/ui/notice'
import { exportConfig, exportReadiness, SHARING_NOT_SET_UP } from '@/lib/export/config'
import { readTextEditFill, type TextEditFill } from '@/lib/export/new-version-fill'
import { fetchShareRight, shareRefusal } from '@/lib/export/share-permission'
import { requireSession } from '@/lib/session'

type Query = Record<string, string | string[] | undefined>

const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '')

async function fillOf(query: Query): Promise<TextEditFill> {
    const config = exportConfig()
    if (exportReadiness(config) !== 'ready' || !config.catalog) return { refusal: SHARING_NOT_SET_UP }
    const refusal = shareRefusal(await fetchShareRight())
    return refusal ? { refusal } : readTextEditFill(one(query.target), one(query.slug), one(query.version))
}

export default async function TextEditPage({ searchParams }: { searchParams: Promise<Query> }) {
    await requireSession()
    const query = await searchParams
    const fill = await fillOf(query)

    return (
        <div className="flex flex-col gap-6">
            <Link href="/export/shared" className="inline-flex items-center gap-1 self-start text-sm font-medium text-primary underline-offset-2 hover:underline">
                <ArrowLeft aria-hidden className="size-4" />
                Zurück zu „Veröffentlicht“
            </Link>
            <PageHeader
                title="Texte ändern"
                lead={'refusal' in fill ? 'Korrigiere, was im Katalog über einen Anwendungsfall steht, ohne eine neue Version zu teilen.' : `„${fill.steckbrief.displayName}“, Version ${one(query.version)}`}
            />
            {'refusal' in fill ? (
                <Notice tone="neutral">{fill.refusal}</Notice>
            ) : (
                <TextEditForm edit={{ targetKey: one(query.target), slug: one(query.slug), version: one(query.version) }} steckbrief={fill.steckbrief} />
            )}
        </div>
    )
}
