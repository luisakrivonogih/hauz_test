import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { verifyEmailFn } from '@/server-fns/auth'

const searchSchema = z.object({
  userId: z.string().optional(),
  secret: z.string().optional(),
})

export const Route = createFileRoute('/verify-email')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ userId: search.userId, secret: search.secret }),
  loader: async ({ deps }) => {
    if (!deps.userId || !deps.secret) {
      return { message: 'This verification link is missing required parameters.' }
    }

    const result = await verifyEmailFn({ data: { userId: deps.userId, secret: deps.secret } })
    if (!result.ok) {
      return { message: result.kind === 'validation' ? (result.message ?? 'Verification failed.') : result.message }
    }

    throw redirect({ to: '/' })
  },
  component: VerifyEmailPage,
})

function VerifyEmailPage() {
  const { message } = Route.useLoaderData()

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-bold">Email verification</h1>
      <p className="mt-4 text-sm text-red-600">{message}</p>
      <p className="mt-6 text-sm text-gray-600">
        <Link to="/login" className="underline">
          Go to login
        </Link>{' '}
        to request a new link.
      </p>
    </main>
  )
}
