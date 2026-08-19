import { useEffect, useState } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { authStateFn, finishRegistrationFn, resendVerificationFn } from '@/server-fns/auth'

export const Route = createFileRoute('/')({
  loader: async () => {
    const state = await authStateFn()
    if (state.kind === 'anonymous') throw redirect({ to: '/register' })
    if (state.kind === 'authenticated') throw redirect({ to: '/account' })
    return state
  },
  component: IndexPage,
})

function IndexPage() {
  const state = Route.useLoaderData()
  if (state.kind === 'unverified') return <UnverifiedPanel email={state.email} />
  return <CompletionPanel />
}

function UnverifiedPanel({ email }: { email: string }) {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  async function resend() {
    setStatus('sending')
    const result = await resendVerificationFn()
    setStatus(result.ok ? 'sent' : 'error')
  }

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-bold">Verify your email</h1>
      <p className="mt-4 text-sm text-gray-700">
        We sent a verification link to <strong>{email}</strong>. Click it to continue, then come back
        here.
      </p>
      <button type="button" className="btn-secondary mt-6" onClick={resend} disabled={status === 'sending'}>
        {status === 'sending' ? 'Sending…' : 'Resend verification email'}
      </button>
      {status === 'sent' ? <p className="mt-2 text-sm text-green-700">Verification email sent.</p> : null}
      {status === 'error' ? (
        <p className="mt-2 text-sm text-red-600">Failed to send. Try again shortly.</p>
      ) : null}
    </main>
  )
}

function CompletionPanel() {
  const router = useRouter()
  const [status, setStatus] = useState<'working' | 'error'>('working')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function run() {
      const result = await finishRegistrationFn()
      if (cancelled) return
      if (!result.ok) {
        setStatus('error')
        setError(
          result.kind === 'validation' ? (result.message ?? 'Could not finish registration.') : result.message,
        )
        return
      }
      await router.navigate({ to: '/account' })
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [router])

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-bold">Finishing your registration…</h1>
      {status === 'working' ? <p className="mt-4 text-sm text-gray-700">One moment.</p> : null}
      {status === 'error' ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
    </main>
  )
}
