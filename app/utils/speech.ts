// Text-to-speech for voice-over with Kokoro via transformers.js (same setup as captions), run in a Web Worker
// so the editor never freezes while it works. The library and the model (~90 MB) download on first use and are
// cached by the browser; nothing leaves the machine. See speech.worker.ts for the generation itself.
import type { Caption } from '#shared/utils/timeline'
import { toCaptions } from './transcribe'
import type { SpeechMessage, SpeechRequest } from './speech.worker'

const RATE = 24000

// The voices Bower offers (the model ships 28; these three were chosen after auditioning).
// `grade` is the model authors' overall rating; `note` is how it tends to come across.
export interface Voice { value: string, label: string, name: string, accent: 'US' | 'UK', gender: 'Female' | 'Male', grade: string, note: string }
const voice = (value: string, name: string, accent: Voice['accent'], gender: Voice['gender'], grade: string, note: string): Voice =>
  ({ value, label: `${name} · ${accent} ${gender.toLowerCase()}`, name, accent, gender, grade, note })
export const VOICES: Voice[] = [
  voice('af_heart', 'Heart', 'US', 'Female', 'A', 'Warm and clear, the all-rounder'),
  voice('af_sarah', 'Sarah', 'US', 'Female', 'C+', 'Even and neutral'),
  voice('bm_fable', 'Fable', 'UK', 'Male', 'C', 'Crisp and precise')
]

export interface Speech { blob: Blob, durationMs: number, captions: Caption[], spoken: string }
export interface Pronunciation { term: string, sayAs: string }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Swap each term for how it should be said, whole words only, longest terms first so "Acme Pro" beats "Acme".
export function applyPronunciations(text: string, list: Pronunciation[] = []) {
  let out = text
  for (const p of [...list].filter(p => p.term.trim() && p.sayAs.trim()).sort((a, b) => b.term.length - a.term.length)) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(p.term.trim())}(?![\\p{L}\\p{N}])`, 'giu'), p.sayAs.trim())
  }
  return out
}
// Captions should show the real word, not the phonetic spelling.
function restoreTerms(captions: Caption[], list: Pronunciation[] = []) {
  const fixes = [...list].filter(p => p.term.trim() && p.sayAs.trim()).sort((a, b) => b.sayAs.length - a.sayAs.length)
  if (!fixes.length) return captions
  return captions.map(c => ({ ...c, text: fixes.reduce((t, p) => t.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(p.sayAs.trim())}(?![\\p{L}\\p{N}])`, 'giu'), p.term.trim()), c.text) }))
}

type Job = { resolve: (m: Extract<SpeechMessage, { type: 'done' }>) => void, reject: (e: Error) => void, onProgress?: (label: string, pct?: number) => void }
const jobs = new Map<number, Job>()
let worker: Worker | null = null
let nextId = 1

function getWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./speech.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<SpeechMessage>) => {
    const m = e.data
    const job = jobs.get(m.id)
    if (!job) return
    if (m.type === 'progress') return job.onProgress?.(m.label, m.pct)
    jobs.delete(m.id)
    m.type === 'done' ? job.resolve(m) : job.reject(new Error(m.message))
  }
  worker.onerror = (e) => {
    // The worker itself broke (for example the CDN was unreachable): fail every waiting job and start fresh next time.
    for (const job of jobs.values()) job.reject(new Error(e.message || 'The speech engine stopped'))
    jobs.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

// 16-bit PCM mono WAV.
function toWav(samples: Float32Array) {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buf)
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([buf], { type: 'audio/wav' })
}

export async function speak(text: string, opts: { voice?: string, speed?: number, pronunciations?: Pronunciation[] } = {}, onProgress?: (label: string, pct?: number) => void): Promise<Speech> {
  const script = applyPronunciations(text.replace(/\s+/g, ' ').trim(), opts.pronunciations)
  if (!script) throw new Error('Type something to say first')
  const id = nextId++
  const done = await new Promise<Extract<SpeechMessage, { type: 'done' }>>((resolve, reject) => {
    jobs.set(id, { resolve, reject, onProgress })
    const req: SpeechRequest = { id, text: script, voice: opts.voice ?? 'af_heart', speed: opts.speed ?? 1 }
    getWorker().postMessage(req)
  })
  const durationMs = Math.round(done.samples.length / RATE * 1000)
  return { blob: toWav(done.samples), durationMs, captions: restoreTerms(toCaptions(done.chunks, durationMs), opts.pronunciations), spoken: script }
}
