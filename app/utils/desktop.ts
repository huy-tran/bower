// What the desktop app (electron/preload.cjs) offers the page. Undefined in a normal browser.
interface BowerDesktop {
  pickFolder(title: string, initial?: string): Promise<string | null>
}

export function bowerDesktop(): BowerDesktop | undefined {
  return import.meta.client ? (window as any).bowerDesktop : undefined
}
