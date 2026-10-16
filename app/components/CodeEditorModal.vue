<script setup lang="ts">
import { EditorView, basicSetup } from 'codemirror'
import { keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { html as htmlLang } from '@codemirror/lang-html'
import { syntaxHighlighting } from '@codemirror/language'
import { classHighlighter } from '@lezer/highlight'
import type { SceneView } from '~/composables/useEditor'

// The scene file in a code editor, with a preview of the unsaved code beside it. Saving (Ctrl+S) makes a version.
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
const previewError = ref('')
const previewTime = ref(0)
const playing = ref(false)

const draftDuration = computed(() => {
  const m = draft.value.match(/<script[^>]*id=["']meta["'][^>]*>([\s\S]*?)<\/script>/i)
  try { return Math.max(100, Number(JSON.parse(m?.[1] ?? '{}').duration) || 3000) } catch { return props.scene.duration }
})

watch(open, async (o) => {
  if (!o) { stop(); view?.destroy(); view = null; return }
  confirmDiscard.value = false
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
      syntaxHighlighting(classHighlighter),
      keymap.of([indentWithTab, { key: 'Mod-s', preventDefault: true, run: () => { save(); return true } }]),
      EditorView.updateListener.of((u) => { if (u.docChanged) draft.value = u.state.doc.toString() }),
      EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '13px' } })
    ]
  })
  view.focus()
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
    previewError.value = ''
    frame.value.srcdoc = doc
  } catch (e: any) {
    previewError.value = e?.data?.message || e?.message || 'Could not build the preview'
  }
}

function seekPreview() {
  frame.value?.contentWindow?.postMessage({ __ve: true, type: 'seek', t: previewTime.value }, '*')
}
watch(previewTime, seekPreview)

function onMessage(e: MessageEvent) {
  if (!frame.value || e.source !== frame.value.contentWindow || !e.data?.__ve) return
  if (e.data.type === 'ready') { previewError.value = ''; seekPreview() }
  if (e.data.type === 'error') previewError.value = e.data.message
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

const saving = ref(false)
async function save() {
  if (!dirty.value || saving.value) return
  saving.value = true
  const html = draft.value
  const ok = await edit.apply(project.value!.id, props.scene.id, { op: 'source', html })
  saving.value = false
  if (!ok) return
  saved.value = html
  toast.add({ title: 'Code saved', description: 'Saved as a new version. Undo brings back the one before.', color: 'success' })
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
    :description="`${scene.file}. The preview on the right follows your typing; Save (Ctrl+S) keeps it as a new version.`"
    :ui="{ content: 'max-w-[min(1500px,96vw)] h-[90vh]', body: 'flex min-h-0 flex-1 p-0 sm:p-0', footer: 'justify-between' }"
    :close="false"
  >
    <template #body>
      <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div ref="host" class="code-editor min-h-0 overflow-hidden border-r border-default" />
        <div class="flex min-h-0 flex-col gap-3 bg-muted p-4">
          <div class="relative w-full overflow-hidden rounded-md bg-white shadow-sm ring-1 ring-default" :style="{ aspectRatio: `${project!.width} / ${project!.height}` }">
            <iframe ref="frame" class="pointer-events-none absolute inset-0 size-full border-0" title="Preview of the unsaved code" />
          </div>
          <div class="flex items-center gap-3">
            <UButton color="neutral" class="rounded-full" :icon="playing ? 'i-heroicons-pause' : 'i-heroicons-play'" :aria-label="playing ? 'Pause' : 'Play'" @click="play" />
            <input v-model.number="previewTime" type="range" min="0" :max="draftDuration" step="1" class="min-w-0 flex-1 accent-(--ui-primary)" aria-label="Preview time" @pointerdown="stop">
            <span class="w-24 shrink-0 text-right font-mono text-sm tabular-nums">{{ (previewTime / 1000).toFixed(2) }} <span class="text-dimmed">/ {{ (draftDuration / 1000).toFixed(1) }}s</span></span>
          </div>
          <UAlert v-if="previewError" color="error" variant="subtle" icon="i-heroicons-exclamation-triangle" title="The preview throws an error" :description="previewError" :ui="{ description: 'font-mono text-xs' }" />
        </div>
      </div>
    </template>
    <template #footer>
      <span class="text-xs text-muted">
        <template v-if="dirty">Unsaved changes</template>
        <template v-else>No unsaved changes</template>
      </span>
      <div v-if="confirmDiscard" class="flex items-center gap-2">
        <span class="text-sm">Discard your unsaved changes?</span>
        <UButton color="neutral" variant="ghost" label="Keep editing" @click="confirmDiscard = false" />
        <UButton color="error" label="Discard" @click="confirmDiscard = false; saved = draft; open = false" />
      </div>
      <div v-else class="flex items-center gap-2">
        <UButton color="neutral" variant="ghost" label="Close" @click="close" />
        <UButton icon="i-heroicons-check" label="Save" :kbds="['meta', 's']" :loading="saving" :disabled="!dirty" @click="save" />
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
