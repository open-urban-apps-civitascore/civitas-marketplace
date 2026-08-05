import { redirect } from 'next/navigation'

/** The marketplace opens on the use case catalogue. */
export default function Home() {
    redirect('/use-cases')
}
