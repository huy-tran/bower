// Client-side runtime injected into every scene frame. Scenes are pure functions of time:
// the editor, thumbnails and the renderer all drive them through VE.seek(t).
export const SCENE_RUNTIME = String.raw`
(function () {
  var ctx = window.__VE_CTX || {};
  var W = ctx.width || 1920, H = ctx.height || 1080;

  function clamp(v, a, b) { a = a == null ? 0 : a; b = b == null ? 1 : b; return Math.min(b, Math.max(a, v)); }
  function lerp(a, b, p) { return a + (b - a) * p; }

  var ease = {
    linear: function (p) { return p; },
    inQuad: function (p) { return p * p; },
    outQuad: function (p) { return 1 - (1 - p) * (1 - p); },
    inOutQuad: function (p) { return p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; },
    inCubic: function (p) { return p * p * p; },
    outCubic: function (p) { return 1 - Math.pow(1 - p, 3); },
    inOutCubic: function (p) { return p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; },
    outQuart: function (p) { return 1 - Math.pow(1 - p, 4); },
    inOutQuart: function (p) { return p < .5 ? 8 * p * p * p * p : 1 - Math.pow(-2 * p + 2, 4) / 2; },
    outQuint: function (p) { return 1 - Math.pow(1 - p, 5); },
    inOutQuint: function (p) { return p < .5 ? 16 * p * p * p * p * p : 1 - Math.pow(-2 * p + 2, 5) / 2; },
    outExpo: function (p) { return p === 1 ? 1 : 1 - Math.pow(2, -10 * p); },
    inExpo: function (p) { return p === 0 ? 0 : Math.pow(2, 10 * p - 10); },
    inOutExpo: function (p) { return p === 0 ? 0 : p === 1 ? 1 : p < .5 ? Math.pow(2, 20 * p - 10) / 2 : (2 - Math.pow(2, -20 * p + 10)) / 2; },
    outBack: function (p) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); },
    inOutBack: function (p) { var c2 = 1.70158 * 1.525; return p < .5 ? (Math.pow(2 * p, 2) * ((c2 + 1) * 2 * p - c2)) / 2 : (Math.pow(2 * p - 2, 2) * ((c2 + 1) * (p * 2 - 2) + c2) + 2) / 2; },
    spring: function (p) { return 1 - Math.cos(p * Math.PI * 4.5) * Math.exp(-p * 6); }
  };

  function resolveEase(e) { return typeof e === 'function' ? e : (ease[e || 'inOutCubic'] || ease.inOutCubic); }

  // 0..1 progress of an animation that starts at 'start' ms and lasts 'dur' ms.
  function progress(t, start, dur, e) { return resolveEase(e)(clamp(dur <= 0 ? (t >= start ? 1 : 0) : (t - start) / dur)); }

  // Keyframes: [[timeMs, value], ...], values can be numbers or arrays of numbers.
  function tween(t, keys, e) {
    if (t <= keys[0][0]) return keys[0][1];
    for (var i = 1; i < keys.length; i++) {
      if (t <= keys[i][0]) {
        var a = keys[i - 1], b = keys[i];
        var p = resolveEase(b[2] || e)((t - a[0]) / (b[0] - a[0] || 1));
        if (Array.isArray(a[1])) return a[1].map(function (v, j) { return lerp(v, b[1][j], p); });
        return lerp(a[1], b[1], p);
      }
    }
    return keys[keys.length - 1][1];
  }

  function nearest(list, t) {
    var best = t, d = Infinity;
    for (var i = 0; i < list.length; i++) { var dd = Math.abs(list[i] - t); if (dd < d) { d = dd; best = list[i]; } }
    return best;
  }

  var def = null, cur = 0, stage = null;

  function readMeta() {
    var el = document.getElementById('meta');
    try { return el ? JSON.parse(el.textContent) : {}; } catch (e) { return {}; }
  }

  function fit() {
    stage = stage || document.getElementById('stage');
    if (!stage) return;
    var s = Math.min(innerWidth / W, innerHeight / H);
    stage.style.transform = 'translate(' + (innerWidth - W * s) / 2 + 'px,' + (innerHeight - H * s) / 2 + 'px) scale(' + s + ')';
  }

  function report(type, data) {
    try { parent.postMessage(Object.assign({ __ve: true, type: type, sceneId: ctx.sceneId }, data || {}), '*'); } catch (e) {}
  }

  // Video clips (<video data-ve-clip>): never played, always seeked to the frame for time t, so a render shows
  // the same frame for the same t every time. Recorded clips have a keyframe on every frame, and the seek aims
  // at the middle of a frame so rounding can never land on its neighbour. Optional attributes, all in ms:
  // data-start (when the clip starts in the scene), data-from / data-to (trim), data-rate (speed), data-fps.
  var CLIP_TIMEOUT = 8000;
  function clipReady(v) {
    if (!v.__ve) {
      v.__ve = { frame: -1 };
      v.muted = true; v.playsInline = true; v.preload = 'auto'; v.pause();
      v.__ve.ready = new Promise(function (res) {
        if (v.readyState >= 1) return res();
        v.addEventListener('loadedmetadata', function () { res(); }, { once: true });
        v.addEventListener('error', function () { res(); }, { once: true });
      });
    }
    return v.__ve.ready;
  }
  function clipFrame(v, t) {
    var fps = parseFloat(v.dataset.fps) || ctx.fps || 30;
    var start = parseFloat(v.dataset.start) || 0, rate = parseFloat(v.dataset.rate) || 1;
    var from = parseFloat(v.dataset.from) || 0;
    var end = v.dataset.to ? parseFloat(v.dataset.to) : v.duration * 1000;
    var local = Math.min(end, from + Math.max(0, t - start) * rate);
    var last = Math.max(0, Math.ceil(v.duration * fps) - 1);
    // The tiny tolerance keeps times that land exactly on a frame boundary (render frames often do) on that frame.
    return { fps: fps, frame: Math.max(0, Math.min(last, Math.floor(local / 1000 * fps + 1e-6))) };
  }
  function syncClips(t) {
    var vids = document.querySelectorAll('video[data-ve-clip]');
    if (!vids.length) return null;
    return Promise.all(Array.prototype.map.call(vids, function (v) {
      return clipReady(v).then(function () {
        if (!v.duration || !isFinite(v.duration)) throw new Error('A video clip could not be loaded: ' + (v.currentSrc || v.getAttribute('src') || '').slice(0, 120));
        var f = clipFrame(v, t);
        if (f.frame === v.__ve.frame && !v.seeking) return;
        v.__ve.frame = f.frame;
        return new Promise(function (res, rej) {
          var timer = setTimeout(function () { rej(new Error('A video clip did not reach frame ' + f.frame + ' in time')); }, CLIP_TIMEOUT);
          var shown = function () { clearTimeout(timer); res(); };
          v.addEventListener('seeked', function () {
            // The decoded frame is ready once seeked fires; it reaches the screen with the next paint. Headless
            // Chrome does not always call requestVideoFrameCallback after a seek, so two paints also count.
            var once = false, go = function () { if (!once) { once = true; shown(); } };
            if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(go);
            requestAnimationFrame(function () { requestAnimationFrame(go); });
          }, { once: true });
          v.currentTime = (f.frame + 0.5) / f.fps;
        });
      });
    })).catch(function (e) { report('error', { message: String(e && e.message || e) }); throw e; });
  }

  var VE = {
    width: W, height: H,
    clamp: clamp, lerp: lerp, ease: ease, progress: progress, tween: tween,
    // Staggered start time for item i.
    stagger: function (i, step, start) { return (start || 0) + i * step; },
    // Music, scene-relative ms. Empty arrays when the project has no track.
    bpm: ctx.bpm || null,
    beats: ctx.beats || [], downbeats: ctx.downbeats || [], phrases: ctx.phrases || [],
    // Music sections overlapping this scene: [{ label, energy, start, end }], scene-relative ms.
    sections: ctx.sections || [],
    beat: function (n) { return VE.beats[n]; },
    downbeat: function (n) { return VE.downbeats[n]; },
    snap: function (t, grid) { var l = VE[grid || 'beats']; return l && l.length ? nearest(l, t) : t; },
    get duration() { return readMeta().duration || 3000; },
    get time() { return cur; },
    $: function (s) { return document.querySelector(s); },
    $$: function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); },
    scene: function (d) { def = d; fit(); Promise.resolve(VE.seek(cur)).catch(function () {}); },
    // Sets every animated property for time t. Returns a promise when video clips have to reach their frame.
    seek: function (t) {
      cur = t;
      try {
        if (def && def.render) def.render(t, VE);
        document.getAnimations().forEach(function (a) { a.pause(); a.currentTime = t; });
      } catch (e) {
        report('error', { message: String(e && e.message || e) });
        throw e;
      }
      return syncClips(t);
    }
  };

  // Everything a frame waits for before it is captured: video clips on their frame, then fonts.
  function settled(t) {
    return Promise.resolve(VE.seek(t)).then(function () { return document.fonts ? document.fonts.ready : null; });
  }

  window.VE = VE;
  window.__seek = function (t) { return settled(t).then(function () { return true; }); };

  window.addEventListener('error', function (e) { report('error', { message: e.message }); });
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || !d.__ve || d.type !== 'seek') return;
    var done = settled(d.t);
    // The renderer waits for this acknowledgement (after clips, fonts and a paint) before taking a frame. A clip
    // that cannot reach its frame fails the frame instead of letting a wrong one through.
    if (d.id != null) {
      done.then(function () { requestAnimationFrame(function () { report('seeked', { id: d.id }); }); },
        function (e) { report('seeked', { id: d.id, error: String(e && e.message || e) }); });
    } else done.catch(function () {});
  });
  window.addEventListener('resize', fit);
  document.addEventListener('DOMContentLoaded', function () {
    fit();
    var q = new URLSearchParams(location.search).get('t');
    Promise.resolve(VE.seek(q ? parseFloat(q) : cur)).catch(function () {});
    report('ready', { duration: VE.duration });
  });
})();
`
