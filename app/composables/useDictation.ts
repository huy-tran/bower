// Voice input via the browser's Web Speech API (Chrome, Edge, Safari). Firefox has no support,
// so callers should hide the mic when `supported` is false.

type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: any) => void) | null
  onerror: ((e: any) => void) | null
  onend: (() => void) | null
}

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked. Allow it from the address bar, then try again.',
  'service-not-allowed': 'Microphone access is blocked. Allow it from the address bar, then try again.',
  'audio-capture': 'No microphone was found.',
  'network': 'Speech recognition needs an internet connection.',
  'language-not-supported': 'This language is not supported for dictation.'
}

export function useDictation(onText: (text: string) => void) {
  const Ctor = import.meta.client ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null
  const supported = !!Ctor
  const listening = ref(false)
  const error = ref<string | null>(null)
  let rec: Recognition | null = null
  let base = ''
  let finals = ''
  let ended: (() => void) | null = null

  function join(...parts: string[]) {
    return parts.map(p => p.trim()).filter(Boolean).join(' ')
  }

  // `current` is the text already in the box; dictation is appended after it.
  function start(current: string) {
    if (!supported || listening.value) return
    error.value = null
    base = current
    finals = ''
    rec = new Ctor() as Recognition
    rec.lang = navigator.language || 'en-AU'
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finals = join(finals, r[0].transcript)
        else interim = join(interim, r[0].transcript)
      }
      onText(join(base, finals, interim))
    }
    rec.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') error.value = ERRORS[e.error] || `Dictation stopped: ${e.error}`
    }
    rec.onend = () => {
      listening.value = false
      // Drop any unconfirmed words so the box holds exactly what was recognised.
      onText(join(base, finals))
      rec = null
      ended?.()
      ended = null
    }
    rec.start()
    listening.value = true
  }

  // Resolves once the browser has delivered the final words and the box holds them.
  function stop() {
    if (!rec) return Promise.resolve()
    const done = new Promise<void>((resolve) => {
      ended = resolve
      setTimeout(resolve, 1500) // never hang a send on a browser that skips onend
    })
    rec.stop()
    return done
  }

  function toggle(current: string) {
    listening.value ? stop() : start(current)
  }

  onBeforeUnmount(() => rec?.abort())

  return { supported, listening, error, start, stop, toggle }
}
