import { getAccessToken, requireSession } from '@/lib/session'

export default async function DataStructuresPage() {
    await requireSession()
    const accessToken = await getAccessToken()

    // Through the APISIX gateway (:9080), never straight to portal-backend:
    // the gateway is what makes OPA compute the scope header the backend needs.
    const res = await fetch(`${process.env.API_BASE_URL}:${process.env.API_PORT}/v1/datastructures`, {
        headers: { Authorization: `Bearer ${accessToken}` },
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
