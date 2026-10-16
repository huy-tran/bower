import type { Picked } from '~/composables/useSceneEdit'

// Editing inside the preview's scene frame (same origin, so the editor reaches into its document): an outline
// follows the pointer, a click picks an element, a double-click retypes its text in place, and the picked element
// gets a transform box (drag it to move, its corners to scale, the handle above to rotate) and its motion path.
// Only the editor's own preview does this; snapshots, renders and the player never load it.

export type TransformKind = 'move' | 'scale' | 'rotate'
export type TransformPhase = 'start' | 'move' | 'end'
// Changes since the drag started, in stage pixels and degrees.
export interface TransformDelta { dx: number, dy: number, factor: number, angle: number }
// The picked element's motion path: its x/y offsets over time, and at its keyframes and now.
export interface MotionPath { points: [number, number][], keys: [number, number][], now: [number, number] }

export interface StageEditHandlers {
  pick: (p: Picked | null) => void
  // Retyped text, or false when it was cancelled. Resolves to false when the save failed, so the old text comes back.
  commit: (p: Picked, text: string) => Promise<boolean>
  // A double-click on something that is not plain text (or text a setting drives).
  other: (p: Picked) => void
  transform: (kind: TransformKind, phase: TransformPhase, d: TransformDelta) => void
  path: () => MotionPath | null
}

export interface LayerItem { selector: string, name: string, depth: number, tag: string, index: number | null, veId: string | null }

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()
const SKIP = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'TEMPLATE', 'BR'])

function selectorOf(doc: Document, el: Element) {
  const id = el.getAttribute('data-ve-id')
  if (id && doc.querySelectorAll(`#stage [data-ve-id="${CSS.escape(id)}"]`).length === 1) return `[data-ve-id="${id}"]`
  const parts: string[] = []
  let n: Element | null = el
  while (n && n.id !== 'stage' && parts.length < 5) {
    if (n.id) { parts.unshift(`#${CSS.escape(n.id)}`); break }
    let s = n.tagName.toLowerCase()
    const cls = [...n.classList].slice(0, 2)
    if (cls.length) s += cls.map(c => `.${CSS.escape(c)}`).join('')
    const parent: Element | null = n.parentElement
    if (parent && parent.querySelectorAll(`:scope > ${s}`).length > 1) s += `:nth-of-type(${[...parent.children].filter(c => c.tagName === n!.tagName).indexOf(n) + 1})`
    parts.unshift(s)
    if (doc.querySelectorAll(`#stage ${parts.join(' > ')}`).length === 1) break
    n = parent
  }
  return parts.join(' > ')
}

// A readable name: its data-ve-name, else its first class ("an-title" -> "an title"), else its tag, with its text.
export function layerName(el: Element) {
  const named = el.getAttribute('data-ve-name')
  if (named) return named
  const cls = [...el.classList][0]
  const base = cls ? cls.replace(/[-_]+/g, ' ') : el.tagName.toLowerCase()
  const text = !el.children.length ? squash(el.textContent || '') : ''
  return text ? `${base} · “${text.length > 24 ? `${text.slice(0, 24)}…` : text}”` : base
}

function describe(doc: Document, sceneId: string, el: Element): Picked {
  const i = el.getAttribute('data-ve-i')
  const cs = doc.defaultView!.getComputedStyle(el)
  const num = (v: string) => Number.parseFloat(v) || 0
  const fontSize = num(cs.fontSize)
  return {
    sceneId,
    selector: selectorOf(doc, el),
    tag: el.tagName.toLowerCase(),
    // In full: it is matched against the file when the text is retyped.
    text: squash(el.textContent || ''),
    html: el.outerHTML.replace(/\sdata-ve-i="\d+"/g, '').replace(/\s+/g, ' ').slice(0, 240),
    index: i === null ? null : Number(i),
    plain: !el.children.length && !!squash(el.textContent || ''),
    param: el.closest('[data-ve-param]')?.getAttribute('data-ve-param') ?? null,
    veId: el.getAttribute('data-ve-id'),
    name: layerName(el),
    // What style properties are now, for an inspector field with no value of its own.
    styles: {
      color: cs.color,
      background: cs.backgroundColor,
      fontSize,
      letterSpacing: cs.letterSpacing === 'normal' || !fontSize ? 0 : Math.round(num(cs.letterSpacing) / fontSize * 1000) / 1000,
      radius: num(cs.borderTopLeftRadius)
    }
  }
}

