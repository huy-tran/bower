import { promises as fs } from 'node:fs'
import { claimVisible, closeLogin, launchVisible, profileDir, resolveTarget, showVisible, visibleKind } from './shots'
import type { Step } from './steps'
import { loadProject } from './store'

// Record steps instead of writing JSON: the user clicks through the app in a visible window on the project's
// profile, and each click, field entry, choice and key becomes a step (see steps.ts). A small bar in the page
// adds "capture this screen" markers and finishes the recording. Passwords are never recorded.
interface Recording { steps: Step[], start: string, open: boolean, skippedPassword: boolean, lastAt: number }
const recordings = new Map<string, Recording>()

// Runs in the recorded page. Kept self-contained: it is injected as a string on every document.
function recorderScript() {
  const w = window as any
  if (w.__bowerRecorderInstalled) return
  w.__bowerRecorderInstalled = true
  const send = (ev: unknown) => { try { w.__bowerRecord(JSON.stringify(ev)) } catch {} }
  const norm = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim()
  const INTERACTIVE = 'button, a[href], [role="button"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="tab"], [role="option"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], label, summary, input[type="checkbox"], input[type="radio"], input[type="submit"], input[type="button"]'
  const TEXT = 'input:not([type]), input[type="text"], input[type="email"], input[type="search"], input[type="tel"], input[type="url"], input[type="number"], input[type="date"], input[type="password"], textarea, [contenteditable="true"]'

  // A selector for elements with no usable text: an id that looks hand-written, a name, or a short path.
  const cssFor = (el: Element): string => {
    if (el.id && /^[a-z][\w-]{1,40}$/i.test(el.id) && !/\d{3,}|^[a-z0-9]{8,}$/i.test(el.id)) return `#${el.id}`
    const name = el.getAttribute('name')
    if (name) return `${el.tagName.toLowerCase()}[name="${name}"]`
    const parts: string[] = []
    for (let e: Element | null = el, i = 0; e && e !== document.body && i < 4; e = e.parentElement, i++) {
      const sibs = e.parentElement ? Array.from(e.parentElement.children).filter(c => c.tagName === e!.tagName) : []
      parts.unshift(sibs.length > 1 ? `${e.tagName.toLowerCase()}:nth-of-type(${sibs.indexOf(e) + 1})` : e.tagName.toLowerCase())
    }
    return `css:${parts.join(' > ')}`
  }
  const clickLabel = (el: Element) => {
    const t = norm(el.getAttribute('aria-label')) || (el instanceof HTMLInputElement ? norm(el.value) : norm((el as HTMLElement).innerText)) || norm(el.getAttribute('title'))
    return t && t.length <= 60 && !t.includes('\n') ? t : cssFor(el)
  }
  const fieldLabel = (el: Element) => {
    const id = el.getAttribute('id')
    const byFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null
    const lab = norm((byFor || el.closest('label'))?.textContent).replace(/\s*\*$/, '')
    const labelled = el.getAttribute('aria-labelledby')
    const byAria = labelled ? norm(labelled.split(/\s+/).map(i => document.getElementById(i)?.textContent).join(' ')) : ''
    const t = lab || byAria || norm(el.getAttribute('aria-label')) || norm(el.getAttribute('placeholder'))
    return t && t.length <= 60 ? t : cssFor(el)
  }

  // Typing is recorded once per field, when the user moves on, with the field's final value.
  let pending: { el: HTMLInputElement | HTMLTextAreaElement | HTMLElement, label: string } | null = null
  const flush = () => {
    if (!pending) return
    const el = pending.el
    const value = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : norm(el.textContent)
    if (el instanceof HTMLInputElement && el.type === 'password') send({ skippedPassword: true })
    else send({ step: { type: value, in: pending.label } })
    pending = null
  }
  const inBar = (e: Event) => (e.composedPath() as Element[]).some(n => n instanceof HTMLElement && n.id === 'bower-recorder')

  let lastLabelClick: { control: Element | null, at: number } = { control: null, at: 0 }
  document.addEventListener('click', (e) => {
    if (!e.isTrusted || inBar(e)) return
    const target = e.target as Element
    // The click a label makes on its checkbox is the same action as the label click.
    if (lastLabelClick.control === target && Date.now() - lastLabelClick.at < 300) return
    if (target.closest('select, option') || (target.matches(TEXT) && !target.matches('[role="combobox"]'))) return
    const el = target.closest(INTERACTIVE) || target
    if (el.matches(TEXT) && !el.matches('[role="combobox"]')) return
    flush()
    if (el instanceof HTMLLabelElement) lastLabelClick = { control: el.control, at: Date.now() }
    send({ step: { click: clickLabel(el) } })
  }, true)
  document.addEventListener('input', (e) => {
    if (!e.isTrusted || inBar(e)) return
    const el = e.target as HTMLElement
    if (!el.matches(TEXT)) return
    if (pending && pending.el !== el) flush()
    pending = { el, label: fieldLabel(el) }
  }, true)
  document.addEventListener('change', (e) => {
    if (!e.isTrusted) return
    const el = e.target as Element
    if (el instanceof HTMLSelectElement) send({ step: { select: norm(el.selectedOptions[0]?.text) || el.value, in: fieldLabel(el) } })
    else if (pending?.el === el) flush()
  }, true)
  document.addEventListener('focusout', (e) => { if (pending?.el === e.target) flush() }, true)
  document.addEventListener('keydown', (e) => {
    if (!e.isTrusted || inBar(e)) return
    if (e.key === 'Enter' || e.key === 'Escape') { flush(); send({ step: { press: e.key } }) }
  }, true)
  addEventListener('pagehide', flush)

  // The recording bar, in a shadow root so the app's CSS cannot reach it and its CSS cannot reach the app.
  const mount = () => {
    if (document.getElementById('bower-recorder')) return
    const host = document.createElement('div')
    host.id = 'bower-recorder'
    host.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px'
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = `<style>
      .bar{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:12px;background:#18181b;color:#fff;font:500 13px/1 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.3)}
      .dot{width:8px;height:8px;border-radius:50%;background:#ef4444;animation:p 1.2s infinite}@keyframes p{50%{opacity:.3}}
      button{font:inherit;border:0;border-radius:8px;padding:7px 10px;cursor:pointer}
      .shot{background:#fff;color:#18181b}.done{background:#3f3f46;color:#fff}
      .n{opacity:.7;min-width:4.5em}
    </style><div class="bar"><span class="dot"></span><span>Recording</span><span class="n">0 steps</span><button class="shot">Capture this screen</button><button class="done">Finish</button></div>`
    root.querySelector('.shot')!.addEventListener('click', () => { flush(); send({ shot: true }) })
    root.querySelector('.done')!.addEventListener('click', () => { flush(); send({ finish: true }) })
    w.__bowerSetCount = (n: number) => { const el = root.querySelector('.n'); if (el) el.textContent = `${n} step${n === 1 ? '' : 's'}` }
    document.documentElement.appendChild(host)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount)
  else mount()
  send({ nav: location.href })
}

