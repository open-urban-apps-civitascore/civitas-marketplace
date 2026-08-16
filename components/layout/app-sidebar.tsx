'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
    FileQuestion,
    FlaskConical,
    Hexagon,
    LayoutGrid,
    type LucideIcon,
    PackageCheck,
} from 'lucide-react'

import { cn } from '@/lib/utils'

interface NavItem {
    title: string
    href: string
    icon: LucideIcon
    children?: { title: string; href: string }[]
}

interface NavSection {
    title: string
    items: NavItem[]
}

const NAV_SECTIONS: NavSection[] = [
    {
        title: 'Plattform',
        items: [
            {
                title: 'Marketplace',
                href: '/use-cases',
                icon: LayoutGrid,
                children: [
                    { title: 'Use Cases', href: '/use-cases' },
                    { title: 'Add-ons', href: '/addons' },
                    { title: 'Datenstrukturen', href: '/datastructures' },
                ],
            },
            { title: 'Installiert', href: '/installed', icon: PackageCheck },
            { title: 'Install-Lab', href: '/install-lab', icon: FlaskConical },
        ],
    },
    {
        title: 'Hilfe',
        items: [{ title: 'Dokumentation', href: '/docs', icon: FileQuestion }],
    },
]

export function AppSidebar({
    tenantName = 'Stadt Musterstadt',
    userName,
    userRole = 'Plattform-Admin',
}: {
    tenantName?: string
    userName?: string
    userRole?: string
}) {
    const pathname = usePathname()
    const initials = (userName ?? 'CV').substring(0, 2).toUpperCase()

    return (
        <nav
            aria-label="Hauptnavigation"
            className="flex h-svh w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground"
        >
            <div className="flex items-center gap-2.5 p-3">
                <div className="flex size-9 items-center justify-center rounded-lg bg-[#036aa1]">
                    <Hexagon className="size-5 text-white" />
                </div>
                <div className="grid leading-tight">
                    <span className="truncate text-sm font-semibold">{tenantName}</span>
                    <span className="truncate text-xs text-muted-foreground">CIVITAS/CORE</span>
                </div>
            </div>

            <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-2 py-3">
                {NAV_SECTIONS.map((section) => (
                    <div key={section.title} className="flex flex-col gap-1">
                        <span className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {section.title}
                        </span>
                        {section.items.map((item) => {
                            const active =
                                pathname === item.href ||
                                item.children?.some((child) => pathname === child.href)

                            return (
                                <div key={item.title} className="flex flex-col">
                                    <Link
                                        href={item.href}
                                        className={cn(
                                            'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors',
                                            active
                                                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                                                : 'text-sidebar-foreground hover:bg-sidebar-accent/60',
                                        )}
                                    >
                                        <item.icon className="size-4 shrink-0" />
                                        <span className="truncate">{item.title}</span>
                                    </Link>
                                    {item.children && (
                                        <div className="ml-4 mt-1 flex flex-col gap-1 border-l pl-3">
                                            {item.children.map((child) => (
                                                <Link
                                                    key={child.title}
                                                    href={child.href}
                                                    className={cn(
                                                        'rounded-md px-2 py-1 text-sm transition-colors',
                                                        pathname === child.href
                                                            ? 'font-medium text-foreground'
                                                            : 'text-muted-foreground hover:text-foreground',
                                                    )}
                                                >
                                                    {child.title}
                                                </Link>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                ))}
            </div>

            <div className="flex items-center gap-2.5 border-t p-3">
                <div className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {initials}
                </div>
                <div className="grid leading-tight">
                    <span className="truncate text-sm font-medium">{userName ?? 'Angemeldet'}</span>
                    <span className="truncate text-xs text-muted-foreground">{userRole}</span>
                </div>
            </div>
        </nav>
    )
}
