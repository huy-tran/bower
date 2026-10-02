import type { ElementHandle, Page } from 'puppeteer'

// Steps Claude (or the user) can run on a page of the running product before capturing it: click a button,
// fill a field, wait for a modal, and so on. Each step is a small JSON object with one verb key:
//
//   { "click": "Export" }                      { "hover": "Actions" }
//   { "type": "Jane", "in": "Name" }           { "select": "Active", "in": "Status" }
//   { "press": "Enter" }                       { "wait": "Export contacts" } / { "wait": 800 } / { "wait": "Loading", "gone": true }
//   { "scroll": "Audit log" } / { "scroll": 600 } / { "scroll": "bottom" }
//   { "goto": "/contacts" }                    { "shot": "export-modal", "full": false }
//
// Targets are visible text by default ("Export", the label of a field), or a CSS selector when they start with
// `#`, `.`, `[` or `css:`. `text:` forces a text match. `nth` picks another match when several share a label.
// Text matching mirrors what a person sees: an exact label beats a partial one, buttons and links beat plain
// text, and an element hidden behind a modal does not count.

export type Target = string
export type Step =
  | { click: Target, nth?: number }
  | { hover: Target, nth?: number }
  | { type: string, in: Target, nth?: number, enter?: boolean }
  | { select: string, in: Target, nth?: number }
  | { press: string }
  | { wait: Target | number, gone?: boolean, timeout?: number }
  | { scroll: Target | number }
  | { goto: string }
  | { shot: string, full?: boolean }

const VERBS = ['click', 'hover', 'type', 'select', 'press', 'wait', 'scroll', 'goto', 'shot'] as const
const MAX_STEPS = 40
const MAX_WAIT = 20_000

export class StepError extends Error {
  constructor(public index: number, public step: Step, message: string) {
    super(`Step ${index + 1} (${describeStep(step)}): ${message}`)
  }
}

export function describeStep(s: Step): string {
  if ('click' in s) return `click "${s.click}"`
  if ('hover' in s) return `hover "${s.hover}"`
  if ('type' in s) return `type "${s.type}" in "${s.in}"`
  if ('select' in s) return `select "${s.select}" in "${s.in}"`
  if ('press' in s) return `press ${s.press}`
  if ('wait' in s) return typeof s.wait === 'number' ? `wait ${s.wait}ms` : `wait for "${s.wait}"${s.gone ? ' to go' : ''}`
  if ('scroll' in s) return `scroll ${typeof s.scroll === 'number' ? `${s.scroll}px` : `to "${s.scroll}"`}`
  if ('goto' in s) return `go to ${s.goto}`
  return `shot "${s.shot}"`
}

// Validates the loose JSON Claude sends. Errors say which step is wrong and what was expected.
export function parseSteps(raw: unknown): Step[] {
  if (raw === undefined || raw === null || raw === '') return []
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { throw createError({ statusCode: 422, message: 'Steps must be a JSON array, like [{"click":"Export"},{"shot":"export-modal"}]' }) }
  }
  if (!Array.isArray(raw)) throw createError({ statusCode: 422, message: 'Steps must be a JSON array of step objects' })
  if (raw.length > MAX_STEPS) throw createError({ statusCode: 422, message: `Too many steps (${raw.length}); the limit is ${MAX_STEPS}` })
  return raw.map((s, i) => {
    const bad = (why: string) => createError({ statusCode: 422, message: `Step ${i + 1}: ${why}` })
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw bad('each step is an object with one verb, like {"click":"Export"}')
    const verbs = VERBS.filter(v => v in s)
    if (verbs.length !== 1) throw bad(`use exactly one of ${VERBS.join(', ')}`)
    const v = verbs[0]!
    const val = (s as any)[v]
    const str = (k: string, what: string) => { if (typeof (s as any)[k] !== 'string' || !(s as any)[k].trim()) throw bad(`"${k}" must be ${what}`) }
    const nth = (s as any).nth === undefined ? undefined : Number((s as any).nth)
    if (nth !== undefined && (!Number.isInteger(nth) || nth < 1)) throw bad('"nth" must be 1, 2, 3...')
    switch (v) {
      case 'click': case 'hover': str(v, 'the visible text or a CSS selector'); return { [v]: val.trim(), ...(nth && { nth }) } as Step
      case 'type': if (typeof val !== 'string') throw bad('"type" must be the text to type'); str('in', 'the field\'s label, placeholder, name or a CSS selector'); return { type: val, in: s.in.trim(), ...(nth && { nth }), ...(s.enter && { enter: true }) }
      case 'select': str('select', 'the option\'s text or value'); str('in', 'the select\'s label, name or a CSS selector'); return { select: val.trim(), in: s.in.trim(), ...(nth && { nth }) }
      case 'press': str('press', 'a key name like Enter, Escape, Tab or ArrowDown'); return { press: val.trim() }
      case 'wait': {
        if (typeof val === 'number') { if (!(val >= 0 && val <= MAX_WAIT)) throw bad(`"wait" in ms must be between 0 and ${MAX_WAIT}`); return { wait: val } }
        str('wait', 'text, a CSS selector, or a number of milliseconds')
        const timeout = s.timeout === undefined ? undefined : Math.min(MAX_WAIT, Math.max(100, Number(s.timeout) || 0))
        return { wait: val.trim(), ...(s.gone && { gone: true }), ...(timeout && { timeout }) }
      }
      case 'scroll': if (typeof val === 'number') return { scroll: val }; str('scroll', '"top", "bottom", text, a CSS selector, or a number of pixels'); return { scroll: val.trim() }
      case 'goto': str('goto', 'a page path or URL'); return { goto: val.trim() }
      case 'shot': str('shot', 'a short name for the PNG'); return { shot: val.trim(), ...(s.full && { full: true }) }
    }
    throw bad('unknown step')
  })
}