// The element with number i (data-ve-i) in a scene frame, described as a click on it would be.
export function describeIndexed(frame: HTMLIFrameElement | undefined, sceneId: string, i: number): Picked | null {
  return describeSelector(frame, sceneId, `[data-ve-i="${i}"]`)
}

export function describeSelector(frame: HTMLIFrameElement | undefined, sceneId: string, selector: string): Picked | null {
  const doc = frame?.contentDocument
  let el: Element | null | undefined = null
  try { el = doc?.querySelector(`#stage ${selector}`) } catch {}
  return doc && el ? describe(doc, sceneId, el) : null
}

// The scene's elements as layers, outermost first, a few levels deep.
export function listLayers(frame: HTMLIFrameElement | undefined): LayerItem[] {
  const doc = frame?.contentDocument
  const stage = doc?.getElementById('stage')
  if (!doc || !stage) return []
  const out: LayerItem[] = []
  const walk = (parent: Element, depth: number) => {
    for (const el of parent.children) {
      if (SKIP.has(el.tagName) || out.length >= 300) continue
      const i = el.getAttribute('data-ve-i')
      out.push({ selector: selectorOf(doc, el), name: layerName(el), depth, tag: el.tagName.toLowerCase(), index: i === null ? null : Number(i), veId: el.getAttribute('data-ve-id') })
      // Inside an SVG drawing or a live UI snapshot the parts are rarely worth listing one by one.
      if (depth < 3 && el.tagName.toLowerCase() !== 'svg' && el.tagName.toLowerCase() !== 've-ui') walk(el, depth + 1)
    }
  }
  walk(stage, 0)
  return out
}

