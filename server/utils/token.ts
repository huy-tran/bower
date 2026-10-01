import { timingSafeEqual } from 'node:crypto'
import type { Browser } from 'puppeteer'

// The desktop app starts the server with a random BOWER_TOKEN and gives its window the token as a
// cookie, so other programs and web pages on this computer cannot drive the server (it can run
// Claude and write files). Without BOWER_TOKEN (`npm run dev`) nothing is checked.
export const TOKEN = process.env.BOWER_TOKEN || ''
export const TOKEN_COOKIE = 'bower_token'
export const TOKEN_HEADER = 'x-bower-token'

export function tokenMatches(value: string | undefined) {
  if (!TOKEN || !value) return false
  const a = Buffer.from(value), b = Buffer.from(TOKEN)
  return a.length === b.length && timingSafeEqual(a, b)
}

// Puppeteer's Chrome loads the editor's own pages (frames, the player), so it needs the cookie too.
export async function authorizeBrowser(browser: Browser, origin: string) {
  if (!TOKEN) return
  await browser.setCookie({ name: TOKEN_COOKIE, value: TOKEN, domain: new URL(origin).hostname, path: '/', httpOnly: true, sameSite: 'Strict' })
}
