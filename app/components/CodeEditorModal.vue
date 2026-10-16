<script setup lang="ts">
import { EditorView, basicSetup } from 'codemirror'
import { EditorSelection } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { html as htmlLang } from '@codemirror/lang-html'
import { javascriptLanguage } from '@codemirror/lang-javascript'
import { syntaxHighlighting } from '@codemirror/language'
import { lintGutter, setDiagnostics } from '@codemirror/lint'
import type { CompletionContext } from '@codemirror/autocomplete'
import { classHighlighter } from '@lezer/highlight'
import type { SceneView } from '~/composables/useEditor'

// The scene in a code editor, with a preview of the code beside it. Apply (Ctrl+S) adds it to the scene's unsaved
// hand edits; Save in the Edit by hand panel keeps them as a version. A bar jumps between the file's parts, Show in
// code (from the Layer tab) opens it at an element, VE. autocompletes, Format tidies it and errors are marked on
// their line.
const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ scene: SceneView }>()

const { project, time } = useEditor()
const edit = useSceneEdit()
const toast = useToast()

const host = ref<HTMLElement>()
const frame = ref<HTMLIFrameElement>()
let view: EditorView | null = null
const saved = ref('')
const draft = ref('')
const dirty = computed(() => draft.value !== saved.value)
const confirmDiscard = ref(false)
const previewError = ref<{ message: string, line: number | null } | null>(null)
const previewTime = ref(0)
const playing = ref(false)
// Lines of the preview document before the scene's own code, to turn an error's line into one of this file.
let prefixLines = 0

