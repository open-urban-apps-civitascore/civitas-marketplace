'use client'

import { useEffect } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'

import { applyTheme, THEME_STORAGE_KEY, THEMES, type Theme } from '@/lib/theme'

/**
 * Cycles light → dark → system. Deliberately holds NO React state for the
 * theme: the current value is read from <html> at click time, so the rendered
 * markup never depends on client-only state and there is nothing for hydration
 * to mismatch on. Which icon shows is decided by CSS from `data-theme`.
 */
export function ThemeToggle() {
    // While "system" is active, follow the OS if it changes underneath us.
    useEffect(() => {
        const media = window.matchMedia('(prefers-color-scheme: dark)')
        const onChange = () => {
            if (document.documentElement.dataset.theme === 'system') applyTheme('system')
        }
        media.addEventListener('change', onChange)
        return () => media.removeEventListener('change', onChange)
    }, [])

    function cycle() {
        const current = (document.documentElement.dataset.theme ?? 'system') as Theme
        const index = THEMES.indexOf(current)
        const next = THEMES[(index + 1) % THEMES.length]
        applyTheme(next)
        try {
            localStorage.setItem(THEME_STORAGE_KEY, next)
        } catch {
            // Private mode / blocked storage: the theme still applies for this
            // page view, it just will not be remembered.
        }
    }

    return (
        <button
            type="button"
            onClick={cycle}
            aria-label="Farbschema wechseln (hell, dunkel, System)"
            title="Farbschema wechseln"
            className="flex items-center text-muted-foreground transition-colors hover:text-foreground"
        >
            <Sun className="theme-icon theme-icon-light size-4" />
            <Moon className="theme-icon theme-icon-dark size-4" />
            <Monitor className="theme-icon theme-icon-system size-4" />
        </button>
    )
}