export function hasShotStep(steps: Step[]) {
  return steps.some(s => 'shot' in s)
}

// --- Finding elements -------------------------------------------------------------------------------------

type Kind = 'click' | 'field'

// Runs in the page. Returns the nth element matching the target, or a string explaining why none did (the
// caller turns that into the step error). Kept self-contained: Puppeteer serialises this function.
function findInPage(target: string, kind: Kind, nth: number): Element | string {
  const norm = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase()
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect()
    if (r.width < 1 && r.height < 1) return false
    const cs = getComputedStyle(el)
    return cs.visibility !== 'hidden' && cs.display !== 'none'
  }
  const inView = (el: Element) => {
    const r = el.getBoundingClientRect()
    return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth
  }
  // True when a click at the element's centre would reach it (or something inside it), not a modal backdrop.
  const hittable = (el: Element) => {
    if (!inView(el)) el.scrollIntoView({ block: 'center', inline: 'nearest' })
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)))
    return !!hit && (hit === el || el.contains(hit) || hit.contains(el))
  }
  const INTERACTIVE = 'button, a[href], [role="button"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="tab"], [role="option"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], label, summary, input, select, textarea, [contenteditable="true"], [tabindex]:not([tabindex="-1"])'
  const FIELDS = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select, [contenteditable="true"], [role="combobox"], [role="textbox"]'
  const SKIP = 'script, style, noscript, template, head, meta, link, title'

  let sel: string | null = null, text: string | null = null
  if (target.startsWith('css:')) sel = target.slice(4).trim()
  else if (target.startsWith('text:')) text = target.slice(5).trim()
  else if (/^[#.[]/.test(target) || /^[a-z]+[#.[][\w-]/i.test(target)) sel = target
  else text = target

  const pick = (list: Element[], what: string) => {
    const shown = list.filter(visible)
    if (!shown.length) return list.length ? `${what} exists but is not visible` : `no ${what}`
    const ok = shown.filter(hittable)
    if (!ok.length) return `${what} is covered by another element (an open modal or menu?)`
    if (nth > ok.length) return `only ${ok.length} visible match${ok.length === 1 ? '' : 'es'}, so there is no number ${nth}`
    return ok[nth - 1]!
  }

  if (sel !== null) {
    let list: Element[]
    try { list = Array.from(document.querySelectorAll(sel)) } catch { return `"${sel}" is not a valid CSS selector` }
    if (kind === 'field') list = list.map(el => el.matches(FIELDS) ? el : el.querySelector(FIELDS) || el)
    return pick(list, `element matching ${sel}`)
  }

  const want = norm(text)
  if (!want) return 'empty target'
  const labelOf = (el: Element) => {
    if (el instanceof HTMLInputElement) return norm(el.value || el.placeholder || el.getAttribute('aria-label') || el.name)
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return norm(el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name)
    return norm(el.getAttribute('aria-label') || el.textContent)
  }
  // 3: exact label, 2: label starts with the text, 1: label contains it (only for short labels).
  const quality = (label: string) => {
    if (!label || label.length > 200) return 0
    if (label === want) return 3
    if (label.startsWith(want) && label.length <= want.length * 3 + 10) return 2
    if (label.includes(want) && label.length <= 120) return 1
    return 0
  }

  const all = Array.from(document.body.querySelectorAll('*')).filter(el => !el.closest(SKIP) && !(el instanceof SVGElement && !(el instanceof SVGSVGElement)))
  const q = new Map<Element, number>()
  for (const el of all) {
    const k = quality(labelOf(el))
    if (k) q.set(el, k)
  }
  // Only the innermost element carrying the text counts; its ancestors match by containment alone.
  let matches = Array.from(q.keys()).filter(el => !Array.from(el.querySelectorAll('*')).some(c => (q.get(c) || 0) >= q.get(el)!))

  if (kind === 'field') {
    const fieldFor = (el: Element): Element | null => {
      if (el.matches(FIELDS)) return el
      const label = el.closest('label') || (el instanceof HTMLLabelElement ? el : null)
      if (label) {
        const control = (label as HTMLLabelElement).control || label.querySelector(FIELDS)
        if (control) return control
        const id = label.getAttribute('for')
        if (id) { const byId = document.getElementById(id); if (byId) return byId }
      }
      // Filament and most form kits put the label just before the input, inside a shared wrapper.
      for (let p: Element | null = el, i = 0; p && i < 4; p = p.parentElement, i++) {
        const f = p.querySelector(FIELDS)
        if (f && norm(f.textContent).length < 400) return f
      }
      return null
    }
    const fields = Array.from(document.querySelectorAll(FIELDS)).filter(f => quality(labelOf(f)) > 0)
    const ranked = [...matches.sort((a, b) => q.get(b)! - q.get(a)!).map(fieldFor), ...fields].filter((f): f is Element => !!f)
    return pick(Array.from(new Set(ranked)), `field labelled "${text}"`)
  }

  // Clicking the text of a button should click the button: climb to the nearest interactive ancestor.
  matches = matches.map((el) => {
    const parent = el.parentElement?.closest(INTERACTIVE)
    return el.matches(INTERACTIVE) ? el : parent && parent.contains(el) && norm(parent.textContent).length <= Math.max(80, want.length * 3) ? parent : el
  })
  const uniq = Array.from(new Set(matches))
  uniq.sort((a, b) => (q.get(b) || 3) - (q.get(a) || 3) || Number(b.matches(INTERACTIVE)) - Number(a.matches(INTERACTIVE)) || (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
  // When an exact match exists, partial matches are noise: "Export" must not also mean "Export history".
  const best = q.get(uniq[0]!) || 0
  return pick(best === 3 ? uniq.filter(el => (q.get(el) || 3) === 3) : uniq, `element with the text "${text}"`)
}

// Runs in the page: a short list of what a person could click or fill in right now, for error messages.
function visibleChoices(kind: Kind): string[] {
  const norm = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim()
  const sel = kind === 'field'
    ? 'input:not([type="hidden"]):not([type="submit"]), textarea, select, [contenteditable="true"], [role="combobox"]'
    : 'button, a[href], [role="button"], [role="menuitem"], [role="tab"], [role="option"], summary, input[type="submit"]'
  const out: string[] = []
  for (const el of Array.from(document.querySelectorAll(sel))) {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1 || getComputedStyle(el).visibility === 'hidden') continue
    let label = ''
    if (kind === 'field') {
      const id = el.getAttribute('id')
      const lab = (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) || el.closest('label')
      label = norm(lab?.textContent) || norm(el.getAttribute('placeholder')) || norm(el.getAttribute('aria-label')) || norm(el.getAttribute('name'))
    } else {
      label = el instanceof HTMLInputElement ? norm(el.value) : norm(el.getAttribute('aria-label')) || norm(el.textContent)
    }
    if (label && label.length <= 60 && !out.includes(label)) out.push(label)
    if (out.length >= 25) break
  }
  return out
}

async function find(page: Page, target: string, kind: Kind, nth = 1): Promise<ElementHandle<Element>> {
  const h = await page.evaluateHandle(findInPage, target, kind, nth)
  const el = h.asElement()
  if (el) return el as ElementHandle<Element>
  const why = String(await h.jsonValue())
  await h.dispose()
  const choices = await page.evaluate(visibleChoices, kind).catch(() => [] as string[])
  const hint = choices.length ? ` Visible ${kind === 'field' ? 'fields' : 'controls'}: ${choices.map(c => `"${c}"`).join(', ')}.` : ''
  throw new Error(`${why}.${hint}`)
}

// Lets the page react: Livewire requests, menus and modals opening. Bounded, so a page that keeps polling
// does not stall the run.
async function settle(page: Page, ms = 350) {
  await page.waitForNetworkIdle({ idleTime: 250, timeout: 4000 }).catch(() => {})
  await new Promise(r => setTimeout(r, ms))
}

export interface RunHooks {
  // Called for a `shot` step; the runner itself never writes files.
  shot: (name: string, full: boolean, index: number) => Promise<void>
  resolve: (target: string) => string
  // Called after a `goto` step loads, to catch a session that ran out (see session.ts).
  navigated?: (url: string) => Promise<void>
}

// Executes the steps on the page. Throws StepError with the failing step's number and the reason.
export async function runSteps(page: Page, steps: Step[], hooks: RunHooks) {
  for (const [i, s] of steps.entries()) {
    try {
      if ('click' in s) {
        const el = await find(page, s.click, 'click', s.nth)
        await el.click()
        await settle(page)
      } else if ('hover' in s) {
        const el = await find(page, s.hover, 'click', s.nth)
        await el.hover()
        await settle(page, 250)
      } else if ('type' in s) {
        const el = await find(page, s.in, 'field', s.nth)
        await el.click().catch(() => el.focus())
        await el.evaluate((e) => {
          if (e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement) e.select()
          else if ((e as HTMLElement).isContentEditable) document.execCommand('selectAll')
        })
        // Real key events, so Livewire, Alpine and input masks see each character.
        if (s.type) await page.keyboard.type(s.type, { delay: 15 })
        else await page.keyboard.press('Backspace')
        if (s.enter) await page.keyboard.press('Enter')
        await settle(page)
      } else if ('select' in s) {
        const el = await find(page, s.in, 'field', s.nth)
        const value = await el.evaluate((e, want) => {
          if (!(e instanceof HTMLSelectElement)) return null
          const w = want.trim().toLowerCase()
          const o = Array.from(e.options).find(o => o.text.trim().toLowerCase() === w || o.value.toLowerCase() === w)
            || Array.from(e.options).find(o => o.text.trim().toLowerCase().includes(w))
          return o ? o.value : `__none__:${Array.from(e.options).map(o => o.text.trim()).filter(Boolean).slice(0, 20).join(', ')}`
        }, s.select)
        if (value === null) throw new Error('that field is not a <select>. For a custom dropdown, click it to open it, then click the option')
        if (value.startsWith('__none__:')) throw new Error(`no option "${s.select}". Options: ${value.slice(9)}`)
        await el.select(value)
        await settle(page)
      } else if ('press' in s) {
        await page.keyboard.press(s.press as any)
        await settle(page)
      } else if ('wait' in s) {
        const w = s.wait
        if (typeof w === 'number') await new Promise(r => setTimeout(r, w))
        else {
          const timeout = s.timeout ?? 10_000
          const gone = !!s.gone
          try {
            await page.waitForFunction((t, k, want) => typeof (window as any).__bowerFind === 'function' && (typeof (window as any).__bowerFind(t, k, 1) === 'object') === want, { timeout, polling: 150 }, s.wait, 'click', !gone)
          } catch {
            throw new Error(`"${s.wait}" did not ${gone ? 'go away' : 'appear'} within ${timeout}ms`)
          }
          await settle(page, 250)
        }
      } else if ('scroll' in s) {
        const to = s.scroll
        if (typeof to === 'number') await page.evaluate(y => window.scrollBy({ top: y, behavior: 'instant' as ScrollBehavior }), to)
        else if (to === 'top' || to === 'bottom') await page.evaluate(b => window.scrollTo({ top: b === 'top' ? 0 : document.documentElement.scrollHeight, behavior: 'instant' as ScrollBehavior }), to)
        else {
          const el = await find(page, to, 'click')
          await el.evaluate(e => e.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior }))
        }
        await new Promise(r => setTimeout(r, 250))
      } else if ('goto' in s) {
        const url = hooks.resolve(s.goto)
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 })
        await hooks.navigated?.(url)
        await settle(page, 600)
      } else if ('shot' in s) {
        await hooks.shot(s.shot, !!s.full, i)
      }
    } catch (e: any) {
      // A step error, or an HTTP error from a hook (signed out of the app), passes through as it is.
      if (e instanceof StepError || e?.statusCode) throw e
      throw new StepError(i, s, String(e?.message || e).replace(/^Error:\s*/, ''))
    }
  }
}

// The `wait` step polls the same matcher inside the page, so the finder is installed there once per page.
export async function installFinder(page: Page) {
  await page.evaluateOnNewDocument(`window.__bowerFind = ${findInPage.toString()}`)
}
