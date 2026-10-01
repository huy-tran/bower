import { createReadStream, promises as fs } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'

const TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'audio/webm', '.srt': 'text/plain', '.vtt': 'text/vtt', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2', '.json': 'application/json'
}

export default defineEventHandler(async (event) => {
  const root = projectDir(getRouterParam(event, 'pid')!)
  const rel = normalize(decodeURIComponent(getRouterParam(event, 'path') || ''))
  if (!/^(audio|renders|assets|brand|snapshots)[\\/]/.test(rel) || rel.includes('..')) throw createError({ statusCode: 404 })
  const file = join(root, rel)
  if (!file.startsWith(root + sep)) throw createError({ statusCode: 404 })
  const stat = await fs.stat(file).catch(() => null)
  if (!stat?.isFile()) throw createError({ statusCode: 404 })

  setHeader(event, 'Content-Type', TYPES[extname(file).toLowerCase()] || 'application/octet-stream')
  setHeader(event, 'Accept-Ranges', 'bytes')
  // Uploaded files (including SVGs, which can carry <script>) must never run scripts in the editor's origin.
  setHeader(event, 'Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; media-src 'self'; sandbox")
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  if (getQuery(event).download) setHeader(event, 'Content-Disposition', `attachment; filename="${rel.split(/[\\/]/).pop()}"`)

  const range = getHeader(event, 'range')?.match(/bytes=(\d*)-(\d*)/)
  if (range) {
    const start = range[1] ? Number(range[1]) : 0
    const end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1
    setResponseStatus(event, 206)
    setHeader(event, 'Content-Range', `bytes ${start}-${end}/${stat.size}`)
    setHeader(event, 'Content-Length', end - start + 1)
    return sendStream(event, createReadStream(file, { start, end }))
  }
  setHeader(event, 'Content-Length', stat.size)
  return sendStream(event, createReadStream(file))
})
