<script setup lang="ts">
// Edits brand kits (shared across projects). Which kit a project uses is chosen in the project settings.
export interface BrandKit {
  id: string
  name: string
  colors: { name: string, hex: string }[]
  fonts: { heading: string, body: string }
  notes: string
  files: { name: string, label: string }[]
}

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ kitId?: string | null }>()
const emit = defineEmits<{ change: [] }>()
const toast = useToast()

const kits = ref<BrandKit[]>([])
const editing = ref<BrandKit | null>(null)
const fileInput = ref<HTMLInputElement>()
const confirmDelete = ref(false)

// Kits in state are reactive proxies, which structuredClone refuses; a JSON copy is enough for this plain data.
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

async function load() {
  kits.value = await $fetch('/api/brand-kits')
  const want = kits.value.find(k => k.id === props.kitId) ?? kits.value[0]
  editing.value = want ? clone(want) : null
}
watch(open, (o) => { if (o) load() })

const kitItems = computed(() => kits.value.map(k => ({ label: k.name, value: k.id })))
const editId = computed({
  get: () => editing.value?.id,
  set: (id) => {
    const k = kits.value.find(x => x.id === id)
    editing.value = k ? clone(k) : null
  }
})

let timer: ReturnType<typeof setTimeout>
function save() {
  const k = editing.value
  if (!k) return
  clearTimeout(timer)
  timer = setTimeout(async () => {
    const saved = await $fetch<BrandKit>(`/api/brand-kits/${k.id}`, { method: 'PATCH', body: { name: k.name, colors: k.colors, fonts: k.fonts, notes: k.notes, files: k.files } })
    kits.value = kits.value.map(x => x.id === saved.id ? saved : x)
    emit('change')
  }, 400)
}

function addColor() {
  editing.value!.colors.push({ name: '', hex: '#111111' })
  save()
}
function removeColor(i: number) {
  editing.value!.colors.splice(i, 1)
  save()
}

// Font pickers: a short list of common families, and anything else typed in.
const fontItems = computed(() => {
  const extra = [editing.value?.fonts.heading, editing.value?.fonts.body].filter((f): f is string => !!f && !FONTS.includes(f))
  return [...FONTS, ...extra]
})
function setFont(which: 'heading' | 'body', value: string) {
  editing.value!.fonts[which] = value.trim()
  save()
}

async function upload(e: Event) {
  const files = [...((e.target as HTMLInputElement).files ?? [])]
  ;(e.target as HTMLInputElement).value = ''
  if (!files.length || !editing.value) return
  const form = new FormData()
  for (const f of files) form.append('file', f)
  try {
    const k = await $fetch<BrandKit>(`/api/brand-kits/${editing.value.id}/files`, { method: 'POST', body: form })
    editing.value.files = k.files
    kits.value = kits.value.map(x => x.id === k.id ? k : x)
    emit('change')
  } catch (err: any) {
    toast.add({ title: 'Could not upload', description: err?.data?.message, color: 'error' })
  }
}

async function removeFile(name: string) {
  const k = await $fetch<BrandKit>(`/api/brand-kits/${editing.value!.id}/files/${name}`, { method: 'DELETE' })
  editing.value!.files = k.files
  emit('change')
}

async function removeKit() {
  confirmDelete.value = false
  kits.value = await $fetch(`/api/brand-kits/${editing.value!.id}`, { method: 'DELETE' })
  editing.value = kits.value[0] ? clone(kits.value[0]) : null
  emit('change')
}
</script>

