<script setup lang="ts">
import type { SceneParam } from '~/composables/useEditor'
import type { Timing, TimingStart } from '~/composables/useSceneEdit'
import { TRACK_PROPS, type TrackKey, type TrackValue } from '#shared/utils/tracks'
import { describeIndexed, describeSelector, listLayers, type LayerItem } from '~/utils/stageEdit'
import { PRESETS } from '~/utils/presets'

// Editing the selected scene by hand. Layer: the scene's elements, and for the picked one an After Effects-style
// inspector (transform and style values with keyframes), animation presets and its keyframes on a timeline.
// Scene: the scene's settings (params), its text and the timings in its code. Changes stay unsaved until Save.
const ed = useEditor()
const { project, selected, mode, time } = ed
const edit = useSceneEdit()
const layer = useLayerEdit()
const chat = useChat()
const toast = useToast()

const pid = computed(() => project.value?.id ?? '')
const sid = computed(() => selected.value?.id ?? '')
const busy = computed(() => !!pid.value && (chat.isBusy(pid.value, sid.value) || chat.isBusy(pid.value, 'project')))
const disabled = computed(() => busy.value || edit.saving.value)
const src = computed(() => edit.source.value?.sceneId === sid.value ? edit.source.value : null)
const codeOpen = ref(false)
const tab = ref<'layer' | 'scene'>('layer')
const tabs = [{ label: 'Layer', value: 'layer', icon: 'i-lucide-layers' }, { label: 'Scene', value: 'scene', icon: 'i-lucide-clapperboard' }]

// The source is read again whenever the scene file changes (a save here, Claude, Undo).
watch([pid, sid, () => selected.value?.mtime], ([p, s]) => { if (p && s) edit.loadSource(p, s).catch(() => {}) }, { immediate: true })
watch(sid, () => { edit.picked.value = null; edit.previewValues.value = {}; selectedKey.value = null })
onBeforeUnmount(() => { edit.picked.value = null })

const picked = computed(() => edit.picked.value?.sceneId === sid.value ? edit.picked.value : null)
watch(() => picked.value?.selector, (s) => { if (s) tab.value = 'layer'; selectedKey.value = null })

// Layers, read from the preview frame each time it loads.
const layers = ref<LayerItem[]>([])
watch([edit.frameLoads, sid], () => { layers.value = listLayers(edit.frameOf(sid.value)) }, { immediate: true })
const animated = (l: LayerItem) => !!(src.value?.tracks ?? {})[l.veId ?? `css:${l.selector}`]
function pickLayer(l: LayerItem) {
  const p = describeSelector(edit.frameOf(sid.value), sid.value, l.selector)
  if (p) edit.picked.value = p
}

// Inspector.
const transformProps = computed(() => TRACK_PROPS.filter(p => p.group === 'transform' && (p.name !== 'typed' || picked.value?.plain)))
const styleProps = TRACK_PROPS.filter(p => p.group === 'style')
const hasOwn = (name: string) => layer.props.value[name] !== undefined
const keyedRows = computed(() => TRACK_PROPS.filter(p => layer.isKeyed(p.name)).map(p => ({ name: p.name, label: p.label, keys: layer.keysOf(p.name), factor: p.factor, unit: p.unit })))
const selectedKey = ref<{ name: string, index: number } | null>(null)
const selKey = computed(() => selectedKey.value ? layer.keysOf(selectedKey.value.name)[selectedKey.value.index] ?? null : null)
const selDef = computed(() => TRACK_PROPS.find(p => p.name === selectedKey.value?.name))

function editKey(change: Partial<{ ms: number, value: TrackValue, ease: string }>) {
  const s = selectedKey.value
  if (!s) return
  const keys = layer.keysOf(s.name).map((k, i) => {
    if (i !== s.index) return k
    const next: TrackKey = [change.ms ?? k[0], change.value ?? k[1]]
    const ease = change.ease ?? k[2]
    if (ease) next.push(ease)
    return next
  })
  layer.setKeys(s.name, keys)
}
function deleteKey() {
  const s = selectedKey.value
  if (!s) return
  selectedKey.value = null
  layer.setKeys(s.name, layer.keysOf(s.name).filter((_, i) => i !== s.index))
}

