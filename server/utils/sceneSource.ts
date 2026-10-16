import { createHash } from 'node:crypto'

// Reading and changing a scene file by hand: its text, its animation timings and its source as a whole.
// Everything works on the source string and leaves the rest of the file byte for byte as it was.

export const sourceHash = (html: string) => createHash('sha1').update(html).digest('hex').slice(0, 16)

interface El { i: number, name: string, start: number, openEnd: number, contentStart: number, contentEnd: number }

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const RAW = new Set(['script', 'style', 'textarea', 'title'])

// The elements of a scene's markup in source order, numbered the same way every time. Script and style content
// is skipped (it is not markup), and elements are matched to their end tags by name.
function elements(html: string): El[] {
  const out: El[] = []
  const stack: El[] = []
  let pos = 0
  while (pos < html.length) {
    const lt = html.indexOf('<', pos)
    if (lt < 0) break
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4)
      pos = end < 0 ? html.length : end + 3
      continue
    }
    const close = html[lt + 1] === '/'
    const m = /^<\/?([a-zA-Z][\w:-]*)/.exec(html.slice(lt, lt + 80))
    if (!m) { pos = lt + 1; continue }
    const name = m[1]!.toLowerCase()
    const gt = tagEnd(html, lt + m[0].length)
    if (gt < 0) break
    if (close) {
      const at = stack.map(e => e.name).lastIndexOf(name)
      if (at >= 0) {
        stack[at]!.contentEnd = lt
        stack.length = at
      }
      pos = gt + 1
      continue
    }
    const selfClosing = html[gt - 1] === '/'
    const el: El = { i: out.length, name, start: lt, openEnd: selfClosing ? gt - 1 : gt, contentStart: gt + 1, contentEnd: -1 }
    out.push(el)
    pos = gt + 1
    if (RAW.has(name)) {
      const end = html.toLowerCase().indexOf(`</${name}`, pos)
      el.contentEnd = end < 0 ? html.length : end
      pos = end < 0 ? html.length : tagEnd(html, end) + 1
      continue
    }
    if (!selfClosing && !VOID.has(name)) stack.push(el)
  }
  return out
}

// The `>` closing a tag, skipping quoted attribute values (which may contain `>`).
function tagEnd(html: string, from: number) {
  let q = ''
  for (let i = from; i < html.length; i++) {
    const c = html[i]
    if (q) { if (c === q) q = '' } else if (c === '"' || c === "'") q = c
    else if (c === '>') return i
  }
  return -1
}

const decode = (s: string) => s
  .replace(/&nbsp;/g, '\u00a0').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&')
const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;')
const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

// Marks every element with its number (data-ve-i) so the editor's preview can say which one was edited.
// Only for the editor's own preview: snapshots, renders and the player never see these attributes.
export function stampElements(html: string) {
  let out = ''
  let last = 0
  for (const el of elements(html)) {
    if (el.name === 'script' || el.name === 'style') continue
    out += html.slice(last, el.openEnd) + ` data-ve-i="${el.i}"`
    last = el.openEnd
  }
  return out + html.slice(last)
}

// Where each element of the markup starts, for "Show in code".
export function elementStarts(html: string) {
  return elements(html).filter(el => el.name !== 'script' && el.name !== 'style').map(el => ({ i: el.i, start: el.start }))
}

const attrRe = (name: string) => new RegExp(`\\s${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, 'i')

// An attribute of element i, as written (quotes removed), or null.
export function elementAttr(html: string, i: number, name: string) {
  const el = elements(html)[i]
  if (!el) return null
  const m = attrRe(name).exec(html.slice(el.start, el.openEnd))
  return m ? m[1]!.replace(/^["']|["']$/g, '') : null
}

// Sets (or, with null, removes) an attribute of element i.
export function setElementAttr(html: string, i: number, name: string, value: string | null) {
  const el = elements(html)[i]
  if (!el || el.name === 'script' || el.name === 'style') throw createError({ statusCode: 422, message: 'That element is no longer in the scene. Reload and try again.' })
  let tag = html.slice(el.start, el.openEnd)
  const m = attrRe(name).exec(tag)
  const attr = value === null ? '' : ` ${name}="${value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`
  tag = m ? tag.slice(0, m.index) + attr + tag.slice(m.index + m[0].length) : tag + attr
  return html.slice(0, el.start) + tag + html.slice(el.openEnd)
}

