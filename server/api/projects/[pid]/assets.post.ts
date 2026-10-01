import { promises as fs } from 'node:fs'
import { extname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']

// Reference images and other assets dropped into the chat. Stored in assets/ so Claude can Read them
// and scenes can use them.
export default defineEventHandler(async (event) => {
  const p = await loadProject(getRouterParam(event, 'pid')!)
  const parts = await readMultipartFormData(event)
  const files = (parts ?? []).filter(x => x.name === 'file' && x.filename)
  if (!files.length) throw createError({ statusCode: 422, message: 'No file uploaded' })
  const dir = join(projectDir(p.id), 'assets')
  await fs.mkdir(dir, { recursive: true })
  const out: { path: string, url: string, name: string }[] = []
  for (const f of files) {
    const ext = extname(f.filename!).toLowerCase()
    if (!IMAGE_EXT.includes(ext)) throw createError({ statusCode: 422, message: `${f.filename} is not an image` })
    const base = slugify(f.filename!.replace(/\.[^.]+$/, '')).slice(0, 40)
    const name = `${base}-${randomBytes(2).toString('hex')}${ext}`
    await fs.writeFile(join(dir, name), f.data)
    out.push({ path: `assets/${name}`, url: `/api/projects/${p.id}/files/assets/${name}`, name: f.filename! })
  }
  return { files: out }
})
