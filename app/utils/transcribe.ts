// Speech-to-text for voice-over captions, run in the browser with Whisper via transformers.js.
// The library and the model (~80 MB) download on first use and are cached by the browser; audio never leaves the machine.
import type { Caption } from '#shared/utils/timeline'

const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0'
const MODEL = 'Xenova/whisper-base.en'
const MAX_WORDS = 8

let pipe: Promise<any> | null = null

async function decode16k(url: string) {
  const buf = await (await fetch(url)).arrayBuffer()
  const probe = new OfflineAudioContext(1, 1, 16000)
  const decoded = await probe.decodeAudioData(buf)
  const ctx = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000)
  const src = ctx.createBufferSource()
  src.buffer = decoded
  src.connect(ctx.destination)
  src.start()
  return (await ctx.startRendering()).getChannelData(0)
}

// Whisper gives sentence-sized chunks; split long ones into caption-sized lines spread evenly over the chunk.
export function toCaptions(chunks: { timestamp: [number, number | null], text: string }[], total: number): Caption[] {
  const out: Caption[] = []
  chunks.forEach((c, i) => {
    const words = c.text.trim().split(/\s+/).filter(Boolean)
    if (!words.length) return
    const start = c.timestamp[0] * 1000
    const end = (c.timestamp[1] ?? chunks[i + 1]?.timestamp[0] ?? total / 1000) * 1000
    const lines = Math.ceil(words.length / MAX_WORDS)
    const per = Math.ceil(words.length / lines)
    for (let l = 0; l < lines; l++) {
      const w = words.slice(l * per, (l + 1) * per)
      const a = start + (end - start) * (l * per) / words.length
      const b = start + (end - start) * Math.min(words.length, (l + 1) * per) / words.length
      out.push({ start: Math.round(a), end: Math.round(b), text: w.join(' ') })
    }
  })
  return out.filter(c => c.end > c.start)
}

export async function transcribe(url: string, onProgress?: (label: string, pct?: number) => void): Promise<Caption[]> {
  onProgress?.('Preparing audio')
  const audio = await decode16k(url)
  if (!pipe) {
    onProgress?.('Loading speech model')
    const { pipeline } = await import(/* @vite-ignore */ LIB)
    pipe = pipeline('automatic-speech-recognition', MODEL, {
      progress_callback: (p: any) => {
        if (p.status === 'progress' && p.file?.endsWith('.onnx')) onProgress?.('Downloading speech model (first time only)', p.progress)
      }
    }).catch((e: unknown) => {
      pipe = null
      throw e
    })
  }
  const asr = await pipe
  onProgress?.('Transcribing')
  const res = await asr(audio, { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 })
  // Total length in ms: samples at 16 kHz.
  return toCaptions(res.chunks ?? [{ timestamp: [0, audio.length / 16000], text: res.text }], audio.length / 16)
}

const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, '0')
const stamp = (ms: number, sep: ',' | '.') => `${pad(ms / 3600000)}:${pad(ms / 60000 % 60)}:${pad(ms / 1000 % 60)}${sep}${pad(ms % 1000, 3)}`

// Subtitle files for the whole video (captions are clip-relative, so each is shifted by its clip's start).
export function subtitles(clips: { start: number, captions?: Caption[] | null }[], format: 'srt' | 'vtt') {
  const all = clips.flatMap(c => (c.captions ?? []).map(x => ({ start: c.start + x.start, end: c.start + x.end, text: x.text })))
    .sort((a, b) => a.start - b.start)
  const sep = format === 'srt' ? ',' : '.'
  const body = all.map((c, i) => `${format === 'srt' ? `${i + 1}\n` : ''}${stamp(c.start, sep)} --> ${stamp(c.end, sep)}\n${c.text}\n`).join('\n')
  return format === 'vtt' ? `WEBVTT\n\n${body}` : body
}
