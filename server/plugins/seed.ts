import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { createProject, listProjects, saveProject } from '../utils/store'

// First run: create an example project so there is something to play with.
export default defineNitroPlugin(async () => {
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
