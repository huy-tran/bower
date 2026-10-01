import { promises as fs } from 'node:fs'
import { extname, join } from 'node:path'
import { SCENE_RUNTIME } from './runtime'
import { projectDir, sceneBeats, type Project, type SceneView } from './store'

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp4': 'video/mp4', '.json': 'application/json'
}

// Swap /api/projects/<id>/files/assets/... URLs for data URIs so a scene works with no server.
export async function inlineAssets(p: Project, html: string) {
  const re = new RegExp(`/api/projects/${p.id}/files/(assets/[^"')\\s]+)`, 'g')
  const found = [...new Set([...html.matchAll(re)].map(m => m[1]!))]
  for (const rel of found) {
    try {
      const data = await fs.readFile(join(projectDir(p.id), decodeURIComponent(rel)))
      const uri = `data:${MIME[extname(rel).toLowerCase()] || 'application/octet-stream'};base64,${data.toString('base64')}`
      html = html.split(`/api/projects/${p.id}/files/${rel}`).join(uri)
    } catch {}
  }
  return html
}

// The full document a scene runs in: stage, runtime, music context and the scene fragment.
export function buildFrame(p: Project, s: SceneView, html: string) {
  const ctx = { sceneId: s.id, width: p.width, height: p.height, ...sceneBeats(p, s.start, s.duration) }
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${s.title.replace(/</g, '&lt;')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300..900&display=block" rel="stylesheet">
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #fff; }
  #stage { position: absolute; left: 0; top: 0; width: ${p.width}px; height: ${p.height}px; transform-origin: 0 0; overflow: hidden; background: #fff;
    font-family: Inter, system-ui, sans-serif; -webkit-font-smoothing: antialiased; color: #0a0a0a; }
</style>
<script>window.__VE_CTX = ${JSON.stringify(ctx).replace(/</g, '\\u003c')};</script>
<script>${SCENE_RUNTIME}</script>
</head><body><div id="stage">
${html}
</div></body></html>`
}
