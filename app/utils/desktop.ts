// What the desktop app (electron/preload.cjs) offers the page. Undefined in a normal browser.
export interface DesktopUpdateInfo {
  version: string
  state: 'downloading' | 'ready'
  // This version's release notes, as plain text.
  notes?: string
}

// The answer to Check for updates. 'unavailable': not an installed copy (a dev run), so it cannot update itself.
export type DesktopUpdateCheck =
  | { status: 'latest' | 'downloading' | 'ready', version: string }
  | { status: 'error', message: string }
  | { status: 'unavailable' }

interface BowerDesktop {
  pickFolder(title: string, initial?: string): Promise<string | null>
  updateState(): Promise<DesktopUpdateInfo | null>
  onUpdate(cb: (update: DesktopUpdateInfo | null) => void): () => void
  // Older desktop builds lack this.
  checkForUpdate?(): Promise<DesktopUpdateCheck | null>
  installUpdate(): Promise<void>
  // The hidden native title bar: the page draws a draggable strip this tall at the top.
  titleBar?: { height: number, platform: string }
  setTitleBarColors?(color: string, symbolColor: string): Promise<void>
}

export function bowerDesktop(): BowerDesktop | undefined {
  return import.meta.client ? (window as any).bowerDesktop : undefined
}
