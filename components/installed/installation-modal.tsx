'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'

/**
 * The overlay around one installation's overview on the installed page. The
 * page renders it from `?installation=<id>`, so the view has its own address:
 * the assistant links to it after an install, and a reload keeps it open.
 * Closing goes back to the plain list.
 */
export function InstallationModal({ title, badges, children }: { title: string; badges?: React.ReactNode; children: React.ReactNode }) {
    const router = useRouter()
    const close = () => router.push('/installed', { scroll: false })

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') router.push('/installed', { scroll: false })
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [router])

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={(event) => {
                if (event.target === event.currentTarget) close()
            }}
        >
            <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border bg-background shadow-xl">
                <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-semibold">{title}</h2>
                        {badges}
                    </div>
                    <button
                        type="button"
                        onClick={close}
                        aria-label="Schließen"
                        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                        <X className="size-4" />
                    </button>
                </div>
                <div className="overflow-y-auto p-5">{children}</div>
            </div>
        </div>
    )
}