export function getRecording(pid: string) {
  const r = recordings.get(pid)
  return r ? { open: r.open, steps: r.steps, start: r.start, skippedPassword: r.skippedPassword } : null
}

export async function startRecording(pid: string, target?: string) {
  const p = await loadProject(pid)
  if (!p.app) throw createError({ statusCode: 422, message: 'Set the app address first' })
  if (visibleKind(pid)) throw createError({ statusCode: 409, message: visibleKind(pid) === 'record' ? 'A recording is already open' : 'Close the sign-in window first' })
  await fs.mkdir(profileDir(pid), { recursive: true })
  const startUrl = resolveTarget(p.app.url, target || '/')
  const rec: Recording = { steps: [], start: startUrl, open: true, skippedPassword: false, lastAt: 0 }
  recordings.set(pid, rec)

  const browser = await launchVisible(pid, 1360)
  claimVisible(pid, browser, 'record')
  browser.on('disconnected', () => { rec.open = false })
  const page = (await browser.pages())[0] ?? await browser.newPage()
  const origin = new URL(p.app.url).origin
  let shots = 0, firstNav = true

  const push = (s: Step) => {
    const last = rec.steps[rec.steps.length - 1]
    // Two clicks on the same thing in a row are usually one double-handled click.
    if (last && 'click' in last && 'click' in s && last.click === s.click && Date.now() - rec.lastAt < 400) return
    rec.steps.push(s)
    rec.lastAt = Date.now()
    page.evaluate((n: number) => (window as any).__bowerSetCount?.(n), rec.steps.length).catch(() => {})
  }
  await page.exposeFunction('__bowerRecord', (raw: string) => {
    let ev: any
    try { ev = JSON.parse(raw) } catch { return }
    if (ev.finish) { browser.close().catch(() => {}); return }
    if (ev.skippedPassword) { rec.skippedPassword = true; return }
    if (ev.shot) { push({ shot: `screen-${++shots}` }); return }
    if (ev.nav) {
      const u = String(ev.nav)
      if (!u.startsWith(origin)) return
      if (firstNav) { firstNav = false; rec.start = u; return }
      // A page load right after a click or key is that action's result; otherwise the user typed an address.
      if (Date.now() - rec.lastAt > 2500) push({ goto: new URL(u).pathname + new URL(u).search })
      return
    }
    if (ev.step) push(ev.step as Step)
  })
  await page.evaluateOnNewDocument(`(${recorderScript.toString()})()`)
  await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {})
  await showVisible(browser)
  return getRecording(pid)!
}

export async function stopRecording(pid: string) {
  if (visibleKind(pid) === 'record') await closeLogin(pid)
  return getRecording(pid)
}
