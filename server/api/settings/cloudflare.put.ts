import { checkCloudflare, findAccount } from '../../utils/publish'
import { patchSettings, readSettings } from '../../utils/settings'

// The Cloudflare account for publishing, checked before it is saved. A blank token keeps the saved one (the page never
// sees it); `remove` forgets the account.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ accountId?: string, apiToken?: string, remove?: boolean }>(event).catch(() => ({} as { accountId?: string, apiToken?: string, remove?: boolean }))
  if (body.remove) {
    await patchSettings({ cloudflare: null })
    return { accountId: null }
  }
  const apiToken = String(body.apiToken ?? '').trim() || (await readSettings()).cloudflare?.apiToken
  if (!apiToken) throw createError({ statusCode: 422, message: 'Paste an API token' })
  const accountId = String(body.accountId ?? '').trim() || await findAccount(apiToken)
  if (!/^[a-f0-9]{32}$/.test(accountId)) throw createError({ statusCode: 422, message: 'That does not look like a Cloudflare account ID' })
  await checkCloudflare({ accountId, apiToken })
  await patchSettings({ cloudflare: { accountId, apiToken } })
  return { accountId }
})