// Every data-ve-id in the markup, to keep new ones unique.
export function layerIds(html: string) {
  return new Set([...html.matchAll(/\sdata-ve-id\s*=\s*["']?([\w-]+)/g)].map(m => m[1]!))
}

// Elements holding only text (no child elements), which can be retyped in place.
export function textElements(html: string) {
  return elements(html)
    .filter(el => !RAW.has(el.name) && el.contentEnd > el.contentStart)
    .map(el => ({ el, raw: html.slice(el.contentStart, el.contentEnd) }))
    .filter(({ raw }) => !raw.includes('<') && raw.trim())
    .map(({ el, raw }) => ({ i: el.i, tag: el.name, text: squash(decode(raw)) }))
}

// Retypes element i. `before` is the text the editor showed, so an edit made against an older file fails
// rather than landing on the wrong element.
export function setElementText(html: string, i: number, before: string, text: string) {
  const el = elements(html)[i]
  if (!el || el.contentEnd < el.contentStart) throw createError({ statusCode: 422, message: 'That element is no longer in the scene. Reload and try again.' })
  const raw = html.slice(el.contentStart, el.contentEnd)
  if (raw.includes('<')) throw createError({ statusCode: 422, message: 'That element holds more than text. Ask Claude to change it.' })
  if (squash(decode(raw)) !== squash(before)) throw createError({ statusCode: 409, message: 'The scene changed since you started editing. Try again.' })
  const lead = raw.match(/^\s*/)![0], trail = raw.match(/\s*$/)![0]
  return html.slice(0, el.contentStart) + lead + escapeText(text.trim()) + trail + html.slice(el.contentEnd)
}

// The scene's own scripts (not the JSON meta block), as [start, end) ranges of the source.
function scriptRanges(html: string) {
  return elements(html)
    .filter(el => el.name === 'script' && !/type=["']application\/json["']/i.test(html.slice(el.start, el.openEnd)))
    .map(el => [el.contentStart, el.contentEnd] as const)
}

// String literals in the scene's scripts: [start, end) of the whole literal, its quote and its value.
function stringLiterals(html: string) {
  const out: { start: number, end: number, quote: string, value: string }[] = []
  for (const [from, to] of scriptRanges(html)) {
    let i = from
    while (i < to) {
      const c = html[i]!
      // Comments, so quotes inside them are not read as strings.
      if (c === '/' && html[i + 1] === '/') { const n = html.indexOf('\n', i); i = n < 0 || n > to ? to : n; continue }
      if (c === '/' && html[i + 1] === '*') { const n = html.indexOf('*/', i + 2); i = n < 0 || n > to ? to : n + 2; continue }
      if (c !== '"' && c !== "'" && c !== '`') { i++; continue }
      let j = i + 1
      let value = ''
      let plain = true
      while (j < to && html[j] !== c) {
        if (html[j] === '\\') { value += unescapeJs(html.slice(j, j + 2)); j += 2; continue }
        if (c === '`' && html[j] === '$' && html[j + 1] === '{') plain = false
        if (c !== '`' && html[j] === '\n') break
        value += html[j]
        j++
      }
      if (plain) out.push({ start: i, end: j + 1, quote: c, value })
      i = j + 1
    }
  }
  return out
}

const unescapeJs = (s: string) => ({ '\\n': '\n', '\\t': '\t', "\\'": "'", '\\"': '"', '\\`': '`', '\\\\': '\\' } as Record<string, string>)[s] ?? s.slice(1)
const quoteJs = (s: string, q: string) => q + s.replace(/\\/g, '\\\\').replace(new RegExp(q, 'g'), `\\${q}`).replace(/\n/g, '\\n').replace(/<\/script/gi, '<\\/script') + q

// Text the scene's code puts on screen (a label in an array, a word typed letter by letter): changed in place when
// exactly one string in the scripts holds it.
export function setCodeText(html: string, before: string, text: string) {
  const want = squash(before)
  const hits = stringLiterals(html).filter(l => squash(l.value) === want)
  if (hits.length !== 1) {
    throw createError({ statusCode: 422, message: hits.length ? 'That text appears more than once in the scene\'s code. Ask Claude to change it.' : 'That text is built by the scene\'s code. Ask Claude to change it.' })
  }
  const h = hits[0]!
  return html.slice(0, h.start) + quoteJs(text.trim(), h.quote) + html.slice(h.end)
}

// Animation timings: every VE.progress(t, start, duration, ease) call whose start and duration are plain numbers,
// `VE.duration - n` (counted back from the end) or `VE.stagger(i, step, start)`.
export type TimingStart = { kind: 'at', ms: number } | { kind: 'end', ms: number } | { kind: 'stagger', ms: number, step: number, index: string }
export interface Timing {
  offset: number
  match: string
  label: string
  line: string
  start: TimingStart
  dur: number
  ease: string | null
}

const NUM = /^-?\d+(?:\.\d+)?$/

// The arguments of a call whose `(` is at `open`, split at top-level commas, and the index of its `)`.
function callArgs(html: string, open: number, limit: number) {
  const args: string[] = []
  let depth = 0, q = '', cur = ''
  for (let i = open + 1; i < limit; i++) {
    const c = html[i]!
    if (q) { cur += c; if (c === '\\') { cur += html[++i]; continue } if (c === q) q = ''; continue }
    if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue }
    if (c === '(' || c === '[' || c === '{') depth++
    if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) { args.push(cur.trim()); return { args, close: i } }
      depth--
    }
    if (c === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue }
    cur += c
  }
  return null
}

function parseStart(s: string): TimingStart | null {
  if (NUM.test(s)) return { kind: 'at', ms: Number(s) }
  let m = /^VE\.duration\s*-\s*(\d+(?:\.\d+)?)$/.exec(s)
  if (m) return { kind: 'end', ms: Number(m[1]) }
  m = /^VE\.stagger\(\s*([\w.]+)\s*,\s*(\d+(?:\.\d+)?)\s*(?:,\s*(\d+(?:\.\d+)?)\s*)?\)$/.exec(s)
  if (m) return { kind: 'stagger', index: m[1]!, step: Number(m[2]), ms: Number(m[3] ?? 0) }
  return null
}

const startText = (s: TimingStart) => s.kind === 'at' ? String(Math.round(s.ms))
  : s.kind === 'end' ? `VE.duration - ${Math.round(s.ms)}`
    : `VE.stagger(${s.index}, ${Math.round(s.step)}, ${Math.round(s.ms)})`

export function findTimings(html: string) {
  const timings: Timing[] = []
  let computed = 0
  for (const [from, to] of scriptRanges(html)) {
    const re = /VE\.progress\s*\(/g
    re.lastIndex = from
    let m: RegExpExecArray | null
    while ((m = re.exec(html)) && m.index < to) {
      const call = callArgs(html, m.index + m[0].length - 1, to)
      if (!call) continue
      const [, s, d, e] = call.args
      const start = s ? parseStart(s) : null
      const ease = e ? /^(['"])(\w+)\1$/.exec(e)?.[2] ?? undefined : null
      if (!start || !d || !NUM.test(d) || ease === undefined || call.args.length > 4) { computed++; continue }
      const lineStart = html.lastIndexOf('\n', m.index) + 1
      const lineEnd = html.indexOf('\n', m.index)
      const line = html.slice(lineStart, lineEnd < 0 ? to : lineEnd).trim()
      // Named after the variable it is assigned to (`const fade = VE.progress(...)`); a second call in the same
      // expression gets a number ("open 2").
      const name = /(?:const|let|var)\s+(\w+)\s*=/.exec(html.slice(lineStart, m.index))?.[1]
      const same = name ? timings.filter(x => x.label === name || x.label.startsWith(`${name} `)).length : 0
      const label = name ? (same ? `${name} ${same + 1}` : name) : line.replace(/\s+/g, ' ').slice(0, 60)
      timings.push({ offset: m.index, match: html.slice(m.index, call.close + 1), label, line, start, dur: Number(d), ease })
    }
  }
  return { timings, computed }
}

// Rewrites one VE.progress call. `match` is the call as the editor saw it, so a stale edit fails.
export function setTiming(html: string, offset: number, match: string, next: { start: TimingStart, dur: number, ease: string | null }) {
  if (html.slice(offset, offset + match.length) !== match) throw createError({ statusCode: 409, message: 'The scene changed since you started editing. Try again.' })
  const call = callArgs(html, html.indexOf('(', offset), html.length)!
  const quote = /^(['"])/.exec(call.args[3] ?? '')?.[1] ?? "'"
  const args = [call.args[0]!, startText(next.start), String(Math.max(0, Math.round(next.dur)))]
  if (next.ease) args.push(`${quote}${next.ease.replace(/\W/g, '')}${quote}`)
  return html.slice(0, offset) + `VE.progress(${args.join(', ')})` + html.slice(offset + match.length)
}
