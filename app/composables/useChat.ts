export interface ChatMessage {
  role: 'user' | 'assistant' | 'error'
  text: string
  at: string
  durationMs?: number
  costUsd?: number
  attachments?: string[]
  model?: string
}
export interface ChatJob { status: 'running' | 'done' | 'error', prompt: string, startedAt: number, activity: string[], partial: string }
// `task: 'build'` marks a whole-scene build (storyboard), which uses the project's model for building.
export interface SendOptions { model?: string, task?: 'chat' | 'build', attachments?: string[], at?: number }
interface Thread { messages: ChatMessage[], job: ChatJob | null, loaded: boolean }

const threads = reactive(new Map<string, Thread>())
const timers = new Map<string, ReturnType<typeof setTimeout>>()

const tkey = (pid: string, key: string) => `${pid}:${key}`

function thread(pid: string, key: string): Thread {
  const k = tkey(pid, key)
  if (!threads.has(k)) threads.set(k, { messages: [], job: null, loaded: false })
  return threads.get(k)!
}

async function load(pid: string, key: string) {
  const t = thread(pid, key)
  const res = await $fetch<{ messages: ChatMessage[], job: ChatJob | null }>(`/api/projects/${pid}/chat/${key}`)
  const wasRunning = t.job?.status === 'running'
  t.messages = res.messages
  t.job = res.job
  t.loaded = true
  if (res.job?.status === 'running') schedule(pid, key)
  else if (wasRunning) await useEditor().refresh()
}

// Poll quickly while Claude writes so the streamed reply feels live.
function schedule(pid: string, key: string) {
  const k = tkey(pid, key)
  clearTimeout(timers.get(k))
  timers.set(k, setTimeout(() => load(pid, key).catch(() => schedule(pid, key)), 600))
}

async function send(pid: string, key: string, message: string, opts: SendOptions = {}) {
  const t = thread(pid, key)
  t.messages.push({ role: 'user', text: message, at: new Date().toISOString(), attachments: opts.attachments })
  const res = await $fetch<{ job: ChatJob }>(`/api/projects/${pid}/chat/${key}`, { method: 'POST', body: { message, ...opts } })
  t.job = res.job
  schedule(pid, key)
}

async function clear(pid: string, key: string) {
  await $fetch(`/api/projects/${pid}/chat/${key}`, { method: 'DELETE' })
  const t = thread(pid, key)
  t.messages = []
}

// The next message starts a new Claude session (cheaper: no earlier conversation is sent); messages stay.
async function freshSession(pid: string, key: string) {
  await $fetch(`/api/projects/${pid}/chat/${key}?session=1`, { method: 'DELETE' })
}

async function cancel(pid: string, key: string) {
  await $fetch(`/api/projects/${pid}/chat/${key}?cancel=1`, { method: 'DELETE' })
}

function isBusy(pid: string, key: string) {
  return threads.get(tkey(pid, key))?.job?.status === 'running'
}

// Attachments queued from elsewhere (for example an app screenshot from the settings); the chat panel picks them up.
const queuedAttachments = ref<{ path: string, url: string, name: string }[]>([])
function queueAttachment(a: { path: string, url: string, name: string }) {
  if (!queuedAttachments.value.some(x => x.path === a.path)) queuedAttachments.value = [...queuedAttachments.value, a]
}

export function useChat() {
  return { thread, load, send, clear, freshSession, cancel, isBusy, queuedAttachments, queueAttachment }
}
