import { readSettings } from './settings'
import type { Project } from './store'

// Which Claude model each kind of work uses. A project can set one per task; unset falls back to the default in
// Bower settings, then BOWER_MODEL, then Claude Code's own default.
export const MODELS = ['opus', 'sonnet', 'haiku']
export type ModelTask = 'plan' | 'build' | 'chat'
export const MODEL_TASKS: ModelTask[] = ['plan', 'build', 'chat']
export type ProjectModels = Partial<Record<ModelTask, string>>

export const isModel = (m: unknown): m is string => typeof m === 'string' && MODELS.includes(m)

export async function pickModel(task: ModelTask, p: Pick<Project, 'models'> | null, override?: string) {
  if (isModel(override)) return override
  const own = p?.models?.[task]
  if (isModel(own)) return own
  return (await readSettings()).model ?? process.env.BOWER_MODEL
}

// Short read-and-summarise jobs (codebase scans, app notes) do not need the biggest model.
export const lightModel = (fallback: 'sonnet' | 'haiku') => process.env.BOWER_MODEL || fallback

// Keeps only known tasks with known models; anything else means "use the default".
export function cleanModels(raw: unknown): ProjectModels {
  const out: ProjectModels = {}
  if (raw && typeof raw === 'object') for (const t of MODEL_TASKS) if (isModel((raw as any)[t])) out[t] = (raw as any)[t]
  return out
}
