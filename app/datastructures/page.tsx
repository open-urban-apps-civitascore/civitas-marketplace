import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getToken } from 'next-auth/jwt'
import { auth } from '@/auth'

export default async function DataStructuresPage() {
    const session = await auth()
    if (!session) redirect('/login')

    const token = await getToken({
        req: { headers: await headers() },
        secret: process.env.NEXTAUTH_SECRET,
        secureCookie: false,
    })

    const res = await fetch(`${process.env.API_BASE_URL}:${process.env.API_PORT}/v1/datastructures`, {
        headers: { Authorization: `Bearer ${token?.access_token}` },
        cache: 'no-store',
    })
    if (!res.ok) return <p>Backend: {res.status} {res.statusText}</p>

    const page = await res.json()
    return (
        <ul>
            {page.content?.map((ds: { id: string; name: string }) => (
                <li key={ds.id}>{ds.name}</li>
            ))}
        </ul>
    )
}