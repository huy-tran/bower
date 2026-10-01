const { join } = require('node:path')

// Keep Puppeteer's Chrome inside the repo (not ~/.cache) so the desktop build can ship it.
// Bower only launches full Chrome (headless: true is Chrome's new headless mode), so the
// separate headless shell is not needed.
module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
  'chrome-headless-shell': { skipDownload: true }
}
