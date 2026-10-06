import { readSettings } from '../../utils/settings'

// The Cloudflare token stays on the server: the page only learns which account is set up.
export default defineEventHandler(async () => {
  const { cloudflare, ...s } = await readSettings()
  return { ...s, cloudflare: cloudflare ? { accountId: cloudflare.accountId } : null }
})
