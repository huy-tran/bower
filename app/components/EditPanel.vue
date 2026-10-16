<script setup lang="ts">
import type { SceneParam } from '~/composables/useEditor'
import type { Timing, TimingStart } from '~/composables/useSceneEdit'
import { describeIndexed } from '~/utils/stageEdit'

// Editing the selected scene by hand: the element picked in the preview, the scene's settings (params), its text,
// its animation timings and its code. Every save is a version labelled "By hand", so Undo and History cover it.
const ed = useEditor()
const { project, selected, mode, time } = ed
const edit = useSceneEdit()
const chat = useChat()
const toast = useToast()

const pid = computed(() => project.value?.id ?? '')
const sid = computed(() => selected.value?.id ?? '')
const busy = computed(() => !!pid.value && (chat.isBusy(pid.value, sid.value) || chat.isBusy(pid.value, 'project')))
const disabled = computed(() => busy.value || edit.saving.value)
const src = computed(() => edit.source.value?.sceneId === sid.value ? edit.source.value : null)
const codeOpen = ref(false)

// The source is read again whenever the scene file changes (a save here, Claude, Undo).
watch([pid, sid, () => selected.value?.mtime], ([p, s]) => { if (p && s) edit.loadSource(p, s).catch(() => {}) }, { immediate: true })
watch(sid, () => { edit.picked.value = null; edit.previewValues.value = {} })
onBeforeUnmount(() => { edit.picked.value = null })

const picked = computed(() => edit.picked.value?.sceneId === sid.value ? edit.picked.value : null)

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
  const t = src.value?.texts.find(x => x.i === i)
  edit.picked.value = describeIndexed(edit.frameOf(sid.value), sid.value, i)
    ?? { sceneId: sid.value, selector: t?.tag ?? 'div', tag: t?.tag ?? '', text: t?.text ?? '', html: '', index: i, plain: true, param: null }
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

async function undo() {
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
</script>

<template>
  <div v-if="project && selected" class="flex min-h-0 flex-col">
    <div class="flex items-center gap-2 border-b border-default px-4 py-2.5">
      <span class="min-w-0 flex-1 truncate font-semibold text-highlighted">{{ selected.title }}</span>
      <UIcon v-if="edit.saving.value" name="i-heroicons-arrow-path" class="size-4 animate-spin text-muted" />
      <UTooltip text="Undo the last change to this scene, by hand or by Claude">
        <UButton size="sm" color="neutral" variant="outline" icon="i-heroicons-arrow-uturn-left" label="Undo" :disabled="disabled" @click="undo" />
      </UTooltip>
      <UButton size="sm" color="neutral" variant="outline" icon="i-heroicons-code-bracket" label="Code" :disabled="disabled" @click="codeOpen = true" />
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

    <div v-else class="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4">
      <UAlert v-if="busy" color="info" variant="subtle" icon="i-heroicons-arrow-path" title="Claude is working on this scene" description="Editing comes back when it has finished, so your changes and Claude's don't overwrite each other." :ui="{ icon: 'animate-spin' }" />

      <!-- The element picked in the preview. -->
      <section>
        <h3 class="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Picked element</h3>
        <div v-if="picked" class="space-y-2 rounded-lg p-3 ring-1 ring-default">
          <div class="flex items-center gap-2">
            <code class="min-w-0 flex-1 truncate text-xs text-muted" :title="picked.selector">{{ picked.selector }}</code>
            <UButton size="xs" color="neutral" variant="ghost" icon="i-heroicons-x-mark" aria-label="Clear the picked element" @click="edit.picked.value = null" />
          </div>
          <template v-if="picked.param">
            <p class="text-sm">This text comes from the <strong>{{ params.find(p => p.name === picked!.param)?.label ?? picked.param }}</strong> setting below.</p>
          </template>
          <UInput
            v-else-if="picked.plain"
            v-model="pickedDraft"
            class="w-full"
            :disabled="disabled"
            aria-label="Text of the picked element"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
            @blur="savePicked"
          />
          <p v-else-if="picked.text" class="line-clamp-2 text-sm text-muted">“{{ picked.text }}”</p>
          <UButton size="sm" color="primary" variant="soft" icon="i-heroicons-sparkles" label="Ask Claude about this" :disabled="busy" @click="edit.askClaude(picked)" />
        </div>
        <p v-else class="text-sm text-muted">
          Click anything in the preview to pick it. Double-click text to retype it in place (Enter saves, Esc cancels).
        </p>
      </section>

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

      <!-- Animation timings. -->
      <section v-if="src">
        <h3 class="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Timing</h3>
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

      <p class="text-xs text-dimmed">Each change is saved as a version marked “By hand”. Claude is told about them before your next message.</p>
    </div>

    <CodeEditorModal v-model:open="codeOpen" :scene="selected" />
  </div>
</template>