export function attachStageEditing(frame: HTMLIFrameElement, sceneId: string, h: StageEditHandlers) {
  const doc = frame.contentDocument
  const win = frame.contentWindow as (Window & typeof globalThis & { VE?: { width: number } }) | null
  const stage = doc?.getElementById('stage')
  if (!doc || !win || !stage) return null
  const BLUE = 'rgb(37,99,235)'

  const box = (style: string) => {
    const b = doc.createElement('div')
    b.style.cssText = `position:fixed;pointer-events:none;z-index:2147483646;display:none;border-radius:3px;box-sizing:border-box;${style}`
    doc.body.appendChild(b)
    return b
  }
  const hoverBox = box('outline:1.5px dashed rgba(37,99,235,.9);outline-offset:2px')
  const pickBox = box(`outline:2px solid ${BLUE};outline-offset:2px`)
  // Corner handles scale, the round one above rotates.
  const handles = (['nw', 'ne', 'sw', 'se'] as const).map((corner) => {
    const d = doc.createElement('div')
    d.dataset.corner = corner
    d.style.cssText = `position:absolute;width:10px;height:10px;background:#fff;border:2px solid ${BLUE};border-radius:2px;pointer-events:auto;box-sizing:border-box;cursor:${corner === 'nw' || corner === 'se' ? 'nwse' : 'nesw'}-resize;`
    Object.assign(d.style, corner[0] === 'n' ? { top: '-8px' } : { bottom: '-8px' }, corner[1] === 'w' ? { left: '-8px' } : { right: '-8px' })
    pickBox.appendChild(d)
    return d
  })
  const stem = doc.createElement('div')
  stem.style.cssText = `position:absolute;left:50%;top:-30px;width:2px;height:24px;margin-left:-1px;background:${BLUE};pointer-events:none;`
  const rot = doc.createElement('div')
  rot.style.cssText = `position:absolute;left:50%;top:-40px;width:14px;height:14px;margin-left:-7px;background:#fff;border:2px solid ${BLUE};border-radius:50%;pointer-events:auto;box-sizing:border-box;cursor:grab;`
  pickBox.append(stem, rot)

  const NS = 'http://www.w3.org/2000/svg'
  const pathSvg = doc.createElementNS(NS, 'svg')
  pathSvg.setAttribute('style', 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:2147483645;overflow:visible;display:none')
  const pathLine = doc.createElementNS(NS, 'polyline')
  pathLine.setAttribute('style', `fill:none;stroke:${BLUE};stroke-width:1.5;stroke-dasharray:4 3;opacity:.85`)
  const pathDots = doc.createElementNS(NS, 'g')
  pathSvg.append(pathLine, pathDots)
  doc.body.appendChild(pathSvg)

  let hovered: Element | null = null
  let pickedEl: Element | null = null
  let editing: { el: HTMLElement, before: string, picked: Picked } | null = null
  let dragging = false
  let suppressClick = false

  const stageScale = () => stage.getBoundingClientRect().width / (win.VE?.width || stage.offsetWidth || 1)
  const place = (b: HTMLElement, el: Element | null) => {
    if (!el || !el.isConnected) { b.style.display = 'none'; return }
    const r = el.getBoundingClientRect()
    Object.assign(b.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` })
  }
  function drawPath() {
    const p = pickedEl?.isConnected ? h.path() : null
    if (!p || p.points.length < 2) { pathSvg.style.display = 'none'; return }
    const r = pickedEl!.getBoundingClientRect()
    const s = stageScale()
    const cx = r.left + r.width / 2 - p.now[0] * s, cy = r.top + r.height / 2 - p.now[1] * s
    const at = ([x, y]: [number, number]) => [cx + x * s, cy + y * s]
    pathLine.setAttribute('points', p.points.map(pt => at(pt).join(',')).join(' '))
    pathDots.replaceChildren(...p.keys.map((k) => {
      const [x, y] = at(k)
      const c = doc!.createElementNS(NS, 'rect')
      c.setAttribute('x', String(x! - 4)); c.setAttribute('y', String(y! - 4))
      c.setAttribute('width', '8'); c.setAttribute('height', '8')
      c.setAttribute('transform', `rotate(45 ${x} ${y})`)
      c.setAttribute('style', `fill:#fff;stroke:${BLUE};stroke-width:1.5`)
      return c
    }))
    pathSvg.style.display = 'block'
  }
  // Handles of an element that reaches the frame's edge (a full-width title) move inside so they can be grabbed, and
  // the rotate handle goes below an element at the top.
  function placeHandles() {
    if (pickBox.style.display === 'none') return
    const r = pickBox.getBoundingClientRect()
    const W = win!.innerWidth, H = win!.innerHeight
    const clamp = (v: number, max: number) => Math.min(Math.max(v, 8), max - 8)
    // Each handle sits on its corner, kept inside the frame, positioned relative to the box.
    for (const d of handles) {
      const c = d.dataset.corner!
      const x = clamp(c[1] === 'w' ? r.left - 2 : r.right + 2, W), y = clamp(c[0] === 'n' ? r.top - 2 : r.bottom + 2, H)
      Object.assign(d.style, { left: `${x - r.left - 5}px`, top: `${y - r.top - 5}px`, right: 'auto', bottom: 'auto' })
    }
    // The rotate handle goes above the box, or below it when there is no room, and always inside the frame.
    const above = r.top - 34 >= 8
    const ry = above ? r.top - 34 : clamp(r.bottom + 34, H)
    const rx = clamp(r.left + r.width / 2, W)
    Object.assign(rot.style, { left: `${rx - r.left - 7}px`, top: `${ry - r.top - 7}px`, marginLeft: '0', bottom: 'auto' })
    const stemFrom = above ? ry + 7 : r.bottom - r.top
    Object.assign(stem.style, { display: Math.abs(ry - (above ? r.top : r.bottom)) > 40 ? 'none' : 'block', left: `${rx - r.left - 1}px`, marginLeft: '0', top: `${above ? ry - r.top + 7 : stemFrom}px`, height: `${Math.max(0, above ? r.top - ry - 7 : ry - r.bottom - 7)}px`, bottom: 'auto' })
  }

  // Scrubbing moves things, so the boxes and the path follow every frame.
  let raf = 0
  const loop = () => {
    place(hoverBox, hovered !== pickedEl && !dragging ? hovered : null)
    place(pickBox, editing ? null : pickedEl)
    placeHandles()
    drawPath()
    raf = win.requestAnimationFrame(loop)
  }
  raf = win.requestAnimationFrame(loop)

  const targetOf = (e: Event) => {
    const t = e.target as Element | null
    if (!t || t === stage || !stage.contains(t)) return null
    return t
  }

  const onMove = (e: MouseEvent) => { if (!editing && !dragging) hovered = targetOf(e) }
  const onLeave = () => { hovered = null }
  const onClick = (e: MouseEvent) => {
    if (editing && editing.el.contains(e.target as Node)) return
    e.preventDefault()
    if (suppressClick) { suppressClick = false; return }
    const el = targetOf(e)
    pickedEl = el
    h.pick(el ? describe(doc, sceneId, el) : null)
  }

  // Dragging: the picked element moves, a corner scales it, the round handle rotates it. A press that does not move
  // more than a few pixels stays a click.
  function startDrag(e: PointerEvent, kind: TransformKind) {
    const el = pickedEl
    if (!el) return
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    const x0 = e.clientX, y0 = e.clientY
    const d0 = Math.hypot(x0 - cx, y0 - cy) || 1
    const a0 = Math.atan2(y0 - cy, x0 - cx)
    const s = stageScale()
    let started = kind !== 'move'
    const target = e.target as HTMLElement
    target.setPointerCapture?.(e.pointerId)
    const delta = (ev: PointerEvent): TransformDelta => {
      let dx = (ev.clientX - x0) / s, dy = (ev.clientY - y0) / s
      if (ev.shiftKey && kind === 'move') { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0 }
      let angle = (Math.atan2(ev.clientY - cy, ev.clientX - cx) - a0) * 180 / Math.PI
      if (ev.shiftKey && kind === 'rotate') angle = Math.round(angle / 15) * 15
      return { dx, dy, factor: Math.max(0.01, Math.hypot(ev.clientX - cx, ev.clientY - cy) / d0), angle }
    }
    if (started) { dragging = true; h.transform(kind, 'start', delta(e)) }
    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return
        started = true
        dragging = true
        hovered = null
        h.transform(kind, 'start', delta(ev))
      }
      h.transform(kind, 'move', delta(ev))
    }
    const up = (ev: PointerEvent) => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', up)
      if (!started) return
      dragging = false
      suppressClick = true
      h.transform(kind, 'end', delta(ev))
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', up)
  }
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || editing) return
    const t = e.target as Element
    if (t === rot) { e.preventDefault(); return startDrag(e, 'rotate') }
    if (handles.includes(t as HTMLDivElement)) { e.preventDefault(); return startDrag(e, 'scale') }
    if (pickedEl && pickedEl.contains(t)) startDrag(e, 'move')
  }

  async function finish(save: boolean) {
    const ed = editing
    if (!ed) return
    editing = null
    ed.el.removeAttribute('contenteditable')
    ed.el.style.removeProperty('cursor')
    ed.el.removeEventListener('keydown', onKeys)
    ed.el.removeEventListener('blur', onBlur)
    win!.getSelection()?.removeAllRanges()
    const text = squash(ed.el.textContent || '')
    if (!save || !text || text === squash(ed.before)) { ed.el.textContent = ed.before; return }
    if (!await h.commit(ed.picked, text)) ed.el.textContent = ed.before
  }
  const onKeys = (e: KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true) }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false) }
  }
  const onBlur = () => { finish(true) }

  const onDouble = (e: MouseEvent) => {
    e.preventDefault()
    const el = targetOf(e) as HTMLElement | null
    if (!el || editing) return
    const p = describe(doc, sceneId, el)
    // SVG text cannot be edited in place (contenteditable is HTML only): pick it, and the panel's field retypes it.
    // (The frame has its own window, so its elements are instances of its HTMLElement, not the editor's.)
    if (!(el instanceof win.HTMLElement)) { pickedEl = el; return h.pick(p) }
    // Text that a setting drives, or an element holding more than text: the panel handles those.
    if (p.param || !p.plain) return h.other(p)
    editing = { el, before: el.textContent || '', picked: p }
    hovered = null
    el.setAttribute('contenteditable', 'plaintext-only')
    el.style.cursor = 'text'
    el.addEventListener('keydown', onKeys)
    el.addEventListener('blur', onBlur)
    el.focus()
    const range = doc.createRange()
    range.selectNodeContents(el)
    win.getSelection()?.removeAllRanges()
    win.getSelection()?.addRange(range)
  }

  doc.addEventListener('mousemove', onMove)
  doc.addEventListener('mouseleave', onLeave)
  doc.addEventListener('pointerdown', onPointerDown, true)
  doc.addEventListener('click', onClick, true)
  doc.addEventListener('dblclick', onDouble, true)
  doc.documentElement.style.cursor = 'default'

  return {
    // Outlines the element the panel has picked (after a reload the frame has new elements).
    show(selector: string | null) {
      try { pickedEl = selector ? stage.querySelector(selector) : null } catch { pickedEl = null }
    },
    detach() {
      win.cancelAnimationFrame(raf)
      finish(false)
      doc.removeEventListener('mousemove', onMove)
      doc.removeEventListener('mouseleave', onLeave)
      doc.removeEventListener('pointerdown', onPointerDown, true)
      doc.removeEventListener('click', onClick, true)
      doc.removeEventListener('dblclick', onDouble, true)
      hoverBox.remove()
      pickBox.remove()
      pathSvg.remove()
    }
  }
}
