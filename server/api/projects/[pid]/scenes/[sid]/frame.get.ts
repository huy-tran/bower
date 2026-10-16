import { promises as fs } from 'node:fs'
import { join } from 'node:path'

// ?version=n serves an older version of the scene (for side-by-side compare); ?transparent=1 drops the white stage;
// ?edit=1 numbers the elements for editing text in the preview; ?draft=1 shows the unsaved hand edits, if any.
export default defineEventHandler(async (event) => {
  const p = await loadProject(getRouterParam(event, 'pid')!)
  const sid = assertId(getRouterParam(event, 'sid'))
  const s = (await sceneViews(p)).find(x => x.id === sid)
  if (!s) throw createError({ statusCode: 404, message: 'Scene not found' })
  const q = getQuery(event)
  let html = await readScene(p.id, sid)
  if (q.draft) {
    const d = await getDraft(p.id, sid)
    if (d) {
      html = d.html
      s.duration = sceneMeta(html).duration
    }
  } else if (q.version) {
    const n = Number(q.version)
    if (!Number.isInteger(n) || n < 1) throw createError({ statusCode: 400 })
    html = await fs.readFile(join(projectDir(p.id), '.bower', 'versions', sid, `${n}.html`), 'utf8').catch(() => {
      throw createError({ statusCode: 404, message: 'Version not found' })
    })
    s.duration = sceneMeta(html).duration
  }
  setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  setHeader(event, 'Cache-Control', 'no-store')
  return buildFrame(p, s, html, { transparent: !!q.transparent, edit: !!q.edit })
})