const draftDuration = computed(() => {
  const m = draft.value.match(/<script[^>]*id=["']meta["'][^>]*>([\s\S]*?)<\/script>/i)
  try { return Math.max(100, Number(JSON.parse(m?.[1] ?? '{}').duration) || 3000) } catch { return props.scene.duration }
})

// The parts of the file, for the bar above the code.
const sections = computed(() => {
  const s = draft.value
  const out: { label: string, at: number }[] = []
  const meta = s.search(/<script[^>]*id=["']meta["']/i)
  if (meta >= 0) out.push({ label: 'Settings and keyframes', at: meta })
  const style = s.search(/<style[\s>]/i)
  if (style >= 0) out.push({ label: 'Style', at: style })
  const markup = /<(?!script|style|!--)[a-z][\w-]*[\s>]/gi
  let m: RegExpExecArray | null
  while ((m = markup.exec(s))) {
    // The first element outside a script or style block.
    const before = s.slice(0, m.index)
    const open = (before.match(/<(script|style)[\s>]/gi) ?? []).length, closed = (before.match(/<\/(script|style)>/gi) ?? []).length
    if (open === closed) { out.push({ label: 'Markup', at: m.index }); break }
  }
  const re = /<script(?![^>]*id=["']meta["'])[^>]*>/gi
  while ((m = re.exec(s))) out.push({ label: out.some(x => x.label === 'Script') ? 'Script 2' : 'Script', at: m.index })
  return out.sort((a, b) => a.at - b.at)
})

function goTo(from: number, to = from) {
  if (!view) return
  view.dispatch({ selection: EditorSelection.range(from, to), effects: EditorView.scrollIntoView(from, { y: 'start', yMargin: 24 }) })
  view.focus()
}

function goToLine(n: number) {
  if (!view || n < 1 || n > view.state.doc.lines) return
  const l = view.state.doc.line(n)
  goTo(l.from, l.to)
}

// VE.* completions with a line of help each.
const VE_DOCS: [string, string][] = [
  ['progress(t, start, dur, ease)', 'Eased 0..1 of an animation starting at start ms, lasting dur ms'],
  ['tween(t, [[ms, value], ...], ease)', 'Keyframes: values may be numbers or arrays'],
  ['stagger(i, stepMs, startMs)', 'Start time for item i'],
  ['lerp(a, b, p)', 'Blend from a to b by p'],
  ['clamp(v, min, max)', 'Keep v between min and max (0..1 by default)'],
  ['param(name, fallback)', 'A setting from the meta block\'s "params"'],
  ['$(selector)', 'The first matching element'],
  ['$$(selector)', 'Every matching element, as an array'],
  ['ease', 'linear, in/out/inOut Quad, Cubic, Quart, Quint, Expo, outBack, inOutBack, spring'],
  ['duration', 'The scene\'s length in ms'],
  ['width', 'Stage width in px'],
  ['height', 'Stage height in px'],
  ['beats', 'Music beats in scene ms'],
  ['downbeats', 'Music downbeats in scene ms'],
  ['phrases', 'Music phrase starts in scene ms'],
  ['sections', 'Music sections overlapping the scene'],
  ['snap(ms, grid)', 'Nearest beat, downbeat or phrase'],
  ['type(el, text, t, start, cps)', 'Types text into an element over time'],
  ['ui(selector)', 'Reach inside a live UI snapshot'],
  ['scene({ render(t) { } })', 'Declare the scene']
]
function veCompletions(ctx: CompletionContext) {
  const word = ctx.matchBefore(/VE\.[\w$]*/)
  if (!word) return null
  return {
    from: word.from + 3,
    options: VE_DOCS.map(([sig, info]) => ({ label: sig.replace(/\(.*$/, ''), detail: sig.includes('(') ? sig.slice(sig.indexOf('(')) : '', info, type: sig.includes('(') ? 'function' : 'property' })),
    validFor: /^[\w$]*$/
  }
}

watch(open, async (o) => {
  if (!o) { stop(); view?.destroy(); view = null; return }
  confirmDiscard.value = false
  previewError.value = null
  previewTime.value = Math.min(time.value, props.scene.duration)
  const src = await edit.loadSource(project.value!.id, props.scene.id)
  saved.value = draft.value = src.source
  await nextTick()
  if (!host.value) return
  view = new EditorView({
    parent: host.value,
    doc: src.source,
    extensions: [
      basicSetup,
      htmlLang(),
      javascriptLanguage.data.of({ autocomplete: veCompletions }),
      syntaxHighlighting(classHighlighter),
      lintGutter(),
      EditorView.lineWrapping,
      keymap.of([
        indentWithTab,
        { key: 'Mod-s', preventDefault: true, run: () => { save(); return true } },
        { key: 'Shift-Alt-f', preventDefault: true, run: () => { format(); return true } }
      ]),
      EditorView.updateListener.of((u) => { if (u.docChanged) draft.value = u.state.doc.toString() }),
      EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '13px' } })
    ]
  })
  // Show in code: the element's tag, selected.
  const want = edit.showInCode.value
  const el = want && Date.now() - want.n < 5000 ? src.elements.find(e => e.i === want.index) : null
  edit.showInCode.value = null
  if (el) goTo(el.start, Math.max(el.start, src.source.indexOf('>', el.start) + 1))
  else view.focus()
  renderPreview()
})

// The preview follows the code a moment after typing stops.
let timer: ReturnType<typeof setTimeout>
watch(draft, () => {
  clearTimeout(timer)
  timer = setTimeout(renderPreview, 450)
})

async function renderPreview() {
  if (!open.value || !frame.value) return
  try {
    const doc = await $fetch<string>(`/api/projects/${project.value!.id}/scenes/${props.scene.id}/preview`, { method: 'POST', body: { html: draft.value }, responseType: 'text' })
    const at = doc.indexOf('<div id="stage">\n')
    prefixLines = at < 0 ? 0 : doc.slice(0, at + '<div id="stage">\n'.length).split('\n').length - 1
    showError(null)
    frame.value.srcdoc = doc
  } catch (e: any) {
    showError({ message: e?.data?.message || e?.message || 'Could not build the preview', line: null })
  }
}

// An error from the preview, marked on its line in the code.
function showError(err: { message: string, line: number | null } | null) {
  previewError.value = err
  if (!view) return
  const n = err?.line ? err.line - prefixLines : 0
  const line = n >= 1 && n <= view.state.doc.lines ? view.state.doc.line(n) : null
  if (err && line) previewError.value = { ...err, line: n }
  else if (err) previewError.value = { ...err, line: null }
  view.dispatch(setDiagnostics(view.state, err && line ? [{ from: line.from, to: line.to, severity: 'error', message: err.message }] : []))
}

function seekPreview() {
  frame.value?.contentWindow?.postMessage({ __ve: true, type: 'seek', t: previewTime.value }, '*')
}
watch(previewTime, seekPreview)

function onMessage(e: MessageEvent) {
  if (!frame.value || e.source !== frame.value.contentWindow || !e.data?.__ve) return
  if (e.data.type === 'ready') seekPreview()
  if (e.data.type === 'error') showError({ message: e.data.message, line: typeof e.data.line === 'number' ? e.data.line : null })
}
onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => { window.removeEventListener('message', onMessage); stop(); view?.destroy() })

let raf = 0, last = 0
function tick(now: number) {
  previewTime.value = (previewTime.value + (now - last)) % draftDuration.value
  last = now
  raf = requestAnimationFrame(tick)
}
function play() { if (playing.value) return stop(); playing.value = true; last = performance.now(); raf = requestAnimationFrame(tick) }
function stop() { playing.value = false; cancelAnimationFrame(raf) }

// Format: Prettier, loaded the first time it is used.
const formatting = ref(false)
async function format() {
  if (!view || formatting.value) return
  formatting.value = true
  try {
    const [prettier, html, babel, estree, postcss] = await Promise.all([
      import('prettier/standalone'), import('prettier/plugins/html'), import('prettier/plugins/babel'), import('prettier/plugins/estree'), import('prettier/plugins/postcss')
    ])
    const out = await prettier.format(view.state.doc.toString(), { parser: 'html', plugins: [html, babel, estree, postcss], printWidth: 120, semi: false, singleQuote: true, htmlWhitespaceSensitivity: 'css' })
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: out } })
  } catch (e: any) {
    toast.add({ title: 'Could not format', description: String(e?.message || e).split('\n')[0], color: 'error' })
  } finally {
    formatting.value = false
  }
}