// The layer's name: data-ve-name on its element (markup elements only).
const nameDraft = ref('')
watch(picked, (p) => { nameDraft.value = p?.name ?? '' }, { immediate: true })
async function saveName() {
  const p = picked.value
  const name = nameDraft.value.trim()
  if (!p || p.index === null || !name || name === p.name || edit.saving.value) return
  await edit.apply(pid.value, sid.value, { op: 'name', index: p.index, name })
}

function showInCode(index: number) {
  edit.showInCode.value = { index, n: Date.now() }
  codeOpen.value = true
}

// Settings: what is shown is the value being previewed, else the saved one.
const params = computed<SceneParam[]>(() => selected.value?.params ?? [])
const valueOf = (p: SceneParam) => p.name in edit.previewValues.value ? edit.previewValues.value[p.name] as SceneParam['value'] : p.value
function preview(p: SceneParam, v: unknown) {
  edit.previewParams(sid.value, { ...edit.previewValues.value, [p.name]: v })
}
async function commit(p: SceneParam, v: unknown) {
  if (p.type === 'number') v = Number(v)
  if (v === p.value) return
  preview(p, v)
  await edit.apply(pid.value, sid.value, { op: 'params', values: { [p.name]: v } })
}
const numberStep = (p: SceneParam) => p.step ?? (p.max !== undefined && p.min !== undefined && p.max - p.min <= 2 ? 0.01 : 1)

// A double-click in the preview on text a setting drives brings its field into view.
const paramBox = ref<HTMLElement>()
watch(edit.focusParam, async (f) => {
  if (!f) return
  tab.value = 'scene'
  await nextTick()
  const el = paramBox.value?.querySelector<HTMLElement>(`[data-param="${CSS.escape(f.name)}"]`)
  el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  el?.querySelector<HTMLElement>('input, textarea')?.focus()
})

// Text written in the markup, each piece retypable.
async function saveText(t: { i: number, text: string }, value: string) {
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text || text === t.text) return
  await edit.apply(pid.value, sid.value, { op: 'text', i: t.i, before: t.text, text })
}
// Outlines the element in the preview, described as a click on it would be (a selector that exists in the file).
function pickText(i: number) {
  const p = describeIndexed(edit.frameOf(sid.value), sid.value, i)
  if (p) edit.picked.value = p
}

// The picked element's own text, when it can be retyped.
const pickedDraft = ref('')
watch(picked, (p) => { pickedDraft.value = p?.text ?? '' }, { immediate: true })
async function savePicked() {
  const p = picked.value
  const text = pickedDraft.value.replace(/\s+/g, ' ').trim()
  if (!p || !text || text === p.text || edit.saving.value) return
  const ok = await edit.apply(pid.value, sid.value, p.index !== null ? { op: 'text', i: p.index, before: p.text, text } : { op: 'codeText', before: p.text, text })
  if (ok) edit.picked.value = { ...p, text }
}

async function onTiming(t: Timing, next: { start: TimingStart, dur: number, ease: string | null }) {
  await edit.apply(pid.value, sid.value, { op: 'timing', offset: t.offset, match: t.match, ...next })
}
async function onDuration(ms: number) {
  await edit.apply(pid.value, sid.value, { op: 'duration', ms })
}

// Unsaved hand edits on this scene.
const draft = computed(() => project.value?.drafts?.[sid.value] ?? null)
const confirmDiscard = ref(false)
watch(sid, () => { confirmDiscard.value = false })

defineShortcuts({
  meta_s: {
    usingInput: true,
    handler: () => { if (draft.value && !codeOpen.value && !busy.value && !edit.saving.value) edit.draft(pid.value, sid.value, 'save') }
  }
})

// Undo takes back the latest unsaved change first, then saved versions.
async function undo() {
  if (draft.value) return edit.draft(pid.value, sid.value, 'undo')
  try {
    ed.setProject(await $fetch(`/api/projects/${pid.value}/scenes/${sid.value}/undo`, { method: 'POST' }))
  } catch (e: any) {
    toast.add({ title: 'Nothing to undo', description: e?.data?.message, color: 'neutral' })
  }
}

