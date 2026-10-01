// Offline music analysis: tempo, beat grid, downbeats (bar starts) and phrase starts (8-bar sections).
// All returned times are in track milliseconds.

export interface BeatAnalysis {
  duration: number
  bpm: number
  beats: number[]
  downbeats: number[]
  phrases: number[]
  peaks: number[]
}

const SR = 22050
const WIN = 1024
const HOP = 256

function fft(re: Float32Array, im: Float32Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!]
      ;[im[i], im[j]] = [im[j]!, im[i]!]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len
    const wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2
        const tr = re[b]! * cr - im[b]! * ci, ti = re[b]! * ci + im[b]! * cr
        re[b] = re[a]! - tr; im[b] = im[a]! - ti
        re[a] = re[a]! + tr; im[a] = im[a]! + ti
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

async function decodeMono(buf: ArrayBuffer) {
  const probe = new OfflineAudioContext(1, 1, SR)
  const decoded = await probe.decodeAudioData(buf.slice(0))
  const ctx = new OfflineAudioContext(1, Math.ceil(decoded.duration * SR), SR)
  const src = ctx.createBufferSource()
  src.buffer = decoded
  src.connect(ctx.destination)
  src.start()
  const out = await ctx.startRendering()
  return { samples: out.getChannelData(0), duration: decoded.duration }
}

// Subtract a local moving average and half-wave rectify, which leaves only sharp rises.
function whiten(env: Float32Array, radius: number) {
  const out = new Float32Array(env.length)
  let sum = 0
  const q: number[] = []
  for (let i = 0; i < env.length + radius; i++) {
    if (i < env.length) { sum += env[i]!; q.push(env[i]!) }
    if (q.length > radius * 2 + 1) sum -= q.shift()!
    const c = i - radius
    if (c >= 0 && c < env.length) out[c] = Math.max(0, env[c]! - sum / q.length)
  }
  return out
}

