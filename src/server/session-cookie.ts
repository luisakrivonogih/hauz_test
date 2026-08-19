import { deleteCookie, getCookie, setCookie } from '@tanstack/react-start/server'

/**
 * The Appwrite session secret lives only in this httpOnly cookie — never in
 * localStorage, never sent to the browser as readable JS state. The secret
 * itself is already a high-entropy opaque token (same thing Appwrite's own
 * SDK would store), so no extra signing/encryption layer is added on top.
 */
const SESSION_COOKIE_NAME = 'hauz_session'
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

export function readSessionSecret(): string | undefined {
  return getCookie(SESSION_COOKIE_NAME)
}

export function writeSessionSecret(secret: string): void {
  setCookie(SESSION_COOKIE_NAME, secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ONE_YEAR_SECONDS,
  })
}

export function clearSessionSecret(): void {
  deleteCookie(SESSION_COOKIE_NAME, { path: '/' })
}
