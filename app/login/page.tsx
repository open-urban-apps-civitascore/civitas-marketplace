import { signIn } from '@/auth'

export default function LoginPage() {
    return (
        <form action={async () => { 'use server'; await signIn('keycloak', { redirectTo: '/datastructures' }) }}>
            <button type="submit">Mit CIVITAS anmelden</button>
        </form>
    )
}