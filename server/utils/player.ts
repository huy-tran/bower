import { promises as fs } from 'node:fs'
import { extname, join } from 'node:path'
import { captionAt, layersAt, musicGainAt } from '#shared/utils/timeline'
import { buildFrame, inlineAssets } from './frame'
import { loadProject, projectDir, readScene, sceneViews } from './store'

const AUDIO_MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.webm': 'audio/webm'
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c')

async function dataUri(file: string) {
  const data = await fs.readFile(file)
  return `data:${AUDIO_MIME[extname(file).toLowerCase()] || 'audio/mpeg'};base64,${data.toString('base64')}`
}

export interface PlayerOptions {
  // Render mode: no controls or audio, fills the viewport, exposes window.__ready and window.__render(t).
  render?: boolean
  transparent?: boolean
  // Global time range to include (render of a single scene); defaults to the whole video.
  sceneIds?: string[]
}

// A single self-contained HTML page that plays the whole video, including transitions, captions and every
// sound. It is the downloadable web player and, in render mode, the page the MP4/GIF/ProRes exporter films.
export async function buildPlayer(pid: string, opts: PlayerOptions = {}) {
  const p = await loadProject(pid)
  const views = await sceneViews(p)
  const scenes = await Promise.all(views.map(async s => ({
    id: s.id, title: s.title, start: s.start, duration: s.duration, transition: s.transition,
    doc: await buildFrame(p, s, await inlineAssets(p, await readScene(pid, s.id)), { transparent: opts.transparent })
  })))
  const total = views.reduce((a, s) => a + s.duration, 0)

  let audio: Record<string, unknown> | null = null
  const clips: Record<string, unknown>[] = []
  if (!opts.render) {
    if (p.audio?.file) {
      try {
        audio = {
          src: await dataUri(join(projectDir(pid), 'audio', p.audio.file)),
          offset: p.audio.startOffset || 0, gain: p.audio.gain ?? 1, fadeIn: p.audio.fadeIn ?? 0, fadeOut: p.audio.fadeOut ?? 0, duck: p.audio.duck ?? 1
        }
      } catch {}
    }
    for (const c of p.clips) {
      try { clips.push({ kind: c.kind, start: c.start, duration: c.duration, gain: c.gain, src: await dataUri(join(projectDir(pid), 'audio', c.file)) }) } catch {}
    }
  }
  const captionClips = p.clips.filter(c => c.captions?.length).map(c => ({ start: c.start, captions: c.captions }))
  const cap = { on: p.captions.burnIn && captionClips.length > 0, top: p.captions.position === 'top', size: p.captions.size, clips: captionClips }
  const bg = opts.transparent ? 'transparent' : '#000'

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.name)}</title>
<style>
  :root { color-scheme: ${opts.transparent ? "normal" : "dark"}; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: ${bg}; color: #fff; font: 14px/1.4 Inter, system-ui, -apple-system, sans-serif; overflow: hidden; }
  #wrap { position: fixed; inset: 0; display: grid; place-items: center; }
  #stage { position: relative; width: min(100vw, calc(100vh * ${p.width} / ${p.height})); aspect-ratio: ${p.width} / ${p.height}; background: ${opts.transparent ? 'transparent' : '#fff'}; overflow: hidden; }
  body.render #stage { width: 100vw; height: 100vh; aspect-ratio: auto; }
  #stage iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; visibility: hidden; pointer-events: none; background: transparent; }
  #cap { position: absolute; left: 6%; right: 6%; display: none; justify-content: center; pointer-events: none; z-index: 10; }
  #cap span { background: rgba(0,0,0,.72); color: #fff; font-weight: 600; line-height: 1.3; text-align: center; padding: .3em .65em; border-radius: .35em; }
  #big { position: absolute; inset: 0; margin: auto; width: 88px; height: 88px; border-radius: 50%; border: 0; background: rgba(10,10,10,.82); color: #fff; cursor: pointer; z-index: 20;
    display: grid; place-items: center; box-shadow: 0 10px 40px rgba(0,0,0,.3); transition: transform .15s, opacity .2s; }
  #big:hover { transform: scale(1.06); }
  #big svg { width: 34px; height: 34px; margin-left: 5px; }
  body.playing #big, body.render #big, body.render #bar { display: none; }
  #bar { position: fixed; left: 0; right: 0; bottom: 0; padding: 28px 20px 14px; display: flex; align-items: center; gap: 14px; z-index: 30;
    background: linear-gradient(transparent, rgba(0,0,0,.65)); transition: opacity .3s; }
  body.idle.playing #bar { opacity: 0; }
  body.idle.playing { cursor: none; }
  #bar button { background: none; border: 0; color: #fff; cursor: pointer; padding: 4px; display: grid; place-items: center; opacity: .9; font: 700 12px/1 Inter, sans-serif; }
  #bar button:hover { opacity: 1; }
  #bar button.off { opacity: .45; }
  #bar svg { width: 22px; height: 22px; }
  #track { position: relative; flex: 1; height: 18px; cursor: pointer; touch-action: none; }
  #track::before { content: ""; position: absolute; left: 0; right: 0; top: 7px; height: 4px; border-radius: 2px; background: rgba(255,255,255,.25); }
  #fill { position: absolute; left: 0; top: 7px; height: 4px; border-radius: 2px; background: #fff; }
  #knob { position: absolute; top: 3px; width: 12px; height: 12px; margin-left: -6px; border-radius: 50%; background: #fff; }
  .cut { position: absolute; top: 5px; width: 2px; height: 8px; margin-left: -1px; background: rgba(0,0,0,.55); }
  #time { font-variant-numeric: tabular-nums; font-size: 13px; opacity: .85; min-width: 92px; text-align: right; }
  #title { font-weight: 600; font-size: 13px; opacity: .85; max-width: 30vw; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  @media (max-width: 640px) { #title { display: none; } #bar { padding: 24px 12px 10px; gap: 8px; } }
