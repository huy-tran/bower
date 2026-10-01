import { join } from 'node:path'
import { DUCK_RAMP } from '#shared/utils/timeline'
import type { Project } from './store'

// ffmpeg inputs and filter graph for the project's sound over [rangeStart, rangeStart + dur) of the video.
// Input index 0 is reserved for the video; audio inputs start at 1. Mirrors musicGainAt() in shared/utils/timeline.
export function audioMix(p: Project, dir: string, rangeStart: number, dur: number, total: number) {
  const inputs: string[] = []
  const chains: string[] = []
  const labels: string[] = []
  let idx = 1
  const T = `(t*1000+${rangeStart})`

  if (p.audio?.file) {
    const a = p.audio
    inputs.push('-ss', (((a.startOffset || 0) + rangeStart) / 1000).toFixed(3), '-i', join(dir, 'audio', a.file))
    const terms = [`${a.gain ?? 1}`]
    if (a.fadeIn) terms.push(`min(1,max(0,${T}/${a.fadeIn}))`)
    if (a.fadeOut) terms.push(`min(1,max(0,(${total}-${T})/${a.fadeOut}))`)
    const duck = a.duck ?? 1
    const voices = p.clips.filter(c => c.kind === 'voice' && c.duration > 0)
    if (duck < 1 && voices.length) {
      const r = DUCK_RAMP
      const ws = voices.map(c => `min(min(1,max(0,(${T}-${c.start - r})/${r})),min(1,max(0,(${c.start + c.duration + r}-${T})/${r})))`)
      const w = ws.reduce((acc, x) => `max(${acc},${x})`)
      terms.push(`(1-${(1 - duck).toFixed(3)}*${w})`)
    }
    chains.push(`[${idx}:a]volume='${terms.join('*')}':eval=frame[m]`)
    labels.push('[m]')
    idx++
  }

  for (const c of p.clips) {
    const off = c.start - rangeStart
    if (off >= dur || (c.duration && off + c.duration <= 0)) continue
    inputs.push('-i', join(dir, 'audio', c.file))
    const label = `[c${idx}]`
    chains.push(off >= 0
      ? `[${idx}:a]adelay=${Math.round(off)}:all=1,volume=${c.gain}${label}`
      : `[${idx}:a]atrim=start=${(-off / 1000).toFixed(3)},asetpts=PTS-STARTPTS,volume=${c.gain}${label}`)
    labels.push(label)
    idx++
  }

  if (!labels.length) return null
  const secs = (dur / 1000).toFixed(3)
  const tail = `atrim=0:${secs},apad=whole_dur=${secs},afade=t=out:st=${Math.max(0, dur / 1000 - 0.25).toFixed(3)}:d=0.25,aformat=channel_layouts=stereo[aout]`
  const mixed = labels.length > 1 ? `${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest,${tail}` : `${labels[0]}${tail}`
  return { inputs, filter: [...chains, mixed].join(';') }
}
