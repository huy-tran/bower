// Renders build/icon.svg to the 1024 px build/icon.png that electron-builder turns into the app icons.
import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer'

const svg = readFileSync(new URL('./icon.svg', import.meta.url), 'utf8')
const browser = await puppeteer.launch({ headless: true })
const page = await browser.newPage()
await page.setViewport({ width: 1024, height: 1024 })
await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:1024px;height:1024px}</style>${svg}`)
await page.screenshot({ path: new URL('./icon.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), omitBackground: true })
await browser.close()
