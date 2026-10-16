import { promises as fs } from 'node:fs'
import { extname, join } from 'node:path'
import { SCENE_RUNTIME } from './runtime'
import { googleFontsHref, projectBrand, type BrandKit } from './brand'
import { stampElements } from './sceneSource'
import { projectDir, sceneBeats, type Project, type SceneView } from './store'

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp4': 'video/mp4', '.webm': 'video/webm', '.json': 'application/json', '.html': 'text/html', '.ttf': 'font/ttf', '.otf': 'font/otf', '.avif': 'image/avif', '.ico': 'image/x-icon'
}

// Swap /api/projects/<id>/files/(assets|brand)/... URLs for data URIs so a scene works with no server.
export async function inlineAssets(p: Project, html: string) {
  const re = new RegExp(`/api/projects/${p.id}/files/((?:assets|brand)/[^"')\\s]+)`, 'g')
  const found = [...new Set([...html.matchAll(re)].map(m => m[1]!))]
  for (const rel of found) {
    try {
      let data = await fs.readFile(join(projectDir(p.id), decodeURIComponent(rel)))
      // A live UI snapshot (assets/ui/*.html) refers to its own fonts and images: inline those first.
      if (/^assets\/ui\/[^/]+\.html$/.test(rel)) data = Buffer.from(await inlineAssets(p, data.toString('utf8')))
      const uri = `data:${MIME[extname(rel).toLowerCase()] || 'application/octet-stream'};base64,${data.toString('base64')}`
      html = html.split(`/api/projects/${p.id}/files/${rel}`).join(uri)
    } catch {}
  }
  return html
}

export interface FrameOptions {
  transparent?: boolean
  // The editor's own preview: every element carries its number (data-ve-i) so text can be retyped in place.
  edit?: boolean
}

// The brand kit as CSS variables on the stage, so scenes that use them follow the kit when it changes:
// --brand-<colour name> (and --brand-1, --brand-2... in kit order), --brand-font-heading, --brand-font-body.
// The variable for each kit colour: its name ("Ocean blue" -> --brand-ocean-blue), or its number when the name is
// empty or taken.
export function brandColorVars(kit: BrandKit) {
  const seen = new Set<string>()
  return kit.colors.map((c, i) => {
    const name = c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    if (!name || /^\d/.test(name) || seen.has(name)) return `--brand-${i + 1}`
    seen.add(name)
    return `--brand-${name}`
  })
}

export function brandVars(kit: BrandKit | null) {
  if (!kit) return ''
  const vars: string[] = []
  const named = brandColorVars(kit)
  kit.colors.forEach((c, i) => {
    if (!/^#[0-9a-f]{3,8}$/i.test(c.hex)) return
    vars.push(`--brand-${i + 1}: ${c.hex};`)
    if (named[i] !== `--brand-${i + 1}`) vars.push(`${named[i]}: ${c.hex};`)
  })
  const font = (f: string) => `'${f.replace(/['\\<>;{}]/g, '')}', Inter, system-ui, sans-serif`
  vars.push(`--brand-font-heading: ${font(kit.fonts.heading)};`, `--brand-font-body: ${font(kit.fonts.body)};`)
  return vars.join(' ')
}

// The full document a scene runs in: stage, runtime, music context, brand fonts and the scene fragment.
export async function buildFrame(p: Project, s: SceneView, html: string, opts: FrameOptions = {}) {
  const ctx = { sceneId: s.id, width: p.width, height: p.height, fps: p.fps, ...sceneBeats(p, s.start, s.duration) }
  const kit = await projectBrand(p.id)
  const brandFonts = kit ? googleFontsHref([kit.fonts.heading, kit.fonts.body]) : null
  if (opts.edit) html = stampElements(html)
  const bg = opts.transparent ? 'transparent' : '#fff'
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${s.title.replace(/</g, '&lt;')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300..900&display=block" rel="stylesheet">
${brandFonts ? `<link href="${brandFonts}" rel="stylesheet">` : ''}
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: ${bg}; }
  #stage { position: absolute; left: 0; top: 0; width: ${p.width}px; height: ${p.height}px; transform-origin: 0 0; overflow: hidden; background: ${bg};
    font-family: ${kit ? `'${kit.fonts.body}', ` : ''}Inter, system-ui, sans-serif; -webkit-font-smoothing: antialiased; color: #0a0a0a; ${brandVars(kit)} }
</style>
<script>window.__VE_CTX = ${JSON.stringify(ctx).replace(/</g, '\\u003c')};</script>
<script>${SCENE_RUNTIME}</script>
</head><body><div id="stage">
${html}
</div></body></html>`
}
