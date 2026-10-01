import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { STORAGE } from '../utils/paths'
import { createProject, listProjects, loadProject, saveProject } from '../utils/store'
import { purgeOldTrash } from '../utils/trash'

export default defineNitroPlugin(async () => {
  // Projects made before the rename to Bower keep their versions and chats in .storyboard/.
  for (const d of await fs.readdir(STORAGE, { withFileTypes: true }).catch(() => [])) {
    if (!d.isDirectory()) continue
    const from = join(STORAGE, d.name, '.storyboard'), to = join(STORAGE, d.name, '.bower')
    if (await fs.stat(from).catch(() => null) && !await fs.stat(to).catch(() => null)) {
      await fs.rename(from, to)
      await saveProject(await loadProject(d.name)).catch(() => {}) // regenerate CLAUDE.md
    }
  }

  await purgeOldTrash().catch(() => {})

  // First run: create an example project so there is something to play with.
  if ((await listProjects()).length) return
  const dir = resolve('server/seed')
  const scene = async (title: string, file: string) => ({ title, html: await fs.readFile(join(dir, file), 'utf8') })
  const p = await createProject('Example: Flux teaser', [
    await scene('Meet Flux', 'intro.html'),
    await scene('Anatomy', 'anatomy.html'),
    await scene('Every style', 'styles.html'),
    await scene('Logo lockup', 'logo.html')
  ])
  p.artDirection = 'Minimal black-on-white product launch aesthetic. Inter, tight negative letter-spacing on headlines, zinc greys for secondary text. Soft shadows, generous whitespace, confident expo/quint easing. No gradients, no emoji.'
  await saveProject(p)
})
