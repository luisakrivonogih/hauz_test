import { Client } from 'appwrite'
import { getClientEnv } from '@/env/client'

/**
 * Browser-safe Appwrite client (Web SDK). Configured with only public
 * project/endpoint values — never an API key. All HAUZ Auth/session/data
 * flows in this app run through server functions instead of this client,
 * because the session lives in an httpOnly cookie the browser can't read;
 * this instance exists to keep the client/server SDK boundary explicit and
 * to give any future genuinely-client-side call (e.g. optimistic UI checks)
 * a safe, ready-made place to start from.
 */
export function createBrowserAppwriteClient(): Client {
  const env = getClientEnv()

  return new Client()
    .setEndpoint(env.VITE_APPWRITE_ENDPOINT)
    .setProject(env.VITE_APPWRITE_PROJECT_ID)
}
