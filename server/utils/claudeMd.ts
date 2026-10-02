import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { projectBrand, type BrandKit } from './brand'
import { STORAGE } from './paths'
import { allCodebases, type Project } from './store'

const BT = '`'
const code = (s: string) => BT + s + BT

// Helper Claude may run (the only shell command it is allowed): frame snapshots, the seam checker and
// screenshots of the running product.
const BOWER_TOOL = `#!/usr/bin/env node
// Bower helper for Claude. Talks to the running Bower editor, which renders the images.
//   node bower.mjs snap <sceneId> [ms ...]           PNG snapshots of a scene at the given times (default: 5 across it)
//   node bower.mjs seam [sceneId]                    how much the picture jumps at each cut (or the cuts around one scene)
//   node bower.mjs shot <page> [size] [full] [steps] screenshot of a page of the running product (size: desktop, laptop, tablet, mobile)
//       steps: a JSON array of actions to run first, or @file.json holding one, for example
//       '[{"click":"Export"},{"wait":"Export contacts"},{"shot":"export-modal"}]' (see "The running product" in CLAUDE.md)
import { readFileSync } from 'node:fs'
const base = process.env.BOWER_URL, pid = process.env.BOWER_PROJECT
const [cmd, ...args] = process.argv.slice(2)
if (!base || !pid) { console.error('This helper only works inside the Bower editor (BOWER_URL is not set).'); process.exit(1) }
async function call(path, init = {}) {
  // The desktop app's server only answers requests carrying its session token.
  const r = await fetch(base + path, { ...init, headers: { ...init.headers, 'x-bower-token': process.env.BOWER_TOKEN || '' } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.message || r.statusText)
  return j
}
try {
  if (cmd === 'shot' && args[0]) {
    // Git Bash on Windows rewrites an argument like /contacts into C:/Program Files/Git/contacts. Undo that.
    const msys = (process.env.EXEPATH || '').replace(/\\\\/g, '/').replace(/\\/((usr|mingw64)\\/)?(bin|cmd)\\/?$/, '')
    if (msys && args[0].replace(/\\\\/g, '/').toLowerCase().startsWith(msys.toLowerCase() + '/')) args[0] = args[0].replace(/\\\\/g, '/').slice(msys.length)
    const size = args.find(a => ['desktop', 'laptop', 'tablet', 'mobile'].includes(a))
    const raw = args.slice(1).find(a => a.startsWith('[') || a.startsWith('@'))
    const steps = raw ? JSON.parse(raw.startsWith('@') ? readFileSync(raw.slice(1), 'utf8') : raw) : undefined
    const j = await call('/api/projects/' + pid + '/app/shots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: args[0], size, fullPage: args.includes('full'), steps }) })
    for (const s of j.shots) console.log(s.path + '  (' + s.width + 'x' + s.height + (s.fullPage ? ', full page' : '') + (s.title ? ', "' + s.title + '"' : '') + ')')
    console.log((j.shots.length > 1 ? 'Read these PNGs to see them. To show one inside a scene use the src /api/projects/' + pid + '/files/<path>' : 'Read this PNG to see it. To show it inside a scene use the src ' + j.shots[0].url))
  } else if (cmd === 'snap' && args[0]) {
    const j = await call('/api/projects/' + pid + '/scenes/' + args[0] + '/snapshots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ times: args.slice(1).map(Number) }) })
    for (const f of j.files) console.log(f.t + 'ms  ' + f.path)
    console.log('Read these PNG files to see the frames.')
  } else if (cmd === 'seam') {
    const j = await call('/api/projects/' + pid + '/seams' + (args[0] ? '?sceneId=' + args[0] : ''))
    if (!j.seams.length) console.log('No cuts to check.')
    for (const s of j.seams) console.log(s.fromTitle + ' -> ' + s.toTitle + ': ' + s.diff.toFixed(2) + '% of pixels differ' + (s.transition ? ' (' + s.transition.type + ' transition)' : ' (hard cut)') + '. Image (last frame | first frame | changed pixels in red): ' + s.path)
  } else {
    console.log('Usage: node bower.mjs snap <sceneId> [ms ...] | node bower.mjs seam [sceneId] | node bower.mjs shot <page> [size] [full] [steps]')
  }
} catch (e) { console.error(String(e.message || e)); process.exit(1) }
`

function visualSection() {
  return [
    '## Look at your work',
    '',
    'You cannot see the preview, but you can render frames. The only shell command you may run is this helper:',
    '',
    `- ${code('node bower.mjs snap <sceneId> [ms ...]')} renders PNG snapshots of a scene (default: 5 moments across it).`,
    '  Read the PNGs it lists. Check layout, overlaps, clipping, text wrapping and whether things sit where you meant.',
    `- ${code('node bower.mjs seam [sceneId]')} reports what percentage of pixels change across each cut, with a side-by-side image.`,
    '  Under 1% reads as seamless.',
    '',
    'After any visual change, snap the key moments you changed and look at them before replying. Fix what looks wrong.',
    'When the user asked for a seamless cut, run the seam check and keep going until it is under 1%, then report the number.',
    'Do not snap more than you need: a handful of well-chosen moments is enough.',
    '',
    ''
  ].join('\n')
}

