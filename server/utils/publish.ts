import { createHash } from 'node:crypto'
import { buildPlayer } from './player'
import { readSettings } from './settings'
import { loadProject, saveProject, slugify } from './store'

// Publishing the web player to Cloudflare Pages: each Bower project gets its own Pages project, and the player
// goes up as its index.html through the Direct Upload API (the same calls `wrangler pages deploy` makes).
const API = 'https://api.cloudflare.com/client/v4'
// Pages refuses files over 25 MiB.
const MAX_BYTES = 25 * 1024 * 1024

export interface CloudflareSettings { accountId: string, apiToken: string }
// Where a project was last published: its Pages project, the address that always shows the latest version,
// and the address of that exact upload.
export interface Published { pagesProject: string, url: string, deploymentUrl: string, at: string }

// Malformed, unknown or under-permissioned token.
const TOKEN_ERRORS = [6003, 6111, 9106, 9109, 10000]

interface CfResponse<T> { success: boolean, result: T, errors?: { code: number, message: string }[] }

async function cf<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } })
  const body = await res.json().catch(() => null) as CfResponse<T> | null
  if (!res.ok || !body?.success) {
    const err = body?.errors?.[0]
    if (err && TOKEN_ERRORS.includes(err.code)) throw createError({ statusCode: 422, message: 'Cloudflare did not accept the API token. Check it is complete and has the permission Cloudflare Pages, Edit.' })
    throw createError({ statusCode: res.status === 404 ? 404 : 502, message: err ? `Cloudflare: ${err.message} (${err.code})` : `Cloudflare answered ${res.status}` })
  }
  return body.result
}

// The account the token belongs to, when only one: so the account ID can be left blank in settings.
export async function findAccount(token: string) {
  const accounts = await cf<{ id: string, name: string }[]>('/accounts', token)
  if (accounts.length !== 1) throw createError({ statusCode: 422, message: accounts.length ? 'This token can reach more than one account. Enter the account ID.' : 'This token cannot see any account. Enter the account ID.' })
  return accounts[0]!.id
}

// A token is good when it can list the account's Pages projects.
export async function checkCloudflare(c: CloudflareSettings) {
  await cf(`/accounts/${c.accountId}/pages/projects`, c.apiToken)
}

async function credentials() {
  const c = (await readSettings()).cloudflare
  if (!c?.accountId || !c.apiToken) throw createError({ statusCode: 422, message: 'Add your Cloudflare account in Bower settings, Publishing, first.' })
  return c
}

// Pages project names: lowercase letters, digits and dashes, up to 58 characters.
export const pagesName = (s: string) => slugify(s).slice(0, 58).replace(/-$/, '')

interface PagesProject { name: string, subdomain: string, production_branch: string }

async function getPagesProject(c: CloudflareSettings, name: string) {
  return cf<PagesProject>(`/accounts/${c.accountId}/pages/projects/${name}`, c.apiToken).catch((e) => {
    if (e.statusCode === 404) return null
    throw e
  })
}

// Uploads the web player. A project not yet published picks its Pages project name; if one with that name already
// exists in the account (an earlier manual upload, say), it is only reused with `replace`.
export async function publishProject(pid: string, opts: { name?: string, replace?: boolean } = {}) {
  const c = await credentials()
  const p = await loadProject(pid)
  const name = p.published?.pagesProject ?? pagesName(opts.name || p.name)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw createError({ statusCode: 422, message: 'Use lowercase letters, numbers and dashes for the site name.' })

  let project = await getPagesProject(c, name)
  if (project && !p.published && !opts.replace) {
    throw createError({ statusCode: 409, message: `${project.subdomain} already exists in your Cloudflare account.` })
  }
  project ??= await cf<PagesProject>(`/accounts/${c.accountId}/pages/projects`, c.apiToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, production_branch: 'main' })
  })

  const html = Buffer.from(await buildPlayer(pid), 'utf8')
  if (html.byteLength > MAX_BYTES) throw createError({ statusCode: 413, message: `The web player is ${(html.byteLength / 1024 / 1024).toFixed(1)} MB; Cloudflare Pages takes files up to 25 MB. Shorter music or smaller images will bring it down.` })

  // Files go up by content hash with a short-lived upload token, then the deployment lists path -> hash.
  const base64 = html.toString('base64')
  const hash = createHash('sha256').update(base64 + 'html').digest('hex').slice(0, 32)
  const { jwt } = await cf<{ jwt: string }>(`/accounts/${c.accountId}/pages/projects/${name}/upload-token`, c.apiToken)
  const json = { 'Content-Type': 'application/json' }
  const missing = await cf<string[]>('/pages/assets/check-missing', jwt, { method: 'POST', headers: json, body: JSON.stringify({ hashes: [hash] }) })
  if (missing.includes(hash)) {
    await cf('/pages/assets/upload', jwt, { method: 'POST', headers: json, body: JSON.stringify([{ key: hash, value: base64, metadata: { contentType: 'text/html' }, base64: true }]) })
  }
  await cf('/pages/assets/upsert-hashes', jwt, { method: 'POST', headers: json, body: JSON.stringify({ hashes: [hash] }) })

  const form = new FormData()
  form.append('manifest', JSON.stringify({ '/index.html': hash }))
  form.append('branch', project.production_branch || 'main')
  const deployment = await cf<{ url: string }>(`/accounts/${c.accountId}/pages/projects/${name}/deployments`, c.apiToken, { method: 'POST', body: form })

  const published: Published = { pagesProject: name, url: `https://${project.subdomain}`, deploymentUrl: deployment.url, at: new Date().toISOString() }
  await saveProject({ ...p, published })
  return published
}
