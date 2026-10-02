import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { Page } from 'puppeteer'
import { ensureSignedIn, open, projectApp, resolveTarget, SHOT_SIZES, withProfile } from './shots'
import { installFinder, parseSteps, runSteps, StepError, type Step } from './steps'
import { projectDir, slugify } from './store'

// Live UI snapshots: a page of the running app (after optional steps) saved as its real markup with only the CSS
// rules it uses, its fonts and its images, so a scene can show the actual UI and animate parts of it. Scripts,
// event handlers and frames are removed; typed values, ticks and scroll positions are kept. The runtime puts the
// snapshot in a shadow root (`<ve-ui src>`, see runtime.ts) so the app's CSS and the scene's never meet.
//
// File layout, assets/ui/<name>.html:
//   <!--ve-ui {"width":1440,"height":900,...}-->
//   <style data-ve-global>@font-face and @property rules (moved into the scene document by the runtime: neither works in a
//   shadow root)</style><style>pruned rules</style><div data-ve-html ...><div data-ve-body ...>...</div></div>
// Images and fonts go next to it in assets/ui/<name>/, referenced by their editor URL so the exporter inlines them.
const uiDir = (pid: string) => join(projectDir(pid), 'assets', 'ui')

export interface UiHandle { id: string, kind: string, label: string }
export interface UiSnapshot { name: string, path: string, url: string, preview: string, previewUrl: string, width: number, height: number, bytes: number, cssRules: number, cssRulesTotal: number, assets: number, page: string, title: string, handles: UiHandle[], at: string }

