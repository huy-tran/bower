import { promises as fs } from 'node:fs'
import { extname, join } from 'node:path'
import { buildFrame, inlineAssets } from './frame'
import { loadProject, projectDir, readScene, sceneViews } from './store'

const AUDIO_MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac'
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c')

// A single self-contained HTML file that plays the whole video in any browser, no server needed.
export async function buildPlayer(pid: string) {
  const p = await loadProject(pid)
  const views = await sceneViews(p)
  const scenes = await Promise.all(views.map(async s => ({
    id: s.id, title: s.title, start: s.start, duration: s.duration,
    doc: buildFrame(p, s, await inlineAssets(p, await readScene(pid, s.id)))
  })))
  const total = views.reduce((a, s) => a + s.duration, 0)

  let audio: { src: string, offset: number } | null = null
  if (p.audio?.file) {
    try {
      const data = await fs.readFile(join(projectDir(pid), 'audio', p.audio.file))
      audio = { src: `data:${AUDIO_MIME[extname(p.audio.file).toLowerCase()] || 'audio/mpeg'};base64,${data.toString('base64')}`, offset: p.audio.startOffset || 0 }
    } catch {}
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.name)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #000; color: #fff; font: 14px/1.4 Inter, system-ui, -apple-system, sans-serif; overflow: hidden; }
  #wrap { position: fixed; inset: 0; display: grid; place-items: center; }
  #stage { position: relative; width: min(100vw, calc(100vh * ${p.width} / ${p.height})); aspect-ratio: ${p.width} / ${p.height}; background: #fff; overflow: hidden; }
  #stage iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; visibility: hidden; pointer-events: none; }
  #stage iframe.on { visibility: visible; }
  #big { position: absolute; inset: 0; margin: auto; width: 88px; height: 88px; border-radius: 50%; border: 0; background: rgba(10,10,10,.82); color: #fff; cursor: pointer;
    display: grid; place-items: center; box-shadow: 0 10px 40px rgba(0,0,0,.3); transition: transform .15s, opacity .2s; }
  #big:hover { transform: scale(1.06); }
  #big svg { width: 34px; height: 34px; margin-left: 5px; }
  body.playing #big { opacity: 0; pointer-events: none; }
  #bar { position: fixed; left: 0; right: 0; bottom: 0; padding: 28px 20px 14px; display: flex; align-items: center; gap: 14px;
    background: linear-gradient(transparent, rgba(0,0,0,.65)); transition: opacity .3s; }
  body.idle.playing #bar { opacity: 0; }
  body.idle.playing { cursor: none; }
  #bar button { background: none; border: 0; color: #fff; cursor: pointer; padding: 4px; display: grid; place-items: center; opacity: .9; }
  #bar button:hover { opacity: 1; }
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
<body>
<div id="wrap"><div id="stage">
  <button id="big" aria-label="Play"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg></button>
</div></div>
<div id="bar">
  <button id="pp" aria-label="Play"></button>
  <span id="title">${esc(p.name)}</span>
  <div id="track"><div id="fill"></div><div id="knob"></div></div>
  <span id="time"></span>
  <button id="fs" aria-label="Fullscreen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