export async function analyzeAudio(buf: ArrayBuffer, onProgress?: (p: number) => void): Promise<BeatAnalysis> {
  const { samples, duration } = await decodeMono(buf)
  const frames = Math.max(1, Math.floor((samples.length - WIN) / HOP))
  const full = new Float32Array(frames)
  const low = new Float32Array(frames)
  const rms = new Float32Array(frames)
  const window = new Float32Array(WIN).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (WIN - 1)))
  const re = new Float32Array(WIN), im = new Float32Array(WIN)
  const bins = WIN / 2
  let prev = new Float32Array(bins)
  const lowBins = Math.ceil(160 / (SR / WIN))

  for (let f = 0; f < frames; f++) {
    const off = f * HOP
    let e = 0
    for (let i = 0; i < WIN; i++) {
      const s = samples[off + i]!
      e += s * s
      re[i] = s * window[i]!
      im[i] = 0
    }
    rms[f] = Math.sqrt(e / WIN)
    fft(re, im)
    const mag = new Float32Array(bins)
    let flux = 0, lowFlux = 0
    for (let k = 1; k < bins; k++) {
      mag[k] = Math.log1p(100 * Math.hypot(re[k]!, im[k]!))
      const d = mag[k]! - prev[k]!
      if (d > 0) { flux += d; if (k <= lowBins) lowFlux += d }
    }
    full[f] = flux
    low[f] = lowFlux
    prev = mag
    if (onProgress && f % 2000 === 0) {
      onProgress(f / frames * 0.8)
      await new Promise(r => setTimeout(r))
    }
  }

  const fps = SR / HOP
  const onset = whiten(full, Math.round(fps * 0.25))
  const lowOnset = whiten(low, Math.round(fps * 0.25))

  // Tempo: autocorrelation over 70-180 BPM, weighted towards ~120 BPM to avoid octave errors.
  const minLag = Math.floor(fps * 60 / 180), maxLag = Math.ceil(fps * 60 / 70)
  const ac = new Float32Array(maxLag + 2)
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let s = 0
    for (let i = lag; i < frames; i++) s += onset[i]! * onset[i - lag]!
    ac[lag] = s / (frames - lag)
  }
  let bestLag = minLag, bestScore = -Infinity
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = 60 * fps / lag
    const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2))
    // Reward lags whose double also correlates (true beat periods repeat).
    const score = (ac[lag]! + 0.5 * (ac[lag * 2] ?? 0)) * w
    if (score > bestScore) { bestScore = score; bestLag = lag }
  }
  const a = ac[bestLag - 1]!, b = ac[bestLag]!, c = ac[bestLag + 1]!
  const shift = (a - 2 * b + c) === 0 ? 0 : 0.5 * (a - c) / (a - 2 * b + c)
  let period = bestLag + Math.max(-0.5, Math.min(0.5, shift))
  onProgress?.(0.85)

  // Phase: the grid offset that collects the most onset energy. Kicks usually sit on the beat while
  // hats sit between beats, so the low band is weighted in to avoid locking onto offbeats.
  const mean = (e: Float32Array) => e.reduce((s, v) => s + v, 0) / e.length || 1
  const mFull = mean(onset), mLow = mean(lowOnset)
  const phaseEnv = onset.map((v, i) => v / mFull + 2 * lowOnset[i]! / mLow)
  const gridScore = (phase: number, per: number, env: Float32Array) => {
    let s = 0
    for (let x = phase; x < frames; x += per) {
      const i = Math.round(x)
      s += Math.max(env[i - 1] ?? 0, env[i] ?? 0, env[i + 1] ?? 0)
    }
    return s
  }
  let phase = 0, best = -Infinity
  for (let ph = 0; ph < period; ph += 0.25) {
    const s = gridScore(ph, period, phaseEnv)
    if (s > best) { best = s; phase = ph }
  }

  // Refine tempo and phase with a least-squares fit to the nearest onset peak of each beat.
  const xs: number[] = [], ys: number[] = []
  for (let k = 0, x = phase; x < frames; k++, x += period) {
    const i = Math.round(x)
    let pi = i, pv = -1
    for (let j = i - 3; j <= i + 3; j++) if ((phaseEnv[j] ?? -1) > pv) { pv = phaseEnv[j]!; pi = j }
    if (pv > 0) { xs.push(k); ys.push(pi) }
  }
  if (xs.length > 8) {
    const n = xs.length
    const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n
    let num = 0, den = 0
    for (let i = 0; i < n; i++) { num += (xs[i]! - mx) * (ys[i]! - my); den += (xs[i]! - mx) ** 2 }
    const slope = num / den
    if (Math.abs(slope - period) < period * 0.03) {
      period = slope
      phase = my - slope * mx
      while (phase < 0) phase += period
      while (phase >= period) phase -= period
    }
  }

  const toMs = (frame: number) => Math.round(frame * HOP / SR * 1000 + WIN / 2 / SR * 1000)
  const beatFrames: number[] = []
  for (let x = phase; x < frames; x += period) beatFrames.push(x)
  const beats = beatFrames.map(toMs)

  // Downbeats: the bar alignment (1 of 4) whose beats carry the most low-end (kick) energy.
  let bar = 0, barBest = -Infinity
  for (let m = 0; m < 4; m++) {
    let s = 0
    for (let k = m; k < beatFrames.length; k += 4) {
      const i = Math.round(beatFrames[k]!)
      s += Math.max(lowOnset[i - 1] ?? 0, lowOnset[i] ?? 0, lowOnset[i + 1] ?? 0) + 0.3 * (onset[i] ?? 0)
    }
    if (s > barBest) { barBest = s; bar = m }
  }
  const downIdx: number[] = []
  for (let k = bar; k < beatFrames.length; k += 4) downIdx.push(k)
  const downbeats = downIdx.map(k => beats[k]!)

  // Phrases: 8-bar sections aligned to the bars where loudness changes most.
  const barEnergy = downIdx.map((k, j) => {
    const from = Math.round(beatFrames[k]!), to = Math.round(beatFrames[downIdx[j + 1] ?? beatFrames.length - 1] ?? frames)
    let s = 0
    for (let i = from; i < Math.max(from + 1, to); i++) s += rms[i] ?? 0
    return s / Math.max(1, to - from)
  })
  const novelty = barEnergy.map((e, j) => {
    const before = barEnergy.slice(Math.max(0, j - 4), j), after = barEnergy.slice(j, j + 4)
    const avg = (l: number[]) => l.length ? l.reduce((s, v) => s + v, 0) / l.length : e
    return Math.abs(avg(after) - avg(before))
  })
  let pOff = 0, pBest = -Infinity
  for (let q = 0; q < 8; q++) {
    let s = 0
    for (let j = q; j < novelty.length; j += 8) s += novelty[j]!
    if (s > pBest) { pBest = s; pOff = q }
  }
  const phrases: number[] = []
  for (let j = pOff; j < downbeats.length; j += 8) phrases.push(downbeats[j]!)

  // Waveform peaks for the timeline (roughly 20 per second).
  const peakCount = Math.min(6000, Math.max(200, Math.round(duration * 20)))
  const per = samples.length / peakCount
  const peaks: number[] = []
  let maxPeak = 1e-6
  for (let i = 0; i < peakCount; i++) {
    let m = 0
    const from = Math.floor(i * per), to = Math.floor((i + 1) * per)
    for (let j = from; j < to; j += 4) m = Math.max(m, Math.abs(samples[j]!))
    peaks.push(m)
    maxPeak = Math.max(maxPeak, m)
  }
  onProgress?.(1)

  return {
    duration: Math.round(duration * 1000),
    bpm: Math.round(60 * fps / period * 100) / 100,
    beats, downbeats, phrases,
    peaks: peaks.map(p => Math.round(p / maxPeak * 100) / 100)
  }
}
