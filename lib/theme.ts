export const THEME_STORAGE_KEY = 'civitas-marketplace-theme'

/** `system` follows the OS setting and keeps following it while it is active. */
export type Theme = 'light' | 'dark' | 'system'

export const THEMES: readonly Theme[] = ['light', 'dark', 'system']

/**
 * Applies a theme to <html>. Kept in one place because the inline script below
 * and the toggle must agree exactly — if they drift, the pre-paint state and
 * the post-click state disagree and the theme flickers on the next load.
 */
export function applyTheme(theme: Theme): void {
    const dark =
        theme === 'dark' ||
        (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    const root = document.documentElement
    // toggle(), never className = … : <html> carries the next/font variable
    // classes and the layout classes, which a whole-string assignment erases.
    root.classList.toggle('dark', dark)
    root.dataset.theme = theme
}

/**
 * Runs synchronously in <head>, before the browser paints anything — the only
 * placement that avoids a flash of the wrong theme. `next/script` cannot do
 * this in the App Router: `beforeInteractive` inline scripts are queued and
 * replayed by the Next runtime after the bundle executes, i.e. after paint.
 *
 * Minified by hand because it is injected verbatim into the HTML of every
 * response. Mirrors applyTheme(); the try/catch covers localStorage being
 * unavailable (private mode, blocked cookies).
 */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
    THEME_STORAGE_KEY,
)})||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.dataset.theme=t}catch(e){}})()`