</div>
<script>
(function () {
  var SCENES = ${json(scenes)};
  var TOTAL = ${total};
  var AUDIO = ${json(audio)};
  var PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>';
  var PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>';

  var stage = document.getElementById('stage'), pp = document.getElementById('pp'), big = document.getElementById('big');
  var track = document.getElementById('track'), fill = document.getElementById('fill'), knob = document.getElementById('knob');
  var timeEl = document.getElementById('time');
  var audio = AUDIO ? new Audio(AUDIO.src) : null;
  if (audio) audio.preload = 'auto';

  var frames = SCENES.map(function (s) {
    var f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts');
    f.setAttribute('title', s.title);
    f.srcdoc = s.doc;
    stage.insertBefore(f, big);
    return f;
  });
  SCENES.slice(1).forEach(function (s) {
    var c = document.createElement('div');
    c.className = 'cut';
    c.style.left = (s.start / TOTAL * 100) + '%';
    track.appendChild(c);
  });

  var t = 0, playing = false, last = 0, current = -1;

  function sceneAt(g) {
    for (var i = 0; i < SCENES.length; i++) if (g < SCENES[i].start + SCENES[i].duration) return i;
    return SCENES.length - 1;
  }
  function fmt(ms) { var s = Math.max(0, ms) / 1000; return Math.floor(s / 60) + ':' + ('0' + (s % 60).toFixed(1)).slice(-4); }

  function show() {
    var i = sceneAt(t);
    if (i !== current) {
      if (frames[current]) frames[current].classList.remove('on');
      frames[i].classList.add('on');
      current = i;
    }
    var s = SCENES[i];
    frames[i].contentWindow.postMessage({ __ve: true, type: 'seek', t: Math.min(t - s.start, s.duration) }, '*');
    var pct = TOTAL ? t / TOTAL * 100 : 0;
    fill.style.width = pct + '%';
    knob.style.left = pct + '%';
    timeEl.textContent = fmt(t) + ' / ' + fmt(TOTAL);
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || !d.__ve || d.type !== 'ready') return;
    var i = frames.findIndex(function (f) { return f.contentWindow === e.source; });
    if (i === current || current === -1) show();
  });

  function syncAudio() {
    if (!audio) return;
    audio.currentTime = (AUDIO.offset + t) / 1000;
    if (playing) audio.play().catch(function () {});
  }

  function tick(now) {
    if (!playing) return;
    if (audio && !audio.paused && !audio.ended) t = audio.currentTime * 1000 - AUDIO.offset;
    else t += now - last;
    last = now;
    if (t >= TOTAL) { t = TOTAL; show(); pause(); return; }
    show();
    requestAnimationFrame(tick);
  }

  function play() {
    if (playing) return;
    if (t >= TOTAL - 1) t = 0;
    playing = true;
    document.body.classList.add('playing');
    pp.innerHTML = PAUSE;
    last = performance.now();
    syncAudio();
    requestAnimationFrame(tick);
  }
  function pause() {
    playing = false;
    document.body.classList.remove('playing');
    pp.innerHTML = PLAY;
    if (audio) audio.pause();
  }
  function toggle() { playing ? pause() : play(); }
  function seek(ms) { t = Math.max(0, Math.min(TOTAL, ms)); if (audio) audio.currentTime = (AUDIO.offset + t) / 1000; show(); }

  var dragging = false, resume = false;
  function at(e) { var r = track.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * TOTAL; }
  track.addEventListener('pointerdown', function (e) { dragging = true; resume = playing; pause(); track.setPointerCapture(e.pointerId); seek(at(e)); });
  track.addEventListener('pointermove', function (e) { if (dragging) seek(at(e)); });
  track.addEventListener('pointerup', function () { dragging = false; if (resume) play(); });

  pp.addEventListener('click', toggle);
  big.addEventListener('click', play);
  stage.addEventListener('click', function (e) { if (e.target === stage) toggle(); });
  document.getElementById('fs').addEventListener('click', function () {
    document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(function () {});
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowRight') seek(t + (e.shiftKey ? 1000 : 5000));
    else if (e.key === 'ArrowLeft') seek(t - (e.shiftKey ? 1000 : 5000));
    else if (e.key === 'f') document.getElementById('fs').click();
    else if (e.key === 'Home') seek(0);
  });

  var idle;
  function wake() { document.body.classList.remove('idle'); clearTimeout(idle); idle = setTimeout(function () { document.body.classList.add('idle'); }, 2000); }
  document.addEventListener('mousemove', wake);
  document.addEventListener('touchstart', wake);
  wake();

  // Open on a representative frame rather than the (often blank) first one.
  pp.innerHTML = PLAY;
  t = SCENES.length ? Math.min(SCENES[0].duration * 0.6, TOTAL) : 0;
  show();
  var poster = t;
  big.addEventListener('click', function () { if (t === poster) seek(0); }, { capture: true });
})();
</script>
</body>
</html>`
}
