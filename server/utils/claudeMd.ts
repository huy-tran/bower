import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { STORAGE, type Project } from './store'

export async function writeClaudeMd(p: Project) {
  const art = p.artDirection.trim()
  const md = `# Storyboard project: ${p.name}

This folder is a motion-graphics video made of scenes. You are editing it from the Storyboard editor,
where the user previews every change frame by frame. Each request is small and iterative: make exactly the
change asked for, keep everything else identical, and describe what you changed in a few sentences.

## Layout

- \`project.json\` - scene order and titles (\`scenes: [{ id, title }]\`), stage size, fps, music analysis.
- \`scenes/<id>.html\` - one file per scene. **This is where you work.**
- \`assets/\` - images or other files a scene may reference as \`/api/projects/${p.id}/files/assets/<name>\`.
- \`.storyboard/\` - editor data (versions, chats). Never touch it.

## Scene file contract

A scene file is an HTML fragment that is placed inside a fixed ${p.width}x${p.height} stage (\`#stage\`,
\`position: relative\`, white background, overflow hidden). The editor scales the stage to fit. The file must contain:

1. The duration block, first line of the file:
   \`<script type="application/json" id="meta">{"duration": 3320}</script>\` - duration in milliseconds.
   Change this number when the user asks for the scene to be longer or shorter.
2. Markup and \`<style>\` for the scene. Position things absolutely in stage pixels (${p.width}x${p.height}).
   Scope CSS with class names; never style \`html\`, \`body\` or \`#stage\` sizing.
3. One script that calls \`VE.scene({ render(t) { ... } })\`.

\`render(t)\` receives the scene-relative time in ms and must set **every animated property from \`t\` alone**.
It is called for arbitrary times in any order (scrubbing, thumbnails, frame-by-frame video export), so:

- No \`setTimeout\`, \`setInterval\`, \`requestAnimationFrame\`, \`Date.now\`, \`performance.now\`, \`Math.random\` or CSS transitions.
  Use a seeded pseudo-random function if you need noise.
- No state that accumulates between calls. \`render(1200)\` must look identical whether or not \`render(1100)\` ran first.
- CSS \`@keyframes\` animations are allowed: the runtime pauses them and sets their currentTime to \`t\`.
- Query elements once at the top of the script, outside \`render\`.
- Web fonts: \`@import\` from Google Fonts at the top of the \`<style>\`. Inter is the default.
- Inline SVG is preferred for illustrations, icons and UI mockups.

### The \`VE\` helper (global)

- \`VE.progress(t, start, dur, ease)\` - eased 0..1 for an animation starting at \`start\` lasting \`dur\` ms.
- \`VE.tween(t, [[ms, value], [ms, value, ease?], ...], ease)\` - keyframes; values may be numbers or arrays.
- \`VE.lerp(a, b, p)\`, \`VE.clamp(v, min = 0, max = 1)\`, \`VE.stagger(i, stepMs, startMs)\`.
- \`VE.ease.*\` - linear, in/out/inOut Quad, Cubic, Quart, Quint, Expo, outBack, inOutBack, spring. Pass the name or a function.
- \`VE.beats\`, \`VE.downbeats\`, \`VE.phrases\` - music times in scene-relative ms (empty without a track), \`VE.bpm\`.
  \`VE.beat(n)\`, \`VE.downbeat(n)\`, \`VE.snap(ms, 'beats' | 'downbeats' | 'phrases')\` - nearest grid time.
- \`VE.duration\`, \`VE.width\`, \`VE.height\`, \`VE.$(sel)\`, \`VE.$$(sel)\`.

Example:

\`\`\`html
<script type="application/json" id="meta">{"duration": 2500}</script>
<style>
  .title { position: absolute; left: 0; right: 0; top: 420px; text-align: center; font: 700 120px/1 Inter, sans-serif; letter-spacing: -0.05em; }
</style>
<div class="title">Hello</div>
<script>
  const title = VE.$('.title')
  VE.scene({
    render(t) {
      const inP = VE.progress(t, 100, 600, 'outExpo')
      const outP = VE.progress(t, VE.duration - 400, 400, 'inCubic')
      title.style.opacity = inP * (1 - outP)
      title.style.transform = \`translateY(\${(1 - inP) * 40}px) scale(\${1 - outP * 0.05})\`
    }
  })
</script>
\`\`\`

## Cuts between scenes

Scenes are played back to back with hard cuts. When the user wants a seamless handoff, make the last frame of
one scene match the first frame of the next (same element positions, sizes and styles). Read the neighbouring
scene file to match it exactly. Do not change a neighbour unless asked.

## Music

When the prompt lists beats, key important motion moments (arrivals, cuts, accents) to those times,
preferring downbeats for big moves and phrase starts for section changes. A move that "lands on" a beat
should finish at the beat, not start on it.

## Quality bar

Motion should feel like a polished product-launch video: confident easing (outExpo/outQuint for arrivals,
inOutCubic for travel), restrained timing, crisp typography, generous whitespace, subtle depth. Nothing jitters,
nothing pops without intent, and no element sits still in an awkward half-state.

## Art direction

${art || '_No project art direction set yet. Default to a clean, minimal, black-on-white product aesthetic with Inter._'}
`
  await fs.writeFile(join(STORAGE, p.id, 'CLAUDE.md'), md)
}