function brandSection(p: Project, kit: BrandKit) {
  const lines = [`## Brand kit: ${kit.name}`, '', "Use this brand's colours, fonts and logos unless the user asks otherwise.", '']
  if (kit.colors.length) {
    lines.push('Colours:', ...kit.colors.map(c => `- ${c.name || 'Colour'}: ${c.hex}`), '')
  }
  lines.push(`Fonts: headings in "${kit.fonts.heading}", body text in "${kit.fonts.body}". Both are already loaded on the stage (Google Fonts).`, '')
  if (kit.files.length) {
    lines.push('Logos and brand images (Read them to see them):')
    lines.push(...kit.files.map(f => `- ${f.label}: ${code(`brand/${f.name}`)} - in a scene: ${code(`/api/projects/${p.id}/files/brand/${f.name}`)}`), '')
  }
  if (kit.notes.trim()) lines.push('Brand notes:', '', kit.notes.trim(), '')
  return lines.join('\n') + '\n'
}

function codebaseSection(p: Project) {
  const repos = allCodebases(p)
  const many = repos.length > 1
  const lines = [
    `## Linked codebase${many ? 's' : ''}`,
    '',
    `The product this video is about lives in ${many ? 'these repositories' : 'this repository'}. You may Read, Glob and Grep ${many ? 'them' : 'it'}, but never edit`,
    `${many ? 'them' : 'it'}, and never copy ${many ? 'their' : 'its'} files into this project.`,
    ''
  ]
  for (const c of repos) {
    lines.push(`### ${c.label}: ${code(c.path)}`, '')
    if (c.notes.trim()) lines.push(c.notes.trim(), '')
  }
  lines.push(
    'Use the code to make scenes that look like the real product:',
    '',
    '- Colours, fonts, spacing and radii: look for design tokens (Tailwind config, CSS variables, theme files, `*.tokens.*`).',
    '- Screens and components: find the page or component the user names and rebuild it in the scene as inline HTML/SVG',
    '  with the same layout, hierarchy, copy and iconography. Do not import its framework code; scenes are static markup.',
    '- Copy: use the product\'s real labels, headings and empty-state text rather than placeholders.',
    '- Motion: if the app defines easing or duration tokens, echo them so the video feels like the product.',
    '',
    many ? '- When a request spans the stack (a form and the API it calls, a screen and its data), read both sides and show the real field names, routes and responses.' : '',
    '',
    'Skip `node_modules`, `vendor`, build output, lockfiles and tests. Search for what the request needs; do not',
    'explore the whole tree. Say briefly which files you drew from.',
    ''
  )
  return lines.filter(l => l !== undefined).join('\n').replace(/\n{3,}/g, '\n\n') + '\n'
}

