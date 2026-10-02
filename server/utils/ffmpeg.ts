import { spawn } from 'node:child_process'
import ffmpegPath from 'ffmpeg-static'

// The ffmpeg bundled with Bower (ffmpeg-static, shipped inside the desktop app too).
export const FFMPEG = ffmpegPath as unknown as string

// Runs ffmpeg to completion. Resolves with its stderr (where it reports progress and stream details) and rejects
// with the error text. `quiet` keeps the log to errors only.
export function runFfmpeg(args: string[], quiet = true) {
  return new Promise<string>((resolve, reject) => {
    const proc = spawn(FFMPEG, ['-y', '-hide_banner', '-loglevel', quiet ? 'error' : 'info', ...args], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    let err = ''
    proc.stderr.on('data', (d) => { err += d.toString() })
    proc.on('error', reject)
    proc.on('close', code => code === 0 ? resolve(err) : reject(new Error(`ffmpeg: ${err.trim().split('\n').slice(-3).join(' ') || `exit ${code}`}`)))
  })
}
