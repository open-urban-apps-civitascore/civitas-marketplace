import { LayoutGrid, LogOut } from 'lucide-react'

import { signOut } from '@/auth'
import { MobileNavTrigger } from '@/components/layout/app-shell'
import { ThemeToggle } from '@/components/layout/theme-toggle'

/**
 * Top bar of the authenticated shell: breadcrumb on the left, connection badge
 * and sign-out on the right. No avatar here — the CIVITAS/CORE portal header
 * carries none, and the signed-in identity already lives in the sidebar
 * footer (prototype design note). Sign-out goes through NextAuth so the
 * configured event also ends the Keycloak session, not just the local cookie.
 */
export function AppHeader({ breadcrumb = 'Katalog' }: { breadcrumb?: string }) {
    const connection = process.env.API_BASE_URL?.replace(/^https?:\/\//, '') ?? 'core'

    return (
        <header className="sticky top-0 z-10 flex h-13 items-center justify-between border-b bg-background px-4 py-2">
            <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
                <MobileNavTrigger />
                <LayoutGrid className="hidden size-4 shrink-0 text-muted-foreground sm:block" />
                <span className="truncate">{breadcrumb}</span>
            </div>

            <div className="flex shrink-0 items-center gap-3 sm:gap-4">
                <span className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground">
                    <span className="size-1.5 rounded-full bg-success" />
                    <span className="hidden sm:inline">Verbunden · {connection}</span>
                </span>
                <ThemeToggle />
                <form
                    action={async () => {
                        'use server'
                        await signOut({ redirectTo: '/login' })
                    }}
                >
                    <button
                        type="submit"
                        title="Abmelden"
                        className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                        <LogOut className="size-4" />
                    </button>
                </form>
            </div>
        </header>
    )
}
