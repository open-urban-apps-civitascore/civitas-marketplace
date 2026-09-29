import { AppHeader } from '@/components/layout/app-header'
import { AppShell } from '@/components/layout/app-shell'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { requireSession } from '@/lib/session'

/**
 * Shell for signed-in pages: sidebar + header around a scrolling content area.
 * The route group `(authenticated)` keeps it out of the URL, so pages below
 * still live at /use-cases, /datastructures and so on.
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
    const userName = session.user?.name ?? session.user?.email ?? undefined

    return (
        <AppShell sidebar={<AppSidebar userName={userName} />}>
            <AppHeader />
            <div className="flex-1 overflow-y-auto bg-muted/40 p-4 sm:p-6">{children}</div>
        </AppShell>
    )
}