</style>
</head>
<body class="${opts.render ? 'render' : ''}">
<div id="wrap"><div id="stage">
  <div id="cap"><span></span></div>
  <button id="big" aria-label="Play"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg></button>
</div></div>
<div id="bar">
  <button id="pp" aria-label="Play"></button>
  <span id="title">${esc(p.name)}</span>
  <div id="track"><div id="fill"></div><div id="knob"></div></div>
  <span id="time"></span>
  <button id="cc" aria-label="Captions" title="Captions">CC</button>
  <button id="fs" aria-label="Fullscreen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
</div>
<script>
(function () {
  var layersAt = ${layersAt.toString()};
  var musicGainAt = ${musicGainAt.toString()};
  var captionAt = ${captionAt.toString()};
  var SCENES = ${json(scenes)};
  var TOTAL = ${total};
  var W = ${p.width};
  var AUDIO = ${json(audio)};
  var CLIPS = ${json(clips)};
  var CAP = ${json(cap)};
  var RENDER = ${opts.render ? 'true' : 'false'};
  var PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>';
  var PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>';

  var stage = document.getElementById('stage'), pp = document.getElementById('pp'), big = document.getElementById('big');
  var track = document.getElementById('track'), fill = document.getElementById('fill'), knob = document.getElementById('knob');
  var timeEl = document.getElementById('time'), capEl = document.getElementById('cap'), capText = capEl.firstChild, ccBtn = document.getElementById('cc');
  var music = AUDIO ? new Audio(AUDIO.src) : null;
  if (music) music.preload = 'auto';
  var clipEls = CLIPS.map(function (c) { var a = new Audio(c.src); a.preload = 'auto'; return a; });
  var showCaps = CAP.on;
  if (!CAP.clips.length) ccBtn.style.display = 'none';
  ccBtn.classList.toggle('off', !showCaps);

  var readyCount = 0, resolveReady;
  window.__ready = new Promise(function (r) { resolveReady = r; });
  var frames = SCENES.map(function (s) {
    var f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts');
    f.setAttribute('title', s.title);
    f.srcdoc = s.doc;
    stage.insertBefore(f, capEl);
    return f;
  });
  SCENES.slice(1).forEach(function (s) {
    var c = document.createElement('div');
    c.className = 'cut';
    c.style.left = (s.start / TOTAL * 100) + '%';
    track.appendChild(c);
  });

  var t = 0, playing = false, last = 0, seekId = 0, pending = {};

  function fmt(ms) { var s = Math.max(0, ms) / 1000; return Math.floor(s / 60) + ':' + ('0' + (s % 60).toFixed(1)).slice(-4); }

  // Show the layers for time t and ask each visible scene to draw its frame. Resolves when all have painted.
  function show() {
    var layers = layersAt(SCENES, t);
    var visible = {};
    var waits = [];
    layers.forEach(function (l) {
      var f = frames[l.index];
      visible[l.index] = true;
      f.style.visibility = 'visible';
      f.style.opacity = l.opacity;
      f.style.transform = l.transform;
      f.style.clipPath = l.clip;
      f.style.filter = l.filter;
      f.style.zIndex = l.z;
      var id = ++seekId;
      // While rendering, a scene that cannot draw its frame (a video clip that will not seek, say) fails the render
      // rather than letting a stale frame through. In the player, a slow scene just shows what it has.
      waits.push(new Promise(function (res, rej) {
        pending[id] = { res: res, rej: rej };
        setTimeout(function () { if (!pending[id]) return; delete pending[id]; RENDER ? rej(new Error('A scene did not draw its frame within 20 seconds')) : res(); }, RENDER ? 20000 : 3000);
      }));
      f.contentWindow.postMessage({ __ve: true, type: 'seek', t: l.t, id: id }, '*');
    });
    frames.forEach(function (f, i) { if (!visible[i]) f.style.visibility = 'hidden'; });

    var line = showCaps ? captionAt(CAP.clips, t) : '';
    capEl.style.display = line ? 'flex' : 'none';
    capText.textContent = line;
    capEl.style.fontSize = (CAP.size * stage.clientWidth / W) + 'px';
    capEl.style.top = CAP.top ? '6%' : 'auto';
    capEl.style.bottom = CAP.top ? 'auto' : '7%';

    var pct = TOTAL ? t / TOTAL * 100 : 0;
    fill.style.width = pct + '%';
    knob.style.left = pct + '%';
    timeEl.textContent = fmt(t) + ' / ' + fmt(TOTAL);
    return Promise.all(waits);
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || !d.__ve) return;
    if (d.type === 'seeked' && pending[d.id]) {
      var wait = pending[d.id];
      delete pending[d.id];
      if (d.error && RENDER) wait.rej(new Error(d.error)); else wait.res();
    }
    if (d.type === 'ready') {
      readyCount++;
      if (readyCount === frames.length) resolveReady(true);
      show();
    }
  });
  window.__render = function (ms) { t = ms; return show(); };

  function syncAudio() {
    if (music) {
      music.volume = Math.min(1, Math.max(0, musicGainAt(AUDIO, CLIPS, TOTAL, t)));
      var mt = (AUDIO.offset + t) / 1000;
      if (Math.abs(music.currentTime - mt) > 0.15) music.currentTime = mt;
      if (playing && music.paused) music.play().catch(function () {});
    }
    CLIPS.forEach(function (c, i) {
      var a = clipEls[i];
      var inside = t >= c.start && t < c.start + (c.duration || 1e9);
      if (playing && inside) {
        var ct = (t - c.start) / 1000;
        if (a.paused || Math.abs(a.currentTime - ct) > 0.15) a.currentTime = ct;
        a.volume = Math.min(1, c.gain);
        if (a.paused) a.play().catch(function () {});
      } else if (!a.paused) a.pause();
    });
  }

  function tick(now) {
    if (!playing) return;
    if (music && !music.paused && !music.ended) t = music.currentTime * 1000 - AUDIO.offset;
    else t += now - last;
    last = now;
    if (t >= TOTAL) { t = TOTAL; show(); pause(); return; }
    show();
    syncAudio();
    requestAnimationFrame(tick);
  }

  function play() {
    if (playing) return;
    if (t >= TOTAL - 1) t = 0;
    playing = true;
    document.body.classList.add('playing');
    pp.innerHTML = PAUSE;
    last = performance.now();
    if (music) music.currentTime = (AUDIO.offset + t) / 1000;
    syncAudio();
    requestAnimationFrame(tick);
  }
  function pause() {
    playing = false;
    document.body.classList.remove('playing');
    pp.innerHTML = PLAY;
    if (music) music.pause();
    clipEls.forEach(function (a) { a.pause(); });
  }
  function toggle() { playing ? pause() : play(); }
  function seek(ms) { t = Math.max(0, Math.min(TOTAL, ms)); if (music) music.currentTime = (AUDIO.offset + t) / 1000; show(); if (playing) syncAudio(); }

  if (!RENDER) {
    var dragging = false, resume = false;
    var at = function (e) { var r = track.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * TOTAL; };
    track.addEventListener('pointerdown', function (e) { dragging = true; resume = playing; pause(); track.setPointerCapture(e.pointerId); seek(at(e)); });
    track.addEventListener('pointermove', function (e) { if (dragging) seek(at(e)); });
    track.addEventListener('pointerup', function () { dragging = false; if (resume) play(); });

    pp.addEventListener('click', toggle);
    stage.addEventListener('click', function (e) { if (e.target === stage) toggle(); });
    ccBtn.addEventListener('click', function () { showCaps = !showCaps; ccBtn.classList.toggle('off', !showCaps); show(); });
    document.getElementById('fs').addEventListener('click', function () {
      document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(function () {});
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowRight') seek(t + (e.shiftKey ? 1000 : 5000));
      else if (e.key === 'ArrowLeft') seek(t - (e.shiftKey ? 1000 : 5000));
      else if (e.key === 'f') document.getElementById('fs').click();
      else if (e.key === 'c') ccBtn.click();
      else if (e.key === 'Home') seek(0);
    });
    window.addEventListener('resize', show);

    var idle;
    var wake = function () { document.body.classList.remove('idle'); clearTimeout(idle); idle = setTimeout(function () { document.body.classList.add('idle'); }, 2000); };
    document.addEventListener('mousemove', wake);
    document.addEventListener('touchstart', wake);
    wake();

    // Open on a representative frame rather than the (often blank) first one; Play starts from the top.
    pp.innerHTML = PLAY;
    t = SCENES.length ? Math.min(SCENES[0].duration * 0.6, TOTAL) : 0;
    var poster = t;
    big.addEventListener('click', function () { if (t === poster) t = 0; play(); });
  }
  show();
})();
</script>
</body>
</html>`
}
