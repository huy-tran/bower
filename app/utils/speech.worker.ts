/// <reference lib="webworker" />
// Runs Kokoro off the main thread so the editor stays responsive while narration is generated.
// Messages in: { id, text, voice, speed }. Messages out: progress, then done (samples + sentence chunks) or error.
declare const self: DedicatedWorkerGlobalScope

const LIB = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm'
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX'
const RATE = 24000
const GAP_MS = 120 // breathing room between sentences

export interface SpeechRequest { id: number, text: string, voice: string, speed: number }
export type SpeechMessage =
  | { id: number, type: 'progress', label: string, pct?: number }
  | { id: number, type: 'done', samples: Float32Array, chunks: { timestamp: [number, number], text: string }[] }
  | { id: number, type: 'error', message: string }

let model: Promise<any> | null = null

function load(id: number) {
  if (!model) {
    self.postMessage({ id, type: 'progress', label: 'Loading voice model' })
    model = import(/* @vite-ignore */ LIB).then(async ({ KokoroTTS, TextSplitterStream }) => ({
      tts: await KokoroTTS.from_pretrained(MODEL, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (p: any) => {
          if (p.status === 'progress' && p.file?.endsWith('.onnx')) self.postMessage({ id, type: 'progress', label: 'Downloading voice model (first time only)', pct: p.progress })
        }
      }),
      TextSplitterStream
    })).catch((e: unknown) => {
      model = null
      throw e
    })
  }
  return model
}

// Requests are handled one after another: the model is single-threaded anyway, and this keeps progress messages honest.
let queue: Promise<void> = Promise.resolve()

self.onmessage = (e: MessageEvent<SpeechRequest>) => {
  const { id, text, voice, speed } = e.data
  queue = queue.then(async () => {
    try {
      const { tts, TextSplitterStream } = await load(id)
      self.postMessage({ id, type: 'progress', label: 'Generating speech' })
      // Feed the whole script through the library's sentence splitter and close it: with a bare string the
      // stream never closes, so the final sentence would wait forever.
      const splitter = new TextSplitterStream()
      splitter.push(text)
      splitter.close()
      const parts: Float32Array[] = []
      const chunks: { timestamp: [number, number], text: string }[] = []
      const gap = new Float32Array(Math.round(RATE * GAP_MS / 1000))
      let pos = 0, spoken = 0
      for await (const piece of tts.stream(splitter, { voice, speed })) {
        const audio: Float32Array = piece.audio.audio
        chunks.push({ timestamp: [pos / RATE, (pos + audio.length) / RATE], text: String(piece.text) })
        parts.push(audio, gap)
        pos += audio.length + gap.length
        spoken += String(piece.text).length
        self.postMessage({ id, type: 'progress', label: 'Generating speech', pct: Math.min(99, 100 * spoken / text.length) })
      }
      if (!chunks.length) throw new Error('Nothing could be spoken from that text')
      const samples = new Float32Array(pos - gap.length)
      let o = 0
      for (const p of parts) { if (o + p.length > samples.length) break; samples.set(p, o); o += p.length }
      self.postMessage({ id, type: 'done', samples, chunks } satisfies SpeechMessage, [samples.buffer])
    } catch (err: any) {
      self.postMessage({ id, type: 'error', message: String(err?.message || err) } satisfies SpeechMessage)
    }
  })
}