const saving = ref(false)
async function save() {
  if (!dirty.value || saving.value) return
  saving.value = true
  const html = draft.value
  const ok = await edit.apply(project.value!.id, props.scene.id, { op: 'source', html })
  saving.value = false
  if (!ok) return
  saved.value = html
  toast.add({ title: 'Code applied', description: 'The preview shows it. Click Save in the panel to keep it.', color: 'success' })
}

function close() {
  if (dirty.value) { confirmDiscard.value = true; return }
  open.value = false
}
</script>

<template>
  <UModal
    v-model:open="open"
    :dismissible="!dirty"
    :title="`Code: ${scene.title}`"
    :description="`${scene.file}. The preview on the right follows your typing; Apply (Ctrl+S) puts it in the scene, unsaved until you click Save in the panel.`"
    :ui="{ content: 'max-w-[min(1500px,96vw)] h-[90vh]', body: 'flex min-h-0 flex-1 p-0 sm:p-0', footer: 'justify-between' }"
    :close="false"
  >
    <template #body>
      <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div class="flex min-h-0 flex-col border-r border-default">
          <div class="flex flex-wrap items-center gap-1 border-b border-default px-2 py-1.5">
            <UButton v-for="s in sections" :key="s.at" size="xs" color="neutral" variant="ghost" :label="s.label" @click="goTo(s.at)" />
            <UButton class="ml-auto" size="xs" color="neutral" variant="outline" icon="i-lucide-wand-sparkles" label="Format" :kbds="['shift', 'alt', 'f']" :loading="formatting" @click="format" />
          </div>
          <div ref="host" class="code-editor min-h-0 flex-1 overflow-hidden" />
        </div>
        <div class="flex min-h-0 flex-col gap-3 bg-muted p-4">
          <div class="relative w-full overflow-hidden rounded-md bg-white shadow-sm ring-1 ring-default" :style="{ aspectRatio: `${project!.width} / ${project!.height}` }">
            <iframe ref="frame" class="pointer-events-none absolute inset-0 size-full border-0" title="Preview of the unsaved code" />
          </div>
          <div class="flex items-center gap-3">
            <UButton color="neutral" class="rounded-full" :icon="playing ? 'i-heroicons-pause' : 'i-heroicons-play'" :aria-label="playing ? 'Pause' : 'Play'" @click="play" />
            <input v-model.number="previewTime" type="range" min="0" :max="draftDuration" step="1" class="min-w-0 flex-1 accent-(--ui-primary)" aria-label="Preview time" @pointerdown="stop">
            <span class="w-24 shrink-0 text-right font-mono text-sm tabular-nums">{{ (previewTime / 1000).toFixed(2) }} <span class="text-dimmed">/ {{ (draftDuration / 1000).toFixed(1) }}s</span></span>
          </div>
          <UAlert
            v-if="previewError"
            color="error"
            variant="subtle"
            icon="i-heroicons-exclamation-triangle"
            :title="previewError.line ? `The preview throws an error on line ${previewError.line}` : 'The preview throws an error'"
            :description="previewError.message"
            :ui="{ description: 'font-mono text-xs' }"
            :actions="previewError.line ? [{ label: 'Go to the line', size: 'xs', color: 'error', variant: 'outline', onClick: () => goToLine(previewError!.line!) }] : undefined"
          />
          <p class="text-xs text-muted">Type <code>VE.</code> for the scene helpers. Keyframes made in the inspector live in the meta block's <code>"tracks"</code>.</p>
        </div>
      </div>
    </template>
    <template #footer>
      <span class="text-xs text-muted">
        <template v-if="dirty">Not applied yet</template>
        <template v-else>Everything applied</template>
      </span>
      <div v-if="confirmDiscard" class="flex items-center gap-2">
        <span class="text-sm">Close without applying your changes?</span>
        <UButton color="neutral" variant="ghost" label="Keep editing" @click="confirmDiscard = false" />
        <UButton color="error" label="Close" @click="confirmDiscard = false; saved = draft; open = false" />
      </div>
      <div v-else class="flex items-center gap-2">
        <UButton color="neutral" variant="ghost" label="Close" @click="close" />
        <UButton icon="i-heroicons-check" label="Apply" :kbds="['meta', 's']" :loading="saving" :disabled="!dirty" @click="save" />
      </div>
    </template>
  </UModal>
