import { useState } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { authStateFn, logoutFn } from '@/server-fns/auth'

export const Route = createFileRoute('/account')({
  beforeLoad: async () => {
    const state = await authStateFn()
    if (state.kind !== 'authenticated') {
      throw redirect({ to: '/' })
    }
    return { authState: state }
  },
  component: AccountPage,
})

function AccountPage() {
  const { authState } = Route.useRouteContext()
  const router = useRouter()
  const [loggingOut, setLoggingOut] = useState(false)

  async function handleLogout() {
    if (loggingOut) return
    setLoggingOut(true)
    await logoutFn()
    await router.navigate({ to: '/login' })
  }

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-bold">Welcome, {authState.firstName}</h1>

      <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="font-medium text-gray-600">Name</dt>
        <dd>
          {authState.firstName} {authState.lastName}
        </dd>
        <dt className="font-medium text-gray-600">Email</dt>
        <dd>{authState.email}</dd>
        <dt className="font-medium text-gray-600">Role</dt>
        <dd className="capitalize">{authState.role}</dd>
        <dt className="font-medium text-gray-600">Phone</dt>
        <dd>{authState.contactPhone ?? '—'}</dd>
      </dl>

      <button type="button" className="btn-secondary mt-8" onClick={handleLogout} disabled={loggingOut}>
        {loggingOut ? 'Logging out…' : 'Log out'}
      </button>
    </main>
  )
}
