import { createReadStream, promises as fs } from 'node:fs'

export default defineEventHandler(async (event) => {
  const file = templateThumb(getRouterParam(event, 'id')!)
  const stat = await fs.stat(file).catch(() => null)
  if (!stat?.isFile()) throw createError({ statusCode: 404 })
  setHeader(event, 'Content-Type', 'image/png')
  setHeader(event, 'Cache-Control', 'no-store')
  return sendStream(event, createReadStream(file))
})
