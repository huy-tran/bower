// Keyboard shortcuts people can change in Bower settings (saved for this computer, so the browser and the desktop app
// agree), plus the fixed ones, which the settings list for reference and new shortcuts may not clash with.
export type HotkeyAction = 'playPause' | 'toggleScope' | 'playFromStart'
export const HOTKEY_DEFAULTS: Record<HotkeyAction, string> = { playPause: 'space', toggleScope: 'v', playFromStart: 'shift+space' }
export const HOTKEY_LABELS: Record<HotkeyAction, { label: string, description: string }> = {
  playPause: { label: 'Play / Pause', description: 'Start or stop playback where the playhead is.' },
  toggleScope: { label: 'This scene / Whole video', description: 'Switch between playing the selected scene and the whole video.' },
  playFromStart: { label: 'Play from the start', description: 'Jump to the start of the scene (or the video, or the loop) and play.' }
}
// Fixed shortcuts: the editor's own keys and the command palette.
export const FIXED_HOTKEYS: { combo: string, label: string }[] = [
  { combo: 'ctrl+k', label: 'Command palette' },
  { combo: 'arrowleft', label: 'Back one frame' },
  { combo: 'arrowright', label: 'Forward one frame' },
  { combo: 'shift+arrowleft', label: 'Back one second' },
  { combo: 'shift+arrowright', label: 'Forward one second' },
  { combo: 'arrowup', label: 'Previous scene' },
  { combo: 'arrowdown', label: 'Next scene' },
  { combo: 'home', label: 'Go to the start' },
  { combo: 'i', label: 'Loop from here' },
  { combo: 'o', label: 'Loop to here' },
  { combo: 'l', label: 'Clear the loop' },
  { combo: '=', label: 'Zoom the timeline in' },
  { combo: '-', label: 'Zoom the timeline out' },
  { combo: '0', label: 'Fit the timeline' }
]

const keys = reactive<Record<HotkeyAction, string>>({ ...HOTKEY_DEFAULTS })
let loaded: Promise<void> | null = null

// "shift+space", "ctrl+alt+p", "v": modifiers in a fixed order, then the key, all lower case.
export function comboOf(e: KeyboardEvent) {
  const key = e.key === ' ' ? 'space' : e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase()
  if (['control', 'alt', 'shift', 'meta', 'os'].includes(key)) return null
  // Shift turns "=" into "+", "1" into "!" and so on: use the unshifted key when Shift is part of the combo.
  const base = e.shiftKey && e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : e.shiftKey && e.code.startsWith('Digit') ? e.code.slice(5) : key
  return [e.ctrlKey && 'ctrl', e.altKey && 'alt', e.shiftKey && 'shift', e.metaKey && 'meta', base].filter(Boolean).join('+')
}

// For <UKbd>/kbds: ["shift", "space"], ["ctrl", "K"].
export function kbdsOf(combo: string) {
  return combo.split('+').map(k => ['ctrl', 'alt', 'shift', 'meta', 'space', 'enter', 'tab', 'home', 'end', 'delete', 'backspace', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'pageup', 'pagedown'].includes(k) ? k : k.toUpperCase())
}

export function useHotkeys() {
  if (!loaded) {
    loaded = $fetch<{ hotkeys?: Record<HotkeyAction, string> }>('/api/settings').then((s) => { Object.assign(keys, HOTKEY_DEFAULTS, s.hotkeys) }).catch(() => {})
  }
  const toast = useToast()
  // What a combo would clash with, other than the action being changed.
  function clash(action: HotkeyAction, combo: string) {
    const fixed = FIXED_HOTKEYS.find(f => f.combo === combo || (combo === 'meta+k' && f.combo === 'ctrl+k'))
    if (fixed) return fixed.label
    const other = (Object.keys(keys) as HotkeyAction[]).find(a => a !== action && keys[a] === combo)
    return other ? HOTKEY_LABELS[other].label : null
  }
  async function set(action: HotkeyAction, combo: string | null) {
    try {
      const s = await $fetch<{ hotkeys: Record<HotkeyAction, string> }>('/api/settings', { method: 'PATCH', body: { hotkeys: { [action]: combo } } })
      Object.assign(keys, s.hotkeys)
      return true
    } catch (e: any) {
      toast.add({ title: 'Could not change the shortcut', description: e?.data?.message || e?.message, color: 'error' })
      return false
    }
  }
  const is = (e: KeyboardEvent, action: HotkeyAction) => comboOf(e) === keys[action]
  return { keys: readonly(keys), is, set, clash }
}