function appSection(p: Project) {
  const a = p.app!
  return [
    '## The running product',
    '',
    `The product is running at ${a.url}, and the user has signed in for you. You can take screenshots of its real screens:`,
    '',
    `- ${code('node bower.mjs shot <page> [desktop|laptop|tablet|mobile] [full] [steps]')} - \`<page>\` is a path like \`/dashboard\` or a full URL.`,
    '  The default is a 1440x900 desktop viewport at 2x; \`full\` captures the whole page. PNGs land in \`assets/shots/\`.',
    '- Read the PNG to see it. Use it two ways: as a reference to rebuild the screen in HTML/SVG, or shown directly in a scene',
    `  with \`<img src="/api/projects/${p.id}/files/assets/shots/<name>.png">\` inside a device frame, cropped or zoomed with transforms.`,
    '- Take only the screenshots the request needs. Do not screenshot the editor itself.',
    '- If a capture says Bower is signed out of the app, stop capturing and tell the user in one sentence to sign in again in',
    '  Settings, App. Do not try to sign in yourself, and do not use a screenshot of the sign-in page in place of the real screen.',
    '',
    '### Real screenshots or rebuilt screens',
    '',
    `The project setting is **${({ shots: 'real screenshots', rebuild: 'rebuild in HTML', auto: 'your call' } as Record<string, string>)[a.mode ?? 'auto']}**, and a scene can override it with an \`"app"\` key in its meta block`,
    '(`"shots"`, `"rebuild"` or `"auto"`; the prompt tells you which applies, and the user can change it in the scene chat). Keep the key when you edit the file.',
    '',
    '- Screenshots: place PNGs with `<img>` and animate them with crops, zooms, pans and crossfades. Capture every state you need, several',
    '  per run with steps, instead of redrawing any part of the UI. Only rebuild an element when no screenshot can do it, and say so.',
    '- Rebuild: redraw screens in HTML/SVG from screenshots and the linked code so parts can animate separately. Do not place screenshots in the scene.',
    '- Your call: real screenshots are more authentic; rebuilt screens are better when parts must animate separately.',
    '',
    'An explicit instruction in the request always wins over the setting.',
    '',
    '### Capturing modals, menus and filled forms',
    '',
    'Pass steps as a JSON array (in single quotes) and the page is driven through them before the capture. A \`shot\` step saves a',
    'PNG of the state at that point, so one run can capture several states. Without a \`shot\` step the page is captured at the end.',
    '',
    '```',
    'node bower.mjs shot /contacts \'[{"click":"Export"},{"wait":"Export contacts"},{"shot":"export-modal"},{"select":"CSV","in":"Format"},{"shot":"export-csv"}]\'',
    'node bower.mjs shot /contacts @steps.json     # the same array in a file in this folder, for long sequences',
    '```',
    '',
    'Steps (one verb each; targets are the visible text, or a CSS selector when they start with \`#\`, \`.\`, \`[\` or \`css:\`):',
    '',
    '- `{"click": "Export"}` - click the button, link, menu item, tab, row or label with that text. `"nth": 2` picks the second match.',
    '- `{"type": "Jane Doe", "in": "Name"}` - replace the field\'s content; the field is found by its label, placeholder or name. Add `"enter": true` to submit.',
    '- `{"select": "Active", "in": "Status"}` - choose an option of a native `<select>` by text or value. For custom dropdowns, click to open, then click the option.',
    '- `{"hover": "Actions"}`, `{"press": "Escape"}` (any key name: Enter, Tab, ArrowDown...).',
    '- `{"wait": "Export contacts"}` - wait for text or a selector to appear (`"gone": true` waits for it to disappear, `"timeout"` in ms, default 10000). `{"wait": 800}` pauses.',
    '- `{"scroll": "Audit log"}`, `{"scroll": 600}` (pixels) or `{"scroll": "bottom"}`.',
    '- `{"goto": "/settings"}` - open another page in the same run, keeping the session.',
    '- `{"shot": "export-modal"}` - save a PNG now, named after the label (`"full": true` for the whole page).',
    '',
    'Clicks and typing use real mouse and keyboard events, and the run waits for the app to settle after each step, so Livewire',
    'and Alpine behave as for a person. When a step fails, the error names the step and the reason, lists what is visible, and',
    'saves a PNG of the page at that point: Read it, adjust the steps and run again. Do not change the app\'s data unless the',
    'request calls for it: open dialogs and fill forms freely, but cancel rather than save when a real record would be created.',
    '',
    a.notes.trim() ? `How to get around the app:\n\n${a.notes.trim()}\n` : ''
  ].filter(l => l !== undefined).join('\n').replace(/\n{3,}/g, '\n\n') + '\n'
}

