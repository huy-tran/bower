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

  var VE = {
    width: W, height: H,
    clamp: clamp, lerp: lerp, ease: ease, progress: progress, tween: tween,
    // Staggered start time for item i.
    stagger: function (i, step, start) { return (start || 0) + i * step; },
    // Music, scene-relative ms. Empty arrays when the project has no track.
    bpm: ctx.bpm || null,
    beats: ctx.beats || [], downbeats: ctx.downbeats || [], phrases: ctx.phrases || [],
    beat: function (n) { return VE.beats[n]; },
    downbeat: function (n) { return VE.downbeats[n]; },
    snap: function (t, grid) { var l = VE[grid || 'beats']; return l && l.length ? nearest(l, t) : t; },
    get duration() { return readMeta().duration || 3000; },
    get time() { return cur; },
    $: function (s) { return document.querySelector(s); },
    $$: function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); },
    scene: function (d) { def = d; fit(); VE.seek(cur); },
    seek: function (t) {
      cur = t;
      try {
        if (def && def.render) def.render(t, VE);
        document.getAnimations().forEach(function (a) { a.pause(); a.currentTime = t; });
      } catch (e) {
        report('error', { message: String(e && e.message || e) });
        throw e;
      }
    }
  };

  window.VE = VE;
  window.__seek = function (t) { VE.seek(t); return document.fonts ? document.fonts.ready.then(function () { return true; }) : true; };

  window.addEventListener('error', function (e) { report('error', { message: e.message }); });
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (d && d.__ve && d.type === 'seek') VE.seek(d.t);
  });
  window.addEventListener('resize', fit);
  document.addEventListener('DOMContentLoaded', function () {
    fit();
    var q = new URLSearchParams(location.search).get('t');
    VE.seek(q ? parseFloat(q) : cur);
    report('ready', { duration: VE.duration });
  });
})();
`
