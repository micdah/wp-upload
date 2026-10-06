import axios from 'axios'
import { env } from './env.ts'

// FileBird's public REST API authenticates with its own API key (generated
// under wp-admin -> Settings -> FileBird -> API) sent as a Bearer token, so
// it can't share wpAxios - that instance's Basic Application Password header
// would clash. Folder calls are small JSON requests, so a short timeout is
// fine here (unlike media uploads, see wpClient.ts).
export const filebirdAxios = axios.create({
  baseURL: `${env.wpUrl}/wp-json/filebird/public/v1`,
  headers: { Authorization: `Bearer ${env.filebirdApiKey ?? ''}` },
  timeout: 30_000,
})

// A function rather than a constant so specs can flip env.filebirdApiKey.
export function isFilebirdEnabled(): boolean {
  return env.filebirdApiKey !== null
}
