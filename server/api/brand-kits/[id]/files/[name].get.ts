import { createReadStream, promises as fs } from 'node:fs'
import { extname } from 'node:path'

const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif' }

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')!
  if (!/^[\w.-]+$/.test(name)) throw createError({ statusCode: 400 })
  const file = kitFilePath(assertId(getRouterParam(event, 'id')), name)
  const stat = await fs.stat(file).catch(() => null)
  if (!stat?.isFile()) throw createError({ statusCode: 404 })
  setHeader(event, 'Content-Type', TYPES[extname(name).toLowerCase()] || 'application/octet-stream')
  // An SVG opened directly must not run scripts in the editor's origin (it can carry <script>).
  setHeader(event, 'Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox")
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  return sendStream(event, createReadStream(file))
})
