import { promises as fs } from 'node:fs'
import { join } from 'node:path'

export default defineEventHandler(async (event) => {
  const pid = getRouterParam(event, 'pid')!
  const name = getRouterParam(event, 'name')!
  if (!/^[\w.-]+\.(mp4|gif|mov)$/.test(name)) throw createError({ statusCode: 400 })
  await fs.rm(join(projectDir(pid), 'renders', name), { force: true })
  return { renders: await listRenders(pid) }
})
