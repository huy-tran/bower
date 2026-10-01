// What the desktop app (electron/preload.cjs) offers the page. Undefined in a normal browser.
export interface DesktopUpdate {
  version: string
  state: 'downloading' | 'ready'
}

interface BowerDesktop {
  pickFolder(title: string, initial?: string): Promise<string | null>
  updateState(): Promise<DesktopUpdate | null>
  onUpdate(cb: (update: DesktopUpdate | null) => void): () => void
  installUpdate(): Promise<void>
}

export function bowerDesktop(): BowerDesktop | undefined {
  return import.meta.client ? (window as any).bowerDesktop : undefined
}
