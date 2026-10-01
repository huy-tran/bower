// Project folders (virtual, nested by "/" paths) and the tree that groups projects under them.
export interface FolderNode { path: string, name: string, folders: FolderNode[], projects: { id: string, name: string, folder: string }[] }

const folders = ref<string[]>([])
let loaded = false

export const folderName = (path: string) => path.split('/').pop() || ''
export const folderLabel = (path: string) => path ? path.split('/').join(' / ') : 'Top level'
// Select controls refuse an empty value, so the top level is represented by "/" in dropdowns.
export const ROOT = '/'
export const toFolderValue = (folder: string) => folder || ROOT
export const fromFolderValue = (value: unknown) => String(value ?? '') === ROOT ? '' : String(value ?? '')

export function useFolders() {
  const ed = useEditor()
  const toast = useToast()

  async function load() {
    folders.value = await $fetch<string[]>('/api/folders')
    loaded = true
  }
  if (!loaded) load()

  // The full tree, with projects filed under their folders. Unknown folders on projects still show up.
  const tree = computed<FolderNode>(() => {
    const root: FolderNode = { path: '', name: '', folders: [], projects: [] }
    const nodes = new Map<string, FolderNode>([['', root]])
    const ensure = (path: string): FolderNode => {
      if (nodes.has(path)) return nodes.get(path)!
      const parent = ensure(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
      const node: FolderNode = { path, name: folderName(path), folders: [], projects: [] }
      parent.folders.push(node)
      nodes.set(path, node)
      return node
    }
    for (const f of folders.value) ensure(f)
    for (const p of ed.projects.value) ensure(p.folder).projects.push(p)
    const sort = (n: FolderNode) => {
      n.folders.sort((a, b) => a.name.localeCompare(b.name)).forEach(sort)
      n.projects.sort((a, b) => a.name.localeCompare(b.name))
    }
    sort(root)
    return root
  })

  const items = computed(() => [{ label: 'Top level', value: ROOT }, ...folders.value.map(f => ({ label: folderLabel(f), value: f }))])

  async function call(fn: () => Promise<{ folders: string[] }>, fail: string) {
    try {
      folders.value = (await fn()).folders
      await ed.loadProjects()
      if (ed.project.value) await ed.refresh()
      return true
    } catch (e: any) {
      toast.add({ title: fail, description: e?.data?.message || e?.message, color: 'error' })
      return false
    }
  }

  const create = (path: string) => call(() => $fetch('/api/folders', { method: 'POST', body: { path } }), 'Could not create the folder')
  const rename = (path: string, name: string) => call(() => $fetch('/api/folders', { method: 'PATCH', body: { path, name } }), 'Could not rename the folder')
  const remove = (path: string) => call(() => $fetch('/api/folders', { method: 'DELETE', query: { path } }), 'Could not delete the folder')

  async function moveProject(id: string, folderOrValue: string) {
    try {
      const view = await $fetch<any>(`/api/projects/${id}`, { method: 'PATCH', body: { folder: fromFolderValue(folderOrValue) } })
      if (ed.project.value?.id === id) ed.setProject(view)
      await ed.loadProjects()
      await load()
    } catch (e: any) {
      toast.add({ title: 'Could not move the project', description: e?.data?.message || e?.message, color: 'error' })
    }
  }

  return { folders: readonly(folders), tree, items, load, create, rename, remove, moveProject }
}