// Runs in the captured page. Serialises it and returns the parts; resource URLs are left absolute for Node to fetch.
function serialize(rootSel: string | null) {
  // Development overlays (Laravel Debugbar, Symfony's toolbar, Clockwork, Vite and Livewire error screens) are
  // not part of the product: removed first, so their CSS is dropped too.
  for (const el of Array.from(document.querySelectorAll('[class*="phpdebugbar"], #phpdebugbar, .sf-toolbar, .sf-minitoolbar, #clockwork, vite-error-overlay, #livewire-error, #__nuxt-devtools-container, [data-bower-skip]'))) el.remove()
  const root: Element = (rootSel && document.querySelector(rootSel)) || document.body
  const vw = innerWidth, vh = innerHeight

  // 1. Freeze live state into attributes so it survives as markup.
  for (const el of Array.from(document.querySelectorAll('input, textarea, select'))) {
    if (el instanceof HTMLInputElement) {
      if (el.type === 'checkbox' || el.type === 'radio') el.checked ? el.setAttribute('checked', '') : el.removeAttribute('checked')
      else if (el.type !== 'password' && el.type !== 'file') el.setAttribute('value', el.value)
      else if (el.type === 'password') el.setAttribute('value', el.value ? '••••••••' : '')
    } else if (el instanceof HTMLTextAreaElement) el.textContent = el.value
    else if (el instanceof HTMLSelectElement) for (const o of Array.from(el.options)) o.selected ? o.setAttribute('selected', '') : o.removeAttribute('selected')
  }
  // Scrolled boxes (a sidebar, a table) keep their position; the runtime restores it.
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (el.scrollTop > 0 || el.scrollLeft > 0) { el.setAttribute('data-ve-scroll', `${el.scrollTop},${el.scrollLeft}`) }
  }
  // Canvases become images.
  for (const c of Array.from(root.querySelectorAll('canvas'))) {
    try { const img = document.createElement('img'); img.src = c.toDataURL(); img.className = c.className; img.setAttribute('style', c.getAttribute('style') || ''); img.width = c.width; img.height = c.height; c.replaceWith(img) } catch {}
  }

  // 2. Handles: notable elements tagged so a scene can reach them, e.g. ui.$('[data-ve="b3"]').
  const handles: { id: string, kind: string, label: string }[] = []
  const norm = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim()
  const shown = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < vh * 3 }
  const tag = (el: Element, kind: string, label: string, prefix: string) => {
    if (handles.length >= 80 || !label || label.length > 70 || !shown(el)) return
    const id = `${prefix}${handles.filter(h => h.id[0] === prefix).length + 1}`
    el.setAttribute('data-ve', id)
    handles.push({ id, kind, label })
  }
  for (const el of Array.from(root.querySelectorAll('h1, h2, h3'))) tag(el, el.tagName.toLowerCase(), norm(el.textContent), 'h')
  for (const el of Array.from(root.querySelectorAll('button, a[href], [role="button"], [role="menuitem"], [role="tab"]'))) tag(el, el.tagName === 'A' ? 'link' : 'button', norm(el.getAttribute('aria-label')) || norm((el as HTMLElement).innerText), 'b')
  for (const el of Array.from(root.querySelectorAll('input:not([type="hidden"]), textarea, select'))) {
    const id = el.getAttribute('id')
    const lab = (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) || el.closest('label')
    tag(el, 'field', norm(lab?.textContent).replace(/\*$/, '') || norm(el.getAttribute('placeholder')) || norm(el.getAttribute('name')), 'f')
  }
  for (const [i, el] of Array.from(root.querySelectorAll('tbody tr')).slice(0, 15).entries()) tag(el, 'row', `row ${i + 1}: ${norm((el as HTMLElement).innerText).slice(0, 60)}`, 'r')
  for (const el of Array.from(root.querySelectorAll('[role="dialog"], dialog, .fi-modal-window, .modal'))) tag(el, 'dialog', norm(el.querySelector('h1, h2, h3, [class*="heading"]')?.textContent) || 'dialog', 'd')

  // Framework attributes are stripped below, and some apps hide things with CSS keyed on them (Livewire's
  // [wire:loading] spinners, Alpine's [x-cloak]). Anything hidden now stays hidden explicitly.
  const FRAMEWORK = /^(x-|wire:|@|:|hx-|v-)/
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    if (Array.from(el.attributes).some(a => FRAMEWORK.test(a.name)) && getComputedStyle(el).display === 'none') el.setAttribute('data-ve-hidden', '')
  }

  // 3. Clone and clean.
  const clone = root.cloneNode(true) as Element
  for (const el of Array.from(clone.querySelectorAll('script, noscript, template, link, meta, base, object, embed'))) el.remove()
  for (const f of Array.from(clone.querySelectorAll('iframe'))) {
    const d = document.createElement('div')
    d.setAttribute('style', `${f.getAttribute('style') || ''};background:#f3f4f6`)
    d.className = f.className
    f.replaceWith(d)
  }
  const urls = new Set<string>()
  const abs = (u: string, base = location.href) => { try { return new URL(u, base).href } catch { return '' } }
  for (const el of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
    for (const a of Array.from(el.attributes)) {
      const n = a.name
      // Event handlers and framework directives (Alpine x-, @, :, Livewire wire:) do nothing in a scene.
      // Autofocus would steal focus (and show focus rings) when the snapshot is inserted into a scene.
      if (/^on/i.test(n) || FRAMEWORK.test(n) || /^(data-turbo|autofocus)/.test(n)) el.removeAttribute(n)
    }
    if (el.hasAttribute('data-ve-hidden')) {
      el.removeAttribute('data-ve-hidden')
      el.setAttribute('style', `${el.getAttribute('style') || ''};display:none!important`)
    }
    if (el instanceof HTMLImageElement) {
      const src = el.currentSrc || el.src
      el.removeAttribute('srcset'); el.removeAttribute('sizes'); el.removeAttribute('loading')
      if (src && !src.startsWith('data:')) { el.setAttribute('src', abs(src)); urls.add(abs(src)) }
    }
    if (el.tagName === 'SOURCE') el.remove()
    const style = el.getAttribute('style')
    if (style && /url\(/.test(style)) for (const m of style.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) if (!m[1]!.startsWith('data:')) urls.add(abs(m[1]!))
    if (el.tagName === 'use' || el.tagName === 'image') {
      const h = el.getAttribute('href') || el.getAttribute('xlink:href')
      if (h && !h.startsWith('#') && !h.startsWith('data:')) urls.add(abs(h.split('#')[0]!))
    }
  }

  // 4. CSS: only rules that match something in the snapshot (state pseudo-classes stripped for the test), the
  // @font-face rules for fonts it uses, and keyframes. Selectors on html/body/:root are pointed at the wrappers.
  const used = new Set<string>()
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) for (const f of getComputedStyle(el).fontFamily.split(',')) used.add(f.trim().replace(/^['"]|['"]$/g, '').toLowerCase())
  const STATE = /::?(-webkit-|-moz-)?[a-z-]+(\([^)]*\))?/gi
  const keepPseudo = /^:(not|is|where|has|nth-child|nth-of-type|nth-last-child|first-child|last-child|only-child|first-of-type|last-of-type|empty|root|host)/i
  // Top-level commas only: ":where(.dark, .dark *)" is one selector, not two broken ones.
  const parts = (selector: string) => {
    const out: string[] = []
    let depth = 0, cur = ''
    for (const ch of selector) {
      if (ch === '(' || ch === '[') depth++
      else if (ch === ')' || ch === ']') depth--
      else if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue }
      cur += ch
    }
    out.push(cur)
    return out
  }
  const matches = (selector: string) => {
    for (const part of parts(selector)) {
      const p = part.trim()
      if (/(^|[\s>+~(])(:root|html|body)(?=$|[\s>+~.#[:,)])/.test(p)) return true
      const bare = p.replace(STATE, m => keepPseudo.test(m) ? m : '').trim() || '*'
      try { if (root.matches(bare) || root.querySelector(bare)) return true } catch { return true }
    }
    return false
  }
  const rewrite = (selector: string) => selector
    .replace(/(^|[\s>+~,(])(:root)(?=$|[\s>+~.#[:,)])/g, '$1[data-ve-html]')
    .replace(/(^|[\s>+~,(])html(?=$|[\s>+~.#[:,)])/g, '$1[data-ve-html]')
    .replace(/(^|[\s>+~,(])body(?=$|[\s>+~.#[:,)])/g, '$1[data-ve-body]')
  // vh/vw would measure the scene, not the app's window: turn them into the pixels they were.
  const units = (css: string) => css.replace(/(-?\d*\.?\d+)(d|s|l)?(vh|vw|vmin|vmax)\b/g, (_m, n, _k, u) => {
    const v = Number(n), px = u === 'vh' ? vh : u === 'vw' ? vw : u === 'vmin' ? Math.min(vw, vh) : Math.max(vw, vh)
    return `${Math.round(v * px / 100 * 100) / 100}px`
  })
  let total = 0, kept = 0
  const fonts: string[] = []
  const absUrls = (text: string, base: string) => text.replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g, (m, u) => u.startsWith('data:') ? m : `url("${abs(u, base)}")`)
  // Declarations split on ";" outside brackets and quotes (values like url(data:...;base64,...) contain ";").
  const decls = (text: string) => {
    const out: string[] = []
    let depth = 0, quote = '', cur = ''
    for (const ch of text) {
      if (quote) { if (ch === quote) quote = ''; cur += ch; continue }
      if (ch === '"' || ch === '\'') quote = ch
      else if (ch === '(') depth++
      else if (ch === ')') depth--
      else if (ch === ';' && depth === 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue }
      cur += ch
    }
    if (cur.trim()) out.push(cur.trim())
    return out
  }
  // Kept rules as a tree first, so custom properties nobody uses can be dropped before writing CSS: design
  // systems define hundreds of them on :root (Filament's theme alone, over a thousand).
  type Rule = { kind: 'style', sel: string, decls: string[], kids: Rule[] } | { kind: 'group', head: string, kids: Rule[] } | { kind: 'raw', text: string, prop?: string }
  const walk = (rules: CSSRuleList, base: string): Rule[] => {
    const out: Rule[] = []
    for (const r of Array.from(rules)) {
      total++
      if (r instanceof CSSStyleRule) {
        if (!matches(r.selectorText)) continue
        kept++
        // Nested rules (CSS nesting) are walked too, so their unused children are dropped as well.
        out.push({ kind: 'style', sel: rewrite(r.selectorText), decls: decls(absUrls(r.style.cssText, base)), kids: r.cssRules?.length ? walk(r.cssRules, base) : [] })
      } else if (r instanceof CSSFontFaceRule) {
        const fam = r.style.getPropertyValue('font-family').replace(/^['"]|['"]$/g, '').toLowerCase()
        if (used.has(fam)) fonts.push(absUrls(r.cssText, base))
      } else if (r instanceof CSSKeyframesRule || r.constructor.name === 'CSSLayerStatementRule') {
        out.push({ kind: 'raw', text: r.cssText })
      } else if (r.constructor.name === 'CSSPropertyRule') {
        out.push({ kind: 'raw', text: r.cssText, prop: (r as any).name })
      } else if ('cssRules' in r && (r as CSSGroupingRule).cssRules) {
        const kids = walk((r as CSSGroupingRule).cssRules, base)
        if (kids.length) out.push({ kind: 'group', head: r.cssText.slice(0, r.cssText.indexOf('{')).trim(), kids })
      }
    }
    return out
  }
  const tree: Rule[] = []
  const blocked: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try { rules = sheet.cssRules } catch { if (sheet.href) blocked.push(sheet.href); continue }
    tree.push(...walk(rules, sheet.href || location.href))
  }
  // Which custom properties are needed: those read by real declarations, inline styles or keyframes, then
  // whatever those read in turn.
  const reads = (text: string) => [...text.matchAll(/var\(\s*(--[\w-]+)/g)].map(m => m[1]!)
  const defs = new Map<string, string[]>()
  const need = new Set<string>()
  const scan = (list: Rule[]) => {
    for (const r of list) {
      if (r.kind === 'style') {
        for (const d of r.decls) {
          const i = d.indexOf(':'), prop = d.slice(0, i).trim()
          if (prop.startsWith('--')) defs.set(prop, [...defs.get(prop) ?? [], ...reads(d.slice(i + 1))])
          else for (const v of reads(d)) need.add(v)
        }
        scan(r.kids)
      } else if (r.kind === 'group') scan(r.kids)
      else if (!r.prop) for (const v of reads(r.text)) need.add(v)
    }
  }
  scan(tree)
  for (const el of [clone, ...Array.from(clone.querySelectorAll('[style]'))]) for (const v of reads(el.getAttribute('style') || '')) need.add(v)
  const queue = [...need]
  while (queue.length) for (const v of defs.get(queue.pop()!) ?? []) if (!need.has(v)) { need.add(v); queue.push(v) }
  // @property only works at document level (Chrome ignores it in a shadow root), and Tailwind 4 builds rings,
  // shadows and transforms from registered properties, so the needed ones go with the fonts to the document.
  const globals: string[] = []
  const emit = (list: Rule[]): string => list.map((r) => {
    if (r.kind === 'raw' && r.prop) { if (need.has(r.prop)) globals.push(r.text); return '' }
    if (r.kind === 'raw') return `${r.text}\n`
    if (r.kind === 'group') { const inner = emit(r.kids); return inner ? `${r.head}{\n${inner}}\n` : '' }
    const body = r.decls.filter(d => !d.startsWith('--') || need.has(d.slice(0, d.indexOf(':')).trim())).join(';')
    const kids = emit(r.kids)
    return body || kids ? `${r.sel}{${body}${kids ? `\n${kids}` : ''}}\n` : ''
  }).join('')
  let css = emit(tree)
  // Absolute resource URLs in the CSS, so Node can find and replace each one.
  css = css.replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g, (m, u) => u.startsWith('data:') ? m : `url("${abs(u)}")`)

  // Every character the snapshot shows, so only the font subsets (unicode-range) that cover them are copied.
  const shownText = (root.textContent || '') + Array.from(root.querySelectorAll('input, textarea')).map(e => (e as HTMLInputElement).value + (e.getAttribute('placeholder') || '')).join('')
  const chars = [...new Set(Array.from(shownText).map(c => c.codePointAt(0)!))]
  const htmlEl = document.documentElement, bodyEl = document.body
  const wrapAttrs = (el: Element, keep: string) => Array.from(el.attributes).filter(a => !/^on/i.test(a.name) && !/^(x-|wire:|@|:)/.test(a.name)).map(a => ` ${a.name}="${a.value.replace(/"/g, '&quot;')}"`).join('') + keep
  const pageY = root === bodyEl ? window.scrollY : 0
  const inner = root === bodyEl ? clone.innerHTML : clone.outerHTML
  const markup = `<div data-ve-html${wrapAttrs(htmlEl, '')}><div data-ve-body${wrapAttrs(bodyEl, '')} data-ve-page-scroll="${pageY}">${inner}</div></div>`
  return {
    css: units(css), fonts: [...fonts, ...globals].join('\n'), markup: units(markup), urls: [...urls].filter(Boolean), blocked, handles, total, kept, chars,
    width: vw, height: vh, title: document.title, rootFontSize: getComputedStyle(htmlEl).fontSize
  }
}

// Parses "U+0000-00FF, U+0131, U+02??" and keeps @font-face rules with no range or a range that covers a used
// character (falling back to all faces when none would be kept, so text never loses its font).
function keepUsedFaces(css: string, chars: Set<number>) {
  const faces = css.match(/@font-face\s*{[^}]*}/g) ?? []
  const covers = (face: string) => {
    const range = face.match(/unicode-range\s*:\s*([^;}]+)/i)?.[1]
    if (!range) return true
    return range.split(',').some((part) => {
      const p = part.trim().replace(/^u\+/i, '')
      const [a, b] = p.includes('?') ? [p.replace(/\?/g, '0'), p.replace(/\?/g, 'F')] : p.split('-')
      const lo = parseInt(a!, 16), hi = parseInt(b ?? a!, 16)
      for (const c of chars) if (c >= lo && c <= hi) return true
      return false
    })
  }
  const kept = faces.filter(covers)
  if (!kept.length) return css
  // Other document-level rules (@property) stay as they are.
  return faces.filter(f => !kept.includes(f)).reduce((out, f) => out.replace(f, ''), css)
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif', 'font/woff2': 'woff2', 'font/woff': 'woff', 'font/ttf': 'ttf', 'font/otf': 'otf', 'application/font-woff2': 'woff2', 'application/font-woff': 'woff', 'image/x-icon': 'ico' }

// The app's own files are fetched inside the signed-in page (cookies and all); files from other sites (font
// services, CDNs) are public and fetched directly, because the page's own fetch would be blocked by CORS.
async function fetchResource(page: Page, url: string) {
  if (new URL(url).origin === new URL(page.url()).origin) return fetchInPage(page, url)
  try {
    const r = await fetch(url, { headers: { 'user-agent': await page.browser().userAgent() } })
    if (!r.ok) return null
    return { type: (r.headers.get('content-type') || '').split(';')[0]!.trim(), data: Buffer.from(await r.arrayBuffer()).toString('base64') }
  } catch { return null }
}

async function fetchInPage(page: Page, url: string) {
  return page.evaluate(async (u) => {
    try {
      const r = await fetch(u, { credentials: 'include' })
      if (!r.ok) return null
      const buf = new Uint8Array(await r.arrayBuffer())
      let s = ''
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
      return { type: (r.headers.get('content-type') || '').split(';')[0]!.trim(), data: btoa(s) }
    } catch { return null }
  }, url)
}

export interface UiOptions { target: string, steps?: Step[] | string, size?: string, name?: string, select?: string }

export async function captureUi(pid: string, opts: UiOptions): Promise<UiSnapshot> {
  const { app } = await projectApp(pid)
  const steps = parseSteps(opts.steps)
  const preset = SHOT_SIZES[opts.size ?? ''] ?? SHOT_SIZES.desktop!
  const url = resolveTarget(app.url, opts.target || '/')
  await fs.mkdir(uiDir(pid), { recursive: true })

  return withProfile(app.id, async (browser) => {
    const page = await browser.newPage()
    await page.setViewport({ width: preset.width, height: preset.height, deviceScaleFactor: 1 })
    await installFinder(page)
    await open(page, url)
    await ensureSignedIn(app.id, app.url, page, url)
    await new Promise(r => setTimeout(r, 600))
    try {
      await runSteps(page, steps, { resolve: t => resolveTarget(app.url, t), navigated: u => ensureSignedIn(app.id, app.url, page, u), shot: async () => {} })
    } catch (e) {
      if (e instanceof StepError) throw createError({ statusCode: 422, message: `${e.message.replace(/\.?$/, '.')} Nothing was saved; try the steps with shot first.`, data: { step: e.index + 1 } })
      throw e
    }
    await page.waitForNetworkIdle({ idleTime: 300, timeout: 5000 }).catch(() => {})

    const base = slugify(opts.name || new URL(page.url()).pathname.replace(/\/$/, '') || 'page').slice(0, 40) || 'page'
    const name = `${base}-${randomBytes(2).toString('hex')}`
    const dir = join(uiDir(pid), name)
    await fs.mkdir(dir, { recursive: true })

    const s = await page.evaluate(serialize, opts.select ?? null)
    // A picture of the state, for Claude to look at and to compare against the scene. Taken after serialising,
    // which removed development overlays such as Debugbar.
    await page.screenshot({ path: join(uiDir(pid), `${name}.png`) as `${string}.png` })
    // Stylesheets the page could not read (another origin, e.g. Google Fonts) are fetched and kept whole.
    for (const href of s.blocked) {
      const r = await fetchResource(page, href)
      if (r) {
        const text = Buffer.from(r.data, 'base64').toString('utf8').replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g, (m, u) => u.startsWith('data:') ? m : `url("${new URL(u, href).href}")`)
        const faces = text.match(/@font-face\s*{[^}]*}/g) ?? []
        s.fonts += `\n${faces.join('\n')}`
      }
    }

    // Font services split each weight into dozens of subsets (latin, cyrillic, vietnamese...). Keep the faces
    // whose unicode-range covers a character on screen, and fetch only their files.
    s.fonts = keepUsedFaces(s.fonts, new Set(s.chars))
    for (const m of s.fonts.matchAll(/url\("([^"]+)"\)/g)) s.urls.push(m[1]!)
    // Copy every image and font into the project and point the snapshot at the copies.
    const map = new Map<string, string>()
    for (const u of new Set(s.urls)) {
      if (!/^https?:/.test(u)) continue
      const r = await fetchResource(page, u)
      if (!r) continue
      const buf = Buffer.from(r.data, 'base64')
      if (buf.length > 8 * 1024 * 1024) continue
      const ext = EXT[r.type] || (u.match(/\.(png|jpe?g|gif|webp|svg|avif|woff2?|ttf|otf)(?:[?#]|$)/i)?.[1]?.toLowerCase() ?? 'bin')
      const file = `${createHash('sha1').update(buf).digest('hex').slice(0, 12)}.${ext}`
      await fs.writeFile(join(dir, file), buf)
      map.set(u, `/api/projects/${pid}/files/assets/ui/${name}/${file}`)
    }
    const swap = (text: string) => {
      let out = text
      for (const [from, to] of map) out = out.split(from).join(to).split(from.replace(/&/g, '&amp;')).join(to)
      return out
    }
    const meta = { width: s.width, height: s.height, page: page.url(), title: s.title, rootFontSize: s.rootFontSize }
    const html = `<!--ve-ui ${JSON.stringify(meta)}-->\n<style data-ve-global>\n${swap(s.fonts)}\n</style>\n<style>\n${swap(s.css)}\n</style>\n${swap(s.markup)}\n`
    const file = join(uiDir(pid), `${name}.html`)
    await fs.writeFile(file, html)
    if (!map.size) await fs.rm(dir, { recursive: true, force: true })

    const snap: UiSnapshot = {
      name,
      path: `assets/ui/${name}.html`,
      url: `/api/projects/${pid}/files/assets/ui/${name}.html`,
      preview: `assets/ui/${name}.png`,
      previewUrl: `/api/projects/${pid}/files/assets/ui/${name}.png`,
      width: s.width,
      height: s.height,
      bytes: Buffer.byteLength(html),
      cssRules: s.kept,
      cssRulesTotal: s.total,
      assets: map.size,
      page: page.url(),
      title: s.title,
      handles: s.handles,
      at: new Date().toISOString()
    }
    await fs.writeFile(join(uiDir(pid), `${name}.json`), JSON.stringify(snap, null, 2))
    return snap
  })
}

export async function listUiSnapshots(pid: string): Promise<UiSnapshot[]> {
  const names = (await fs.readdir(uiDir(pid)).catch(() => [] as string[])).filter(n => n.endsWith('.json'))
  const out = await Promise.all(names.map(async n => JSON.parse(await fs.readFile(join(uiDir(pid), n), 'utf8').catch(() => 'null'))))
  return out.filter(Boolean).sort((a, b) => b.at.localeCompare(a.at))
}

export async function removeUiSnapshot(pid: string, name: string) {
  if (!/^[\w-]+$/.test(name)) throw createError({ statusCode: 404 })
  for (const ext of ['html', 'png', 'json']) await fs.rm(join(uiDir(pid), `${name}.${ext}`), { force: true })
  await fs.rm(join(uiDir(pid), name), { recursive: true, force: true })
  return listUiSnapshots(pid)
}
