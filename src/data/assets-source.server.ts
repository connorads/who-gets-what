import { env } from 'cloudflare:workers'
import { fetchSource } from './source.ts'

/**
 * Reads the release from the Workers static assets the Worker is deployed
 * with. The binding ignores the host; in dev, Vite answers it and accepts only
 * local hosts.
 */
export const assetsSource = fetchSource((request) => env.ASSETS.fetch(request), 'http://localhost')