</template>

<style>
/* Syntax colours from classHighlighter's tok-* classes, for light and dark mode. */
.code-editor .cm-editor { height: 100%; background: var(--ui-bg); color: var(--ui-text); }
.code-editor .cm-gutters { background: var(--ui-bg-muted); color: var(--ui-text-dimmed); border-right: 1px solid var(--ui-border); }
.code-editor .cm-activeLine, .code-editor .cm-activeLineGutter { background: color-mix(in oklab, var(--ui-bg-elevated) 70%, transparent); }
.code-editor .cm-cursor { border-left-color: var(--ui-text); }
.code-editor .cm-selectionBackground, .code-editor .cm-focused .cm-selectionBackground { background: color-mix(in oklab, var(--ui-primary) 25%, transparent) !important; }
.code-editor .cm-tooltip { background: var(--ui-bg-elevated); color: var(--ui-text); border: 1px solid var(--ui-border); }
.code-editor .cm-tooltip-autocomplete ul li[aria-selected] { background: color-mix(in oklab, var(--ui-primary) 30%, transparent); color: var(--ui-text-highlighted); }
.code-editor .tok-keyword { color: #7c3aed; }
.code-editor .tok-string, .code-editor .tok-string2 { color: #15803d; }
.code-editor .tok-number, .code-editor .tok-bool, .code-editor .tok-atom { color: #c2410c; }
.code-editor .tok-comment { color: #71717a; font-style: italic; }
.code-editor .tok-typeName, .code-editor .tok-tagName { color: #be123c; }
.code-editor .tok-propertyName, .code-editor .tok-attributeName { color: #1d4ed8; }
.code-editor .tok-variableName.tok-definition { color: #0e7490; }
.dark .code-editor .tok-keyword { color: #c4b5fd; }
.dark .code-editor .tok-string, .dark .code-editor .tok-string2 { color: #86efac; }
.dark .code-editor .tok-number, .dark .code-editor .tok-bool, .dark .code-editor .tok-atom { color: #fdba74; }
.dark .code-editor .tok-comment { color: #a1a1aa; }
.dark .code-editor .tok-typeName, .dark .code-editor .tok-tagName { color: #fda4af; }
.dark .code-editor .tok-propertyName, .dark .code-editor .tok-attributeName { color: #93c5fd; }
.dark .code-editor .tok-variableName.tok-definition { color: #67e8f9; }
</style>
