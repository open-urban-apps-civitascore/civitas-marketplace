import { Hexagon } from 'lucide-react'

import { signIn } from '@/auth'

export default function LoginPage() {
    return (
        <div className="flex flex-1 items-center justify-center bg-background p-6">
            <div className="flex w-full max-w-sm flex-col items-center gap-6 rounded-xl border bg-card p-8">
                <div className="flex size-11 items-center justify-center rounded-lg bg-primary">
                    <Hexagon className="size-6 text-primary-foreground" />
                </div>
                <div className="text-center">
                    <h1>CIVITAS Marketplace</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Installierbare Use-Case-Pakete für diese Instanz.
                    </p>
                </div>
                <form
                    action={async () => {
                        'use server'
                        await signIn('keycloak', { redirectTo: '/use-cases' })
                    }}
                    className="w-full"
                >
                    <button
                        type="submit"
                        className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                    >
                        Mit CIVITAS anmelden
                    </button>
                </form>
            </div>
        </div>
    )
}
