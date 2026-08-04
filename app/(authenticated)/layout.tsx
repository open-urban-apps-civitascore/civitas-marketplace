import { signOut } from '@/auth'
import { requireSession } from '@/lib/session'

/**
 * Shell for signed-in pages. The route group `(authenticated)` keeps it out of
 * the URL, so pages below still live at /datastructures and so on.
 *
 * The session check here renders the shell only for signed-in users, but it is
 * not the guard: layouts do not re-render on navigation between pages that
 * share them. Each page calls requireSession() itself.
 */
export default async function AuthenticatedLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const session = await requireSession()

    return (
        <div className="flex min-h-full flex-col">
            <header className="flex items-center justify-between border-b border-black/10 px-6 py-3 dark:border-white/15">
                <span className="font-semibold">CIVITAS Marketplace</span>
                <div className="flex items-center gap-4 text-sm">
                    <span className="opacity-70">{session.user?.email}</span>
                    <form
                        action={async () => {
                            'use server'
                            await signOut({ redirectTo: '/login' })
                        }}
                    >
                        <button
                            type="submit"
                            className="rounded border border-black/15 px-3 py-1 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                        >
                            Abmelden
                        </button>
                    </form>
                </div>
            </header>
            <main className="flex-1 p-6">{children}</main>
        </div>
    )
}
