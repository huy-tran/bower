import { createApp } from '../../utils/apps'

// Add an app by its address; an app with the same address is reused rather than duplicated.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ url?: string, name?: string }>(event)
  if (!body?.url?.trim()) throw createError({ statusCode: 422, message: 'Enter the app address' })
  return createApp({ url: body.url, name: body.name })
})