export async function writeClaudeMd(p: Project) {
  const art = p.artDirection.trim()
  const kit = await projectBrand(p.id)
  const shape = p.height > p.width ? '(portrait) ' : p.width === p.height ? '(square) ' : ''
  const md = `# Bower project: ${p.name}

This folder is a motion-graphics video made of scenes. You are editing it from the Bower editor,
where the user previews every change frame by frame. Each request is small and iterative: make exactly the
change asked for, keep everything else identical, and describe what you changed in a few sentences.

## Layout

- \`project.json\` - scene order, titles and transitions (\`scenes: [{ id, title, transition }]\`), stage size, fps, music and sound.
- \`scenes/<id>.html\` - one file per scene. **This is where you work.**
- \`assets/\` - images the user attached or uploaded. Read them to see them; use them in a scene as \`/api/projects/${p.id}/files/assets/<name>\`.
${p.app ? `- \`assets/shots/\` - screenshots of the running product (see "The running product").\n` : ''}
${kit ? `- \`brand/\` - the brand kit's logos. Use them in a scene as \`/api/projects/${p.id}/files/brand/<name>\`.\n` : ''}- \`snapshots/\` - frames rendered by the helper described below. Read the PNGs to see them.
- \`.bower/\` - editor data (versions, chats, trash). Never touch it.

## Scene file contract

A scene file is an HTML fragment that is placed inside a fixed ${p.width}x${p.height} ${shape}stage (\`#stage\`,
\`position: relative\`, white background, overflow hidden). The editor scales the stage to fit. The file must contain:

1. The meta block, first line of the file:
   \`<script type="application/json" id="meta">{"duration": 3320}</script>\` - duration in milliseconds.
   Change this number when the user asks for the scene to be longer or shorter. It may also hold a \`voice\` key
   with the scene's voice-over script (see "Voice-over" below) and a \`brief\` key: what the scene should show,
   from the storyboard. A scene whose body is still the placeholder headline has not been built yet: build it
   from its brief.
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
- Web fonts: \`@import\` from Google Fonts at the top of the \`<style>\`. Inter is the default${kit ? ' (the brand fonts are already loaded)' : ''}.
- Inline SVG is preferred for illustrations, icons and UI mockups.

### The \`VE\` helper (global)

- \`VE.progress(t, start, dur, ease)\` - eased 0..1 for an animation starting at \`start\` lasting \`dur\` ms.
- \`VE.tween(t, [[ms, value], [ms, value, ease?], ...], ease)\` - keyframes; values may be numbers or arrays.
- \`VE.lerp(a, b, p)\`, \`VE.clamp(v, min = 0, max = 1)\`, \`VE.stagger(i, stepMs, startMs)\`.
- \`VE.ease.*\` - linear, in/out/inOut Quad, Cubic, Quart, Quint, Expo, outBack, inOutBack, spring. Pass the name or a function.
- \`VE.beats\`, \`VE.downbeats\`, \`VE.phrases\` - music times in scene-relative ms (empty without a track), \`VE.bpm\`.
  \`VE.beat(n)\`, \`VE.downbeat(n)\`, \`VE.snap(ms, 'beats' | 'downbeats' | 'phrases')\` - nearest grid time.
- \`VE.sections\` - music sections overlapping the scene: \`[{ label, energy, start, end }]\` (intro, build, drop, breakdown, outro...).
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

Scenes play back to back. Each cut is either a hard cut or a transition the user picked in the editor (crossfade,
push, wipe and so on, stored as \`transition\` on the incoming scene in project.json). During a transition the
outgoing scene holds its last frame and the incoming one holds its first, so do not animate for it.

When the user wants a seamless handoff, make the last frame of one scene match the first frame of the next
(same element positions, sizes and styles). Read the neighbouring scene file to match it exactly. Do not change a
neighbour unless asked.

Captions and sound effects are added by the editor on top of the video. Never draw captions or subtitles in a scene.

## Music

When the prompt lists beats, key important motion moments (arrivals, cuts, accents) to those times,
preferring downbeats for big moves and phrase starts for section changes. A move that "lands on" a beat
should finish at the beat, not start on it. Match energy to the music sections: calmer motion in an intro or
breakdown, the biggest moves on a drop.

## Voice-over

Narration is written per scene and spoken by the editor, so you never make audio yourself. To narrate a scene,
put the script in its meta block:

\`<script type="application/json" id="meta">{"duration": 4200, "voice": "Meet Acme. The fastest way to ship."}</script>\`

- The editor generates the speech as soon as the file is saved, places it at the start of the scene, and makes
  caption lines from it. Change the text and it is regenerated; remove the key to remove the narration.
- The narrator speaks about 2.5 words per second, so a scene fits roughly \`duration / 400\` words. Write the script
  to fit, or lengthen the scene so the line is not cut off: the audio does not stretch the scene.
- Time the motion to the words: a key word should be on screen around when it is spoken. The prompt tells you the
  audio length once it exists.
- The project narrator is "${p.narrator.voice}". For one scene in a different voice use the object form:
  \`"voice": {"text": "...", "voice": "bm_fable", "speed": 1}\`.${p.narrator.shortlist.length ? ` The user shortlisted these voices, so
  prefer them: ${p.narrator.shortlist.join(', ')}.` : ''} Voices: af_heart (US female, warm), af_sarah (US female, neutral),
  bm_fable (UK male, crisp). No others. Speed 0.7-1.3.
- When asked to write a voice-over for the whole video, give every scene a script that flows as one piece,
  and only add narration to scenes the user asked about.

## Reference images

When the prompt lists attached images, Read every one before changing anything. They show what the user wants
(a layout, a style, a screenshot to recreate, a logo to use). Say briefly how you used them.

${p.visualChecks ? visualSection() : ''}## Quality bar

Motion should feel like a polished product-launch video: confident easing (outExpo/outQuint for arrivals,
inOutCubic for travel), restrained timing, crisp typography, generous whitespace, subtle depth. Nothing jitters,
nothing pops without intent, and no element sits still in an awkward half-state.

${kit ? brandSection(p, kit) : ''}${allCodebases(p).length ? codebaseSection(p) : ''}${p.app ? appSection(p) : ''}## Art direction

${art || '_No project art direction set yet. Default to a clean, minimal, black-on-white product aesthetic with Inter._'}
`
  await fs.writeFile(join(STORAGE, p.id, 'CLAUDE.md'), md)
  await fs.writeFile(join(STORAGE, p.id, 'bower.mjs'), BOWER_TOOL)
}
