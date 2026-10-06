// The Claude models Bower can ask for, and which one a project ends up using for each kind of work: its own pick
// (Project settings), else the default in Bower settings, else Claude Code's own.
export type ModelTask = 'plan' | 'build' | 'chat'

export const MODEL_CHOICES = [
  { label: 'Opus', value: 'opus', description: 'Most capable, uses the most tokens. Best for building scenes' },
  { label: 'Sonnet', value: 'sonnet', description: 'Strong and much lighter. Good for planning and most edits' },
  { label: 'Haiku', value: 'haiku', description: 'Fastest and lightest. Small tweaks' }
]
const NAMES: Record<string, string> = Object.fromEntries(MODEL_CHOICES.map(m => [m.value, m.label]))
export const modelName = (m?: string | null) => (m && NAMES[m]) || 'Claude Code’s default'

// The default in Bower settings, shared so every picker shows the same fallback. Loaded once, kept in step by
// the Bower settings dialog.
const bowerDefault = ref<string | null>(null)
let loading: Promise<void> | null = null

export function useModels() {
  const { project } = useEditor()
  if (!loading && import.meta.client) {
    loading = $fetch<{ model?: string }>('/api/settings')
      .then((s) => { bowerDefault.value = s.model ?? null })
      .catch(() => { loading = null })
  }

  // What this project uses for a task when nothing is picked for the request itself.
  const projectModel = (task: ModelTask) => project.value?.models?.[task] ?? bowerDefault.value
  // Picker items where `value` means "no pick here", labelled with what that falls back to.
  const withFallback = (value: string, label: string, model: string | null) => [
    { label: `${label} (${modelName(model)})`, value, description: model ? 'Change it in Project settings' : 'Set one in Project or Bower settings' },
    ...MODEL_CHOICES
  ]

  return { bowerDefault, projectModel, withFallback, setBowerDefault: (m: string | null) => { bowerDefault.value = m } }
}
