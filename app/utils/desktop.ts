// What the desktop app (electron/preload.cjs) offers the page. Undefined in a normal browser.
export interface DesktopUpdateInfo {
  version: string
  state: 'downloading' | 'ready'
  // This version's release notes, as plain text.
  notes?: string
}

interface BowerDesktop {
  pickFolder(title: string, initial?: string): Promise<string | null>
  updateState(): Promise<DesktopUpdateInfo | null>
  onUpdate(cb: (update: DesktopUpdateInfo | null) => void): () => void
  installUpdate(): Promise<void>
  // The hidden native title bar: the page draws a draggable strip this tall at the top.
  titleBar?: { height: number, platform: string }
  setTitleBarColors?(color: string, symbolColor: string): Promise<void>
}

export function bowerDesktop(): BowerDesktop | undefined {
  return import.meta.client ? (window as any).bowerDesktop : undefined
}
