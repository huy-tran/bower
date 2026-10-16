import type { Picked } from '~/composables/useSceneEdit'

// Editing inside the preview's scene frame (same origin, so the editor reaches into its document): an outline
// follows the pointer, a click picks an element and a double-click retypes its text in place. Only the editor's
// own preview does this; snapshots, renders and the player never load it.

export interface StageEditHandlers {
  pick: (p: Picked) => void
  // Retyped text, or false when it was cancelled. Resolves to false when the save failed, so the old text comes back.
  commit: (p: Picked, text: string) => Promise<boolean>
  // A double-click on something that is not plain text (or text a setting drives).
  other: (p: Picked) => void
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

function selectorOf(doc: Document, el: Element) {
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

function describe(doc: Document, sceneId: string, el: Element): Picked {
  const i = el.getAttribute('data-ve-i')
  return {
    sceneId,
    selector: selectorOf(doc, el),
    tag: el.tagName.toLowerCase(),
    // In full: it is matched against the file when the text is retyped.
    text: squash(el.textContent || ''),
    html: el.outerHTML.replace(/\sdata-ve-i="\d+"/g, '').replace(/\s+/g, ' ').slice(0, 240),
    index: i === null ? null : Number(i),
    plain: !el.children.length && !!squash(el.textContent || ''),
    param: el.closest('[data-ve-param]')?.getAttribute('data-ve-param') ?? null
  }
}

// The element with number i (data-ve-i) in a scene frame, described as a click on it would be.
export function describeIndexed(frame: HTMLIFrameElement | undefined, sceneId: string, i: number): Picked | null {
  const doc = frame?.contentDocument
  const el = doc?.querySelector(`#stage [data-ve-i="${i}"]`)
  return doc && el ? describe(doc, sceneId, el) : null
}

export function attachStageEditing(frame: HTMLIFrameElement, sceneId: string, h: StageEditHandlers) {
  const doc = frame.contentDocument
  const win = frame.contentWindow
  const stage = doc?.getElementById('stage')
  if (!doc || !win || !stage) return null

  const box = (style: string) => {
    const b = doc.createElement('div')
    b.style.cssText = `position:fixed;pointer-events:none;z-index:2147483647;display:none;border-radius:3px;box-sizing:border-box;${style}`
    doc.body.appendChild(b)
    return b
  }
  const hoverBox = box('outline:1.5px dashed rgba(37,99,235,.9);outline-offset:2px')
  const pickBox = box('outline:2px solid rgb(37,99,235);outline-offset:2px;box-shadow:0 0 0 9999px rgba(15,23,42,.06)')
  let hovered: Element | null = null
  let pickedEl: Element | null = null
  let editing: { el: HTMLElement, before: string, picked: Picked } | null = null

  const place = (b: HTMLElement, el: Element | null) => {
    if (!el || !el.isConnected) { b.style.display = 'none'; return }
    const r = el.getBoundingClientRect()
    Object.assign(b.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` })
  }
  // Scrubbing moves things, so the boxes follow every frame.
  let raf = 0
  const loop = () => {
    place(hoverBox, hovered !== pickedEl ? hovered : null)
    place(pickBox, pickedEl)
    raf = win.requestAnimationFrame(loop)
  }
  raf = win.requestAnimationFrame(loop)

  const targetOf = (e: Event) => {
    const t = e.target as Element | null
    if (!t || t === stage || !stage.contains(t)) return null
    return t
  }

  const onMove = (e: MouseEvent) => { if (!editing) hovered = targetOf(e) }
  const onLeave = () => { hovered = null }
  const onClick = (e: MouseEvent) => {
    if (editing && editing.el.contains(e.target as Node)) return
    e.preventDefault()
    const el = targetOf(e)
    pickedEl = el
    if (el) h.pick(describe(doc, sceneId, el))
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
    if (!(el instanceof (win as unknown as typeof globalThis).HTMLElement)) { pickedEl = el; return h.pick(p) }
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
      doc.removeEventListener('click', onClick, true)
      doc.removeEventListener('dblclick', onDouble, true)
      hoverBox.remove()
      pickBox.remove()
    }
  }
}
