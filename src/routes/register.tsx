import { useState } from 'react'
import { createFileRoute, Link, redirect, useRouter } from '@tanstack/react-router'
import { registrationFormSchema } from '@/lib/validation'
import { authStateFn, registerFn } from '@/server-fns/auth'

export const Route = createFileRoute('/register')({
  beforeLoad: async () => {
    const state = await authStateFn()
    if (state.kind !== 'anonymous') {
      throw redirect({ to: '/' })
    }
  },
  component: RegisterPage,
})

const initialValues = {
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  role: 'consumer' as 'consumer' | 'realtor',
  contactPhone: '',
}

function RegisterPage() {
  const router = useRouter()
  const [values, setValues] = useState(initialValues)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (submitting) return

    setFormError(null)
    setFieldErrors({})

    const parsed = registrationFormSchema.safeParse({
      ...values,
      contactPhone: values.contactPhone.trim() === '' ? null : values.contactPhone.trim(),
    })
    if (!parsed.success) {
      const errors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.')
        errors[key] ??= issue.message
      }
      setFieldErrors(errors)
      return
    }

    setSubmitting(true)
    try {
      const result = await registerFn({ data: parsed.data })
      if (!result.ok) {
        setFormError(result.kind === 'validation' ? (result.message ?? 'Please check your input.') : result.message)
        setSubmitting(false)
        return
      }
      await router.navigate({ to: '/' })
    } catch {
      setFormError('Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-bold">Create your HAUZ account</h1>

      <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit}>
        <Field label="First name" error={fieldErrors.firstName}>
          <input
            className="input"
            value={values.firstName}
            onChange={(e) => setValues((v) => ({ ...v, firstName: e.target.value }))}
            autoComplete="given-name"
          />
        </Field>

        <Field label="Last name" error={fieldErrors.lastName}>
          <input
            className="input"
            value={values.lastName}
            onChange={(e) => setValues((v) => ({ ...v, lastName: e.target.value }))}
            autoComplete="family-name"
          />
        </Field>

        <Field label="Email" error={fieldErrors.email}>
          <input
            className="input"
            type="email"
            value={values.email}
            onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
            autoComplete="email"
          />
        </Field>

        <Field label="Password" error={fieldErrors.password}>
          <input
            className="input"
            type="password"
            value={values.password}
            onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
            autoComplete="new-password"
          />
        </Field>

        <Field label="I am a" error={fieldErrors.role}>
          <select
            className="input"
            value={values.role}
            onChange={(e) => setValues((v) => ({ ...v, role: e.target.value as 'consumer' | 'realtor' }))}
          >
            <option value="consumer">Consumer</option>
            <option value="realtor">Realtor</option>
          </select>
        </Field>

        <Field label="Phone (optional, e.g. +15551234567)" error={fieldErrors.contactPhone}>
          <input
            className="input"
            type="tel"
            value={values.contactPhone}
            onChange={(e) => setValues((v) => ({ ...v, contactPhone: e.target.value }))}
            autoComplete="tel"
          />
        </Field>

        {formError ? <p className="text-sm text-red-600">{formError}</p> : null}

        <button type="submit" className="btn" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className="mt-4 text-sm text-gray-600">
        Already have an account?{' '}
        <Link to="/login" className="underline">
          Log in
        </Link>
      </p>
    </main>
  )
}

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {error ? <span className="text-red-600">{error}</span> : null}
    </label>
  )
}
