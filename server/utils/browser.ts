import puppeteer, { type Browser } from 'puppeteer'

// One headless Chrome shared by snapshots and seam checks, closed after a minute of idling.
let browser: Promise<Browser> | null = null
let idle: ReturnType<typeof setTimeout> | null = null
let users = 0

export const CHROME_ARGS = ['--hide-scrollbars', '--mute-audio', '--force-color-profile=srgb', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows']

export async function withBrowser<T>(fn: (b: Browser) => Promise<T>): Promise<T> {
  if (idle) clearTimeout(idle)
  browser ??= puppeteer.launch({ headless: true, args: CHROME_ARGS })
  users++
  try {
    return await fn(await browser)
  } finally {
    users--
    if (!users) {
      idle = setTimeout(async () => {
        const b = browser
        browser = null
        await (await b)?.close().catch(() => {})
      }, 60_000)
    }
  }
}
