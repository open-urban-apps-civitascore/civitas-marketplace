import { LayoutGrid, LogOut } from 'lucide-react'

import { signOut } from '@/auth'

/**
 * Top bar of the authenticated shell: breadcrumb on the left, connection badge
 * and sign-out on the right. Sign-out goes through NextAuth so the configured
 * event also ends the Keycloak session, not just the local cookie.
 */
export function AppHeader({
    breadcrumb = 'Katalog',
    userName,
}: {
    breadcrumb?: string
    userName?: string
}) {
    const initials = (userName ?? 'CV').substring(0, 2).toUpperCase()
    const connection = process.env.API_BASE_URL?.replace(/^https?:\/\//, '') ?? 'core'

    return (
        <header className="sticky top-0 z-10 flex h-13 items-center justify-between border-b bg-background px-4 py-2">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <LayoutGrid className="size-4 text-muted-foreground" />
                <span>{breadcrumb}</span>
            </div>

            <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground">
                    <span className="size-1.5 rounded-full bg-success" />
                    Verbunden · {connection}
                </span>
                <div className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {initials}
                </div>
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
