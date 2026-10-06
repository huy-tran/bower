import { promises as fs } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { isModel } from './models'
import { STORAGE } from './paths'

// Bower's own settings for this computer, shared by every project: where Claude Code is, the model chats use
// by default, and what new projects start with. Kept next to the projects, never exported with one.
export const SETTINGS_FILE = resolve(STORAGE, '..', 'settings.json')

export type AppModeSetting = 'shots' | 'rebuild' | 'auto'
export interface NewProjectDefaults { width: number, height: number, fps: number, visualChecks: boolean, appMode: AppModeSetting, voice: string }
// Keyboard shortcuts people can change (app/composables/useHotkeys.ts). Written like "shift+space" or "v".
export type HotkeyAction = 'playPause' | 'toggleScope' | 'playFromStart'
export type Hotkeys = Record<HotkeyAction, string>
export const HOTKEYS: Hotkeys = { playPause: 'space', toggleScope: 'v', playFromStart: 'shift+space' }
const COMBO = /^(ctrl\+)?(alt\+)?(shift\+)?(meta\+)?([a-z0-9]|space|enter|tab|backspace|delete|insert|home|end|pageup|pagedown|arrow(up|down|left|right)|f([1-9]|1[0-2])|[,./;'[\]\\`=-])$/

export interface BowerSettings { claudePath?: string, model?: string, defaults: NewProjectDefaults, hotkeys: Hotkeys }

export const DEFAULTS: NewProjectDefaults = { width: 1920, height: 1080, fps: 30, visualChecks: true, appMode: 'shots', voice: 'af_heart' }
const VOICES = ['af_heart', 'af_sarah', 'bm_fable']
const SIZES = [[1920, 1080], [1080, 1920], [1080, 1080], [1080, 1350]]

async function readRaw(): Promise<Record<string, any>> {
  try { return JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf8')) } catch { return {} }
}

export async function readSettings(): Promise<BowerSettings> {
  const raw = await readRaw()
  return { ...raw, defaults: { ...DEFAULTS, ...raw.defaults }, hotkeys: { ...HOTKEYS, ...raw.hotkeys } }
}

// Validates each key; unknown keys and bad values are dropped. An empty string or null removes a setting.
export async function patchSettings(patch: Partial<{ claudePath: string | null, model: string | null, defaults: Partial<NewProjectDefaults>, hotkeys: Partial<Record<HotkeyAction, string | null>> }>) {
  const next = await readRaw()
  if (patch.claudePath !== undefined) next.claudePath = patch.claudePath || undefined
  if (patch.model !== undefined) next.model = isModel(patch.model) ? patch.model : undefined
  if (patch.defaults) {
    const d = { ...DEFAULTS, ...next.defaults }
    const p = patch.defaults
    if (p.width !== undefined && p.height !== undefined && SIZES.some(([w, h]) => w === Number(p.width) && h === Number(p.height))) { d.width = Number(p.width); d.height = Number(p.height) }
    if (p.fps !== undefined && [24, 25, 30, 60].includes(Number(p.fps))) d.fps = Number(p.fps)
    if (typeof p.visualChecks === 'boolean') d.visualChecks = p.visualChecks
    if (p.appMode && ['shots', 'rebuild', 'auto'].includes(p.appMode)) d.appMode = p.appMode
    if (p.voice && VOICES.includes(p.voice)) d.voice = p.voice
    next.defaults = d
  }
  if (patch.hotkeys) {
    // null puts an action back on its default. Two actions can never share keys.
    const h: Hotkeys = { ...HOTKEYS, ...next.hotkeys }
    for (const [action, combo] of Object.entries(patch.hotkeys) as [HotkeyAction, string | null][]) {
      if (!(action in HOTKEYS)) continue
      const value = combo === null ? HOTKEYS[action] : String(combo).toLowerCase().trim()
      if (!COMBO.test(value)) throw createError({ statusCode: 422, message: `"${combo}" is not a key Bower can use` })
      h[action] = value
    }
    const used = Object.values(h)
    if (new Set(used).size !== used.length) throw createError({ statusCode: 422, message: 'Two shortcuts cannot use the same keys' })
    next.hotkeys = Object.fromEntries(Object.entries(h).filter(([a, v]) => v !== HOTKEYS[a as HotkeyAction]))
    if (!Object.keys(next.hotkeys).length) next.hotkeys = undefined
  }
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]
  await fs.mkdir(dirname(SETTINGS_FILE), { recursive: true })
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2))
  return readSettings()
}
