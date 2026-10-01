<script setup lang="ts">
interface TrashedScene { id: string, sceneId: string, title: string, index: number, deletedAt: string, versions: number }
interface TrashedProject { id: string, projectId: string, name: string, deletedAt: string }

const open = defineModel<boolean>('open', { default: false })
const { project, setProject, select, loadProjects, openProject } = useEditor()
const toast = useToast()

const scenes = ref<TrashedScene[]>([])
const projectsList = ref<TrashedProject[]>([])
const loading = ref(false)
const confirmPurge = ref<{ kind: 'scene' | 'project', id: string, name: string } | null>(null)

async function load() {
  loading.value = true
  try {
    const res = await $fetch<{ scenes: TrashedScene[], projects: TrashedProject[] }>('/api/trash', { query: { pid: project.value?.id } })
    scenes.value = res.scenes
    projectsList.value = res.projects
  } finally {
    loading.value = false
  }
}
watch(open, (o) => { if (o) load() })

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}
const left = (iso: string) => Math.max(0, 30 - Math.floor((Date.now() - new Date(iso).getTime()) / 86400000))

async function restoreScene(s: TrashedScene) {
  try {
    const res = await $fetch<{ sceneId: string, project: any }>('/api/trash/restore', { method: 'POST', body: { kind: 'scene', id: s.id, pid: project.value!.id } })
    setProject(res.project)
    select(res.sceneId)
    toast.add({ title: `Restored "${s.title}" with ${s.versions} versions`, color: 'success' })
    await load()
  } catch (e: any) {
    toast.add({ title: 'Could not restore', description: e?.data?.message, color: 'error' })
  }
}

async function restoreProject(p: TrashedProject) {
  const res = await $fetch<{ projectId: string }>('/api/trash/restore', { method: 'POST', body: { kind: 'project', id: p.id } })
  await loadProjects()
  await openProject(res.projectId)
  toast.add({ title: `Restored "${p.name}"`, color: 'success' })
  open.value = false
}

async function purge() {
  const c = confirmPurge.value
  if (!c) return
  await $fetch('/api/trash/purge', { method: 'POST', body: { kind: c.kind, id: c.id, pid: project.value?.id } })
  confirmPurge.value = null
  await load()
}
</script>

<template>
  <UModal v-model:open="open" title="Trash" description="Deleted scenes and projects are kept for 30 days." :ui="{ content: 'max-w-xl' }">
    <template #body>
      <div class="space-y-5">
        <section>
          <h3 class="mb-2 text-sm font-semibold text-highlighted">Scenes from {{ project?.name ?? 'this project' }}</h3>
          <UEmpty v-if="!loading && !scenes.length" variant="soft" size="sm" icon="i-heroicons-trash" title="No deleted scenes" />
          <div v-else class="divide-y divide-default rounded-md ring-1 ring-default">
            <div v-for="s in scenes" :key="s.id" class="flex items-center gap-3 px-3 py-2.5">
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-highlighted">{{ s.title }}</p>
                <p class="text-xs text-muted">Deleted {{ ago(s.deletedAt) }} · {{ s.versions }} versions · {{ left(s.deletedAt) }} days left</p>
              </div>
              <UButton size="xs" color="neutral" variant="outline" icon="i-heroicons-arrow-uturn-left" label="Restore" @click="restoreScene(s)" />
              <UTooltip text="Delete forever"><UButton size="xs" color="error" variant="ghost" icon="i-heroicons-trash" @click="confirmPurge = { kind: 'scene', id: s.id, name: s.title }" /></UTooltip>
            </div>
          </div>
        </section>
        <section>
          <h3 class="mb-2 text-sm font-semibold text-highlighted">Projects</h3>
          <UEmpty v-if="!loading && !projectsList.length" variant="soft" size="sm" icon="i-heroicons-folder" title="No deleted projects" />
          <div v-else class="divide-y divide-default rounded-md ring-1 ring-default">
            <div v-for="p in projectsList" :key="p.id" class="flex items-center gap-3 px-3 py-2.5">
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-highlighted">{{ p.name }}</p>
                <p class="text-xs text-muted">Deleted {{ ago(p.deletedAt) }} · {{ left(p.deletedAt) }} days left</p>
              </div>
              <UButton size="xs" color="neutral" variant="outline" icon="i-heroicons-arrow-uturn-left" label="Restore" @click="restoreProject(p)" />
              <UTooltip text="Delete forever"><UButton size="xs" color="error" variant="ghost" icon="i-heroicons-trash" @click="confirmPurge = { kind: 'project', id: p.id, name: p.name }" /></UTooltip>
            </div>
          </div>
        </section>
      </div>

      <UModal :open="!!confirmPurge" :title="`Delete “${confirmPurge?.name}” forever?`" description="This can't be undone." :ui="{ footer: 'justify-end' }" @update:open="v => !v && (confirmPurge = null)">
        <template #footer>
          <UButton color="neutral" variant="ghost" label="Cancel" @click="confirmPurge = null" />
          <UButton color="error" label="Delete forever" @click="purge" />
        </template>
      </UModal>
    </template>
  </UModal>
</template>
