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
  // Live UI snapshots (<ve-ui src="assets/ui/....html">, saved by Bower from the running app): the markup goes in a
  // shadow root so the app's CSS and the scene's never meet; @font-face and @property rules, which only work at
  // document level, go in the document head. Everything waits until they are in and their images decoded.
  var uiDone = false, resolveUi;
  var uiReady = new Promise(function (res) { resolveUi = res; });
  // Apps animate their own style changes with CSS transitions, which would run in real time when a scene sets a
  // style: off inside snapshots, as in any scene. The caret is hidden too (it blinks on its own clock).
  var UI_HOST = ':host{all:initial;display:block;position:relative;overflow:hidden;contain:layout paint;width:1440px;height:900px}' +
    '*,*::before,*::after{transition:none!important;caret-color:transparent!important}';
  function loadUi(host) {
    var src = host.getAttribute('src');
    return fetch(src).then(function (r) {
      if (!r.ok) throw new Error('A live UI snapshot could not be loaded: ' + src);
      return r.text();
    }).then(function (text) {
      var m = text.match(/^<!--ve-ui (.*?)-->/), meta = {};
      try { meta = m ? JSON.parse(m[1]) : {}; } catch (e) {}
      var g = text.match(/<style data-ve-global>([\s\S]*?)<\/style>/);
      if (g && g[1].trim() && !document.querySelector('style[data-ve-ui="' + src + '"]')) {
        var st = document.createElement('style');
        st.setAttribute('data-ve-ui', src);
        st.textContent = g[1];
        document.head.appendChild(st);
      }
      var root = host.shadowRoot || host.attachShadow({ mode: 'open' });
      var size = UI_HOST.replace('1440px', (meta.width || 1440) + 'px').replace('900px', (meta.height || 900) + 'px');
      // Parsed in an inert template and cleaned again before it goes live: the capture already removed scripts
      // and handlers, but a snapshot is markup from another site, and scenes run in the editor's own origin.
      var tpl = document.createElement('template');
      tpl.innerHTML = text.replace(/<style data-ve-global>[\s\S]*?<\/style>/, '');
      tpl.content.querySelectorAll('script, iframe, object, embed, link, meta, base').forEach(function (el) { el.remove(); });
      tpl.content.querySelectorAll('*').forEach(function (el) {
        Array.prototype.slice.call(el.attributes).forEach(function (a) {
          if (/^on/i.test(a.name) || a.name === 'autofocus' || (/^(href|src|xlink:href|action|formaction)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
        });
      });
      var hostStyle = document.createElement('style');
      hostStyle.textContent = size;
      root.replaceChildren(hostStyle, tpl.content);
      // The page's own scroll position, and boxes that were scrolled (a sidebar, a long table).
      var body = root.querySelector('[data-ve-body]');
      var y = body ? parseFloat(body.getAttribute('data-ve-page-scroll')) || 0 : 0;
      if (y) body.style.transform = 'translateY(' + (-y) + 'px)';
      root.querySelectorAll('[data-ve-scroll]').forEach(function (el) {
        var p = el.getAttribute('data-ve-scroll').split(',');
        el.scrollTop = +p[0] || 0; el.scrollLeft = +p[1] || 0;
      });
      return Promise.all(Array.prototype.map.call(root.querySelectorAll('img'), function (img) {
        return img.decode ? img.decode().catch(function () {}) : null;
      }));
    });
  }
  function hydrateUi() {
    var hosts = document.querySelectorAll('ve-ui[src]');
    var all = Array.prototype.map.call(hosts, loadUi);
    return Promise.all(all).then(function () { return document.fonts ? document.fonts.ready : null; })
      .catch(function (e) { report('error', { message: String(e && e.message || e) }); })
      .then(function () { uiDone = true; resolveUi(); });
  }

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
    // Live UI snapshots: VE.ui('.screen') reaches inside a <ve-ui> (its shadow root). ui.$ / ui.$$ query it,
    // ui.handle('b3') finds a tagged element ([data-ve="b3"]), ui.text('Export') the element showing that text.
    ui: function (sel) {
      var host = typeof sel === 'string' ? document.querySelector(sel) : sel;
      var root = function () { return host && host.shadowRoot; };
      var q = function (s) { var r = root(); return r ? r.querySelector(s) : null; };
      return {
        host: host,
        get root() { return root(); },
        $: q,
        $$: function (s) { var r = root(); return r ? Array.prototype.slice.call(r.querySelectorAll(s)) : []; },
        handle: function (id) { return q('[data-ve="' + id + '"]'); },
        text: function (want) {
          var r = root(); if (!r) return null;
          var w = String(want).replace(/\s+/g, ' ').trim().toLowerCase(), best = null;
          r.querySelectorAll('*').forEach(function (el) {
            var t = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
            if (t === w && (!best || best.contains(el))) best = el;
          });
          return best;
        }
      };
    },
    // Types text into a field (or any element) as a function of t: the first n characters, n growing at cps
    // characters a second from start. Deterministic, so a render shows the same letters at the same time.
    type: function (el, text, t, start, cps) {
      if (!el) return 0;
      var n = Math.max(0, Math.min(text.length, Math.floor((t - (start || 0)) * (cps || 14) / 1000)));
      var v = text.slice(0, n);
      if ('value' in el) { el.value = v; el.setAttribute('value', v); } else el.textContent = v;
      return n;
    },
    // Sets every animated property for time t. Returns a promise when video clips have to reach their frame.
    seek: function (t) {
      cur = t;
      // Until live UI snapshots are in, render(t) would find nothing to animate: wait for them first.
      if (!uiDone) return uiReady.then(function () { return VE.seek(cur); });
      try {
        if (def && def.render) def.render(t, VE);
        document.getAnimations().forEach(function (a) { a.pause(); a.currentTime = t; });
        // Animations inside live UI snapshots (an app's spinners, say) live in shadow roots, which document.getAnimations()
        // does not see.
        document.querySelectorAll('ve-ui').forEach(function (h) { if (h.shadowRoot) h.shadowRoot.getAnimations().forEach(function (a) { a.pause(); a.currentTime = t; }); });
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
    // Ready once live UI snapshots are in, so the renderer's first frame already shows them.
    hydrateUi().then(function () { report('ready', { duration: VE.duration }); });
  });
})();
`