<template>
  <UModal v-model:open="open" title="Brand kit" :description="editing ? `Editing ${editing.name}. Changes save as you make them.` : 'Colours, fonts and logos shared across projects.'" :ui="{ content: 'max-w-2xl', footer: 'justify-between' }">
    <template #body>
      <input ref="fileInput" type="file" accept="image/*" multiple class="hidden" @change="upload">
      <div class="space-y-5">
        <UFormField v-if="kits.length > 1" label="Kit">
          <USelect v-model="editId" :items="kitItems" class="w-full" />
        </UFormField>

        <UEmpty v-if="!editing" variant="soft" icon="i-heroicons-swatch" title="No brand kits" description="Create one from the project settings." />

        <template v-else>
          <UFormField label="Name">
            <UInput v-model="editing.name" class="w-full" @update:model-value="save" />
          </UFormField>

          <UFormField label="Colours">
            <div class="space-y-2">
              <div v-for="(c, i) in editing.colors" :key="i" class="flex items-center gap-2">
                <UPopover>
                  <UButton color="neutral" variant="outline" class="w-28 justify-start font-mono" :label="c.hex">
                    <template #leading><span class="size-4 rounded-sm ring-1 ring-default" :style="{ background: c.hex }" /></template>
                  </UButton>
                  <template #content>
                    <UColorPicker v-model="c.hex" class="p-2" @update:model-value="save" />
                  </template>
                </UPopover>
                <UInput v-model="c.name" placeholder="e.g. Primary, Ink, Accent" class="flex-1" @update:model-value="save" />
                <UButton color="neutral" variant="ghost" icon="i-heroicons-x-mark" @click="removeColor(i)" />
              </div>
              <UButton size="sm" color="neutral" variant="outline" icon="i-heroicons-plus" label="Add colour" @click="addColor" />
            </div>
          </UFormField>

          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Heading font" help="Pick one, or type any Google Fonts family.">
              <UInputMenu :model-value="editing.fonts.heading" :items="fontItems" create-item class="w-full" @update:model-value="v => setFont('heading', String(v))" @create="v => setFont('heading', v)" />
            </UFormField>
            <UFormField label="Body font">
              <UInputMenu :model-value="editing.fonts.body" :items="fontItems" create-item class="w-full" @update:model-value="v => setFont('body', String(v))" @create="v => setFont('body', v)" />
            </UFormField>
          </div>

          <UFormField label="Logos and brand images">
            <div class="flex flex-wrap gap-3">
              <div v-for="f in editing.files" :key="f.name" class="group relative w-28">
                <div class="grid aspect-square place-items-center overflow-hidden rounded-md bg-elevated p-2 ring-1 ring-default">
                  <img :src="`/api/brand-kits/${editing.id}/files/${f.name}`" :alt="f.label" class="max-h-full max-w-full object-contain">
                </div>
                <UInput v-model="f.label" size="xs" variant="ghost" class="mt-1" @update:model-value="save" />
                <UButton class="absolute top-1 right-1 opacity-0 group-hover:opacity-100" size="xs" color="error" variant="solid" icon="i-heroicons-x-mark" @click="removeFile(f.name)" />
              </div>
              <UButton color="neutral" variant="outline" icon="i-heroicons-arrow-up-tray" label="Upload" class="aspect-square w-28 flex-col justify-center border-2 border-dashed border-accented ring-0" @click="fileInput?.click()" />
            </div>
          </UFormField>

          <UFormField label="Brand notes" help="Tone, do's and don'ts, anything Claude should know.">
            <UTextarea v-model="editing.notes" :rows="3" autoresize class="w-full" placeholder="e.g. Logo always on white with 40px clear space. Never use the accent for body text." @update:model-value="save" />
          </UFormField>
        </template>
      </div>

      <UModal v-model:open="confirmDelete" :title="`Delete the “${editing?.name}” kit?`" description="Projects using it keep working but stop following it." :ui="{ footer: 'justify-end' }">
        <template #footer>
          <UButton color="neutral" variant="ghost" label="Cancel" @click="confirmDelete = false" />
          <UButton color="error" label="Delete kit" @click="removeKit" />
        </template>
      </UModal>
    </template>
    <template #footer>
      <UButton v-if="editing" color="error" variant="ghost" icon="i-heroicons-trash" label="Delete kit" @click="confirmDelete = true" />
      <span v-else />
      <UButton color="neutral" label="Done" @click="open = false" />
    </template>
  </UModal>
</template>