async function addSettings() {
  try {
    await chat.send(pid.value, sid.value, 'Expose the values in this scene that someone would want to tweak by hand as params in the meta block: its key colours, sizes and amounts, and any copy the script builds. Read them with VE.param inside render(t), and make sure text in the markup is plain text and timings are plain numbers (see "Settings people can change" in CLAUDE.md). Keep how the scene looks and moves exactly the same.')
    edit.sideTab.value = 'chat'
  } catch (e: any) {
    toast.add({ title: 'Could not start Claude', description: e?.data?.message, color: 'error' })
  }
}
const fmt = (ms: number) => `${(ms / 1000).toFixed(2)}s`
</script>

<template>
  <div v-if="project && selected" class="flex min-h-0 flex-col">
    <div class="flex items-center gap-2 border-b border-default px-4 py-2.5">
      <UTabs v-model="tab" :items="tabs" :content="false" size="xs" color="neutral" class="w-auto" />
      <span class="min-w-0 flex-1" />
      <UIcon v-if="edit.saving.value" name="i-heroicons-arrow-path" class="size-4 animate-spin text-muted" />
      <UTooltip :text="draft ? 'Take back the latest unsaved change' : 'Undo the last change to this scene, by hand or by Claude'">
        <UButton size="sm" color="neutral" variant="outline" icon="i-heroicons-arrow-uturn-left" label="Undo" :disabled="disabled" @click="undo" />
      </UTooltip>
      <UButton size="sm" color="neutral" variant="outline" icon="i-heroicons-code-bracket" label="Code" :disabled="disabled" @click="codeOpen = true" />
    </div>

    <!-- Nothing is saved until Save: the preview shows the changes, renders and Claude see the saved scene. -->
    <div v-if="draft" class="flex items-center gap-2 border-b border-default bg-warning/10 px-4 py-2">
      <UIcon name="i-heroicons-pencil" class="size-4 shrink-0 text-warning" />
      <span class="min-w-0 flex-1 truncate text-sm" :title="draft.labels.map(l => l.replace(/^By hand:\s*/, '')).join('\n')">
        <template v-if="confirmDiscard">Discard {{ draft.count === 1 ? 'this change' : `these ${draft.count} changes` }}?</template>
        <template v-else>{{ draft.count }} unsaved {{ draft.count === 1 ? 'change' : 'changes' }}</template>
      </span>
      <template v-if="confirmDiscard">
        <UButton size="sm" color="neutral" variant="ghost" label="Keep" @click="confirmDiscard = false" />
        <UButton size="sm" color="error" label="Discard" :disabled="edit.saving.value" @click="confirmDiscard = false; edit.draft(pid, sid, 'discard')" />
      </template>
      <template v-else>
        <UButton size="sm" color="neutral" variant="ghost" label="Discard" :disabled="edit.saving.value" @click="confirmDiscard = true" />
        <UButton size="sm" icon="i-heroicons-check" label="Save" :kbds="['meta', 's']" :loading="edit.saving.value" :disabled="busy" @click="edit.draft(pid, sid, 'save')" />
      </template>
    </div>

    <UEmpty
      v-if="mode !== 'scene'"
      variant="naked"
      icon="i-heroicons-pencil-square"
      title="Edit one scene at a time"
      description="Switch the preview to This scene to edit it."
      :actions="[{ label: 'Edit this scene', color: 'neutral', onClick: () => ed.setMode('scene') }]"
      class="mt-6"
    />

    <div v-else class="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
      <UAlert v-if="busy" color="info" variant="subtle" icon="i-heroicons-arrow-path" title="Claude is working on this scene" description="Editing comes back when it has finished, so your changes and Claude's don't overwrite each other." :ui="{ icon: 'animate-spin' }" />

      <template v-if="tab === 'layer'">
        <!-- The scene's elements. -->
        <section>
          <h3 class="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">Layers</h3>
          <div class="max-h-48 overflow-y-auto rounded-lg py-1 ring-1 ring-default">
            <button
              v-for="l in layers"
              :key="l.selector"
              type="button"
              class="flex w-full items-center gap-1.5 py-1 pr-2 text-left text-sm hover:bg-elevated"
              :class="picked?.selector === l.selector && 'bg-primary/10 text-highlighted'"
              :style="{ paddingLeft: `${8 + l.depth * 14}px` }"
              @click="pickLayer(l)"
            >
              <UIcon :name="l.tag === 'svg' ? 'i-lucide-shapes' : l.tag === 'img' ? 'i-lucide-image' : l.tag === 'video' ? 'i-lucide-film' : 'i-lucide-square'" class="size-3.5 shrink-0 text-dimmed" />
              <span class="min-w-0 flex-1 truncate">{{ l.name }}</span>
              <UIcon v-if="animated(l)" name="i-lucide-diamond" class="size-3 shrink-0 text-primary" />
            </button>
            <p v-if="!layers.length" class="px-3 py-2 text-sm text-muted">The preview is loading.</p>
          </div>
        </section>

        <template v-if="picked">
          <!-- The picked layer. -->
          <section class="space-y-2">
            <div class="flex items-center gap-1.5">
              <UInput v-if="picked.index !== null" v-model="nameDraft" size="sm" class="min-w-0 flex-1" :ui="{ base: 'font-semibold' }" aria-label="Layer name" :disabled="disabled" @keydown.enter="($event.target as HTMLInputElement).blur()" @blur="saveName" />
              <span v-else class="min-w-0 flex-1 truncate font-semibold" :title="`Created by the scene's script: ${picked.selector}`">{{ picked.name }}</span>
              <UTooltip v-if="picked.index !== null" text="Show in code"><UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-code" aria-label="Show in code" @click="showInCode(picked.index)" /></UTooltip>
              <UTooltip text="Ask Claude about this"><UButton size="xs" color="neutral" variant="ghost" icon="i-heroicons-sparkles" aria-label="Ask Claude about this" :disabled="busy" @click="edit.askClaude(picked)" /></UTooltip>
              <UTooltip text="Clear"><UButton size="xs" color="neutral" variant="ghost" icon="i-heroicons-x-mark" aria-label="Clear the picked element" @click="edit.picked.value = null" /></UTooltip>
            </div>
            <p v-if="picked.param" class="text-sm">Its text comes from the <strong>{{ params.find(p => p.name === picked!.param)?.label ?? picked.param }}</strong> setting (Scene tab).</p>
            <UInput v-else-if="picked.plain" v-model="pickedDraft" size="sm" class="w-full" :disabled="disabled" aria-label="Text of the picked element" @keydown.enter="($event.target as HTMLInputElement).blur()" @blur="savePicked" />
          </section>

          <!-- Presets add keyframes at the playhead. -->
          <section>
            <h3 class="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">Animate <span class="font-normal normal-case">at {{ fmt(layer.now.value) }}</span></h3>
            <div class="flex flex-wrap gap-1">
              <UButton v-for="p in PRESETS.filter(x => x.kind === 'in' && (x.id !== 'typewriter' || picked!.plain))" :key="p.id" size="xs" color="neutral" variant="soft" :icon="p.icon" :label="p.label" :disabled="disabled" @click="layer.applyPreset(p)" />
            </div>
            <div class="mt-1 flex flex-wrap gap-1">
              <UButton v-for="p in PRESETS.filter(x => x.kind === 'out')" :key="p.id" size="xs" color="neutral" variant="outline" :icon="p.icon" :label="p.label" :disabled="disabled" @click="layer.applyPreset(p)" />
            </div>
          </section>

          <section>
            <div class="mb-1.5 flex items-center gap-1">
              <h3 class="flex-1 text-xs font-semibold tracking-wide text-muted uppercase">Transform</h3>
              <UTooltip text="Previous keyframe"><UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-chevron-left" aria-label="Previous keyframe" :disabled="!layer.keyTimes.value.length" @click="layer.jump(-1)" /></UTooltip>
              <UTooltip text="Next keyframe"><UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-chevron-right" aria-label="Next keyframe" :disabled="!layer.keyTimes.value.length" @click="layer.jump(1)" /></UTooltip>
              <UTooltip text="Take every keyframe and change off this layer"><UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-rotate-ccw" aria-label="Reset layer" :disabled="disabled || !Object.keys(layer.props.value).length" @click="layer.reset()" /></UTooltip>
            </div>
            <div class="space-y-1">
              <PropField
                v-for="d in transformProps"
                :key="d.name"
                :def="d"
                :value="layer.valueAt(d.name)"
                :keyed="layer.isKeyed(d.name)"
                :at-key="layer.keyAtNow(d.name) >= 0"
                :set="hasOwn(d.name)"
                :disabled="disabled"
                @live="v => layer.set(d.name, v, 'live')"
                @commit="v => layer.set(d.name, v, 'commit')"
                @stopwatch="layer.toggleKeyed(d.name)"
                @diamond="layer.toggleKey(d.name)"
                @clear="layer.setKeys(d.name, [])"
              />
            </div>
            <p class="mt-1.5 text-xs text-dimmed">Drag the element in the preview to move it, a corner to scale, the round handle to rotate (Shift snaps).</p>
          </section>

          <section>
            <h3 class="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">Style</h3>
            <div class="space-y-1">
              <PropField
                v-for="d in styleProps"
                :key="d.name"
                :def="d"
                :value="layer.valueAt(d.name)"
                :keyed="layer.isKeyed(d.name)"
                :at-key="layer.keyAtNow(d.name) >= 0"
                :set="hasOwn(d.name)"
                :disabled="disabled"
                @live="v => layer.set(d.name, v, 'live')"
                @commit="v => layer.set(d.name, v, 'commit')"
                @stopwatch="layer.toggleKeyed(d.name)"
                @diamond="layer.toggleKey(d.name)"
                @clear="layer.setKeys(d.name, [])"
              />
            </div>
          </section>

          <!-- Keyframes of this layer. -->
          <section v-if="keyedRows.length">
            <h3 class="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">Keyframes</h3>
            <KeyframeLanes
              :rows="keyedRows"
              :duration="selected.duration"
              :time="time"
              :fps="project.fps"
              :selected="selectedKey"
              :disabled="disabled"
              @select="(name, index) => { selectedKey = { name, index } }"
              @change="(name, keys) => layer.setKeys(name, keys)"
              @seek="ms => { ed.pause(); ed.seek(ms) }"
            />
            <div v-if="selKey && selDef" class="mt-2 space-y-2 rounded-lg p-3 ring-1 ring-default">
              <div class="flex items-center gap-2 text-sm">
                <span class="size-2.5 rotate-45 bg-primary" />
                <span class="flex-1 font-medium">{{ selDef.label }} at {{ fmt(selKey[0]) }}</span>
                <UButton size="xs" color="error" variant="ghost" icon="i-heroicons-trash" label="Delete" :disabled="disabled" @click="deleteKey" />
              </div>
              <div class="flex items-end gap-2">
                <UFormField label="Time (ms)" size="xs">
                  <UInput :model-value="selKey[0]" type="number" min="0" step="10" size="xs" class="w-24" :disabled="disabled" @change="editKey({ ms: Math.max(0, Number(($event.target as HTMLInputElement).value) || 0) })" />
                </UFormField>
                <UFormField v-if="selDef.kind === 'number'" :label="`Value${selDef.unit ? ` (${selDef.unit})` : ''}`" size="xs">
                  <UInput :model-value="Math.round(Number(selKey[1]) * (selDef.factor ?? 1) * 1000) / 1000" type="number" :step="(selDef.step ?? 1) * (selDef.factor ?? 1)" size="xs" class="w-24" :disabled="disabled" @change="editKey({ value: (Number(($event.target as HTMLInputElement).value) || 0) / (selDef.factor ?? 1) })" />
                </UFormField>
              </div>
              <EaseEditor v-if="selectedKey!.index > 0" :model-value="selKey[2]" :disabled="disabled" @update:model-value="v => editKey({ ease: v })" />
              <p v-else class="text-xs text-muted">The first keyframe holds until the next one. Easing is set on the keyframe the value travels into.</p>
            </div>
          </section>
        </template>
        <p v-else class="text-sm text-muted">
          Pick a layer above or click something in the preview. Drag it to move it, double-click text to retype it, and use the inspector to keyframe it.
        </p>
      </template>

      <template v-else>
        <!-- Settings the scene exposes. -->
        <section ref="paramBox">
          <h3 class="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Settings</h3>
          <div v-if="params.length" class="space-y-3">
            <div v-for="p in params" :key="p.name" :data-param="p.name">
              <div class="mb-1 flex items-center justify-between gap-2">
                <label :for="`param-${p.name}`" class="text-sm font-medium text-default">{{ p.label }}</label>
                <span v-if="p.type === 'number'" class="font-mono text-xs text-muted tabular-nums">{{ valueOf(p) }}{{ p.unit ?? '' }}</span>
              </div>
              <UTextarea
                v-if="p.type === 'text'"
                :id="`param-${p.name}`"
                :model-value="String(valueOf(p))"
                :rows="1"
                autoresize
                class="w-full"
                :disabled="disabled"
                @update:model-value="v => preview(p, v)"
                @blur="commit(p, ($event.target as HTMLTextAreaElement).value)"
                @keydown.enter.exact.prevent="($event.target as HTMLTextAreaElement).blur()"
              />
              <div v-else-if="p.type === 'color'" class="flex items-center gap-2">
                <input
                  :id="`param-${p.name}`"
                  type="color"
                  :value="String(valueOf(p)).slice(0, 7)"
                  class="h-8 w-10 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                  :disabled="disabled"
                  @input="preview(p, ($event.target as HTMLInputElement).value)"
                  @change="commit(p, ($event.target as HTMLInputElement).value)"
                >
                <UInput :model-value="String(valueOf(p))" size="sm" class="w-32 font-mono" :disabled="disabled" @change="commit(p, ($event.target as HTMLInputElement).value)" />
              </div>
              <div v-else-if="p.type === 'number'" class="flex items-center gap-2">
                <input
                  :id="`param-${p.name}`"
                  type="range"
                  :min="p.min ?? 0"
                  :max="p.max ?? Math.max(100, Number(p.value) * 2)"
                  :step="numberStep(p)"
                  :value="Number(valueOf(p))"
                  class="min-w-0 flex-1 accent-(--ui-primary)"
                  :disabled="disabled"
                  @input="preview(p, Number(($event.target as HTMLInputElement).value))"
                  @change="commit(p, ($event.target as HTMLInputElement).value)"
                >
                <UInput :model-value="Number(valueOf(p))" type="number" :step="numberStep(p)" size="sm" class="w-24" :disabled="disabled" @change="commit(p, ($event.target as HTMLInputElement).value)" />
              </div>
              <USwitch v-else-if="p.type === 'boolean'" :id="`param-${p.name}`" :model-value="!!valueOf(p)" :disabled="disabled" @update:model-value="v => commit(p, v)" />
              <USelect v-else-if="p.type === 'select'" :id="`param-${p.name}`" :model-value="String(valueOf(p))" :items="p.options ?? []" class="w-full" :disabled="disabled" @update:model-value="v => commit(p, v)" />
            </div>
          </div>
          <div v-else class="space-y-2">
            <p class="text-sm text-muted">This scene has no settings yet. Claude can expose the values worth tweaking, like colours, sizes and copy, as settings you change here.</p>
            <UButton size="sm" color="neutral" variant="outline" icon="i-heroicons-sparkles" label="Ask Claude to add settings" :disabled="busy" @click="addSettings" />
          </div>
        </section>

        <!-- Text in the scene's markup. -->
        <section v-if="src?.texts.length">
          <h3 class="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Text</h3>
          <div class="space-y-1.5">
            <UInput
              v-for="t in src.texts"
              :key="`${src.hash}-${t.i}`"
              :model-value="t.text"
              size="sm"
              class="w-full"
              :disabled="disabled"
              :aria-label="`Text: ${t.text}`"
              @focus="pickText(t.i)"
              @keydown.enter="($event.target as HTMLInputElement).blur()"
              @blur="saveText(t, ($event.target as HTMLInputElement).value)"
            />
          </div>
        </section>

        <!-- Animation timings written in the scene's code. -->
        <section v-if="src">
          <h3 class="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Timing in code</h3>
          <TimingEditor
            :timings="src.timings"
            :computed="src.computed"
            :duration="selected.duration"
            :time="time"
            :disabled="disabled"
            @change="onTiming"
            @duration="onDuration"
            @seek="ms => ed.seek(ms)"
          />
        </section>
      </template>

      <p class="text-xs text-dimmed">Changes show in the preview straight away and stay unsaved until you click Save, which keeps them all as one version marked “By hand”. Renders and Claude use the saved scene.</p>
    </div>

    <CodeEditorModal v-model:open="codeOpen" :scene="selected" />
  </div>
</template>
