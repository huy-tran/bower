import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { STORAGE } from './paths'
import { projectDir } from './store'

// What Claude Code costs: per project (tokens and cost of every run, in usage.json next to project.json) and for the
// whole Claude account (how much of the plan's 5-hour and weekly limits is used, from the last run on this machine).
// Every place that runs Claude passes its stream-json events through trackClaudeEvent.

export type UsageKind = 'chat' | 'storyboard' | 'scan' | 'notes'
export interface UsageTotals { runs: number, costUsd: number, inputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number }
export interface UsageRun extends UsageTotals { at: string, kind: UsageKind, models: string[], ok: boolean }
export interface ProjectUsage { since: string, total: UsageTotals, byKind: Partial<Record<UsageKind, UsageTotals>>, byModel: Record<string, UsageTotals>, recent: UsageRun[] }

const RECENT = 50
const zero = (): UsageTotals => ({ runs: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
const empty = (): ProjectUsage => ({ since: new Date().toISOString(), total: zero(), byKind: {}, byModel: {}, recent: [] })
const usageFile = (pid: string) => join(projectDir(pid), 'usage.json')

function add(into: UsageTotals, t: UsageTotals) {
  into.runs += t.runs
  into.costUsd += t.costUsd
  into.inputTokens += t.inputTokens
  into.outputTokens += t.outputTokens
  into.cacheReadTokens += t.cacheReadTokens
  into.cacheWriteTokens += t.cacheWriteTokens
}

export async function readUsage(pid: string): Promise<ProjectUsage> {
  try { return { ...empty(), ...JSON.parse(await fs.readFile(usageFile(pid), 'utf8')) } } catch { return empty() }
}

export async function resetUsage(pid: string) {
  await fs.writeFile(usageFile(pid), JSON.stringify(empty(), null, 2))
  return readUsage(pid)
}

// Runs can finish together (a chat and a scan, say): writes to one project's file go one after another.
const queues = new Map<string, Promise<unknown>>()
function serial<T>(pid: string, fn: () => Promise<T>) {
  const next = (queues.get(pid) ?? Promise.resolve()).catch(() => {}).then(fn)
  queues.set(pid, next)
  return next
}

// A `result` event: totals per model (modelUsage), which also counts any subagents and the model behind tool calls.
async function recordResult(pid: string, kind: UsageKind, ev: any) {
  const perModel: [string, UsageTotals][] = Object.entries(ev.modelUsage ?? {}).map(([id, m]: [string, any]) => [
    String(m.canonicalModel || id),
    { runs: 0, costUsd: Number(m.costUSD) || 0, inputTokens: Number(m.inputTokens) || 0, outputTokens: Number(m.outputTokens) || 0, cacheReadTokens: Number(m.cacheReadInputTokens) || 0, cacheWriteTokens: Number(m.cacheCreationInputTokens) || 0 }
  ])
  const run: UsageRun = { ...zero(), runs: 1, at: new Date().toISOString(), kind, models: perModel.map(([m]) => m), ok: !ev.is_error }
  for (const [, t] of perModel) add(run, t)
  // Older Claude Code versions have no modelUsage: fall back to the overall figures.
  if (!perModel.length) {
    const u = ev.usage ?? {}
    add(run, { runs: 0, costUsd: Number(ev.total_cost_usd) || 0, inputTokens: Number(u.input_tokens) || 0, outputTokens: Number(u.output_tokens) || 0, cacheReadTokens: Number(u.cache_read_input_tokens) || 0, cacheWriteTokens: Number(u.cache_creation_input_tokens) || 0 })
  }

  await serial(pid, async () => {
    const u = await readUsage(pid)
    add(u.total, run)
    add(u.byKind[kind] ??= zero(), run)
    // A model's runs are the runs that used it, so they can add up to more than the total.
    for (const [m, t] of perModel) add(u.byModel[m] ??= zero(), { ...t, runs: 1 })
    u.recent = [run, ...u.recent].slice(0, RECENT)
    await fs.writeFile(usageFile(pid), JSON.stringify(u, null, 2))
  })
}

// The plan's limits, as of the last Claude run on this machine. Each window is a share used (0 to 1) and when it
// resets. Use elsewhere (claude.ai, Claude Code in a terminal) counts too but only shows here after the next run.
export interface LimitWindow { utilization: number, resetsAt: number }
export interface ClaudeLimits { status: string, windows: Record<string, LimitWindow>, isUsingOverage: boolean, at: string }

const LIMITS_FILE = resolve(STORAGE, '..', 'claude-limits.json')
let limits: ClaudeLimits | null | undefined

export async function readLimits(): Promise<ClaudeLimits | null> {
  if (limits === undefined) {
    try { limits = JSON.parse(await fs.readFile(LIMITS_FILE, 'utf8')) } catch { limits = null }
  }
  return limits ?? null
}

async function noteLimits(info: any) {
  const windows: Record<string, LimitWindow> = {}
  for (const [name, w] of Object.entries(info?.unifiedWindows ?? {}) as [string, any][]) {
    if (Number.isFinite(Number(w?.utilization))) windows[name] = { utilization: Number(w.utilization), resetsAt: Number(w.resetsAt) || 0 }
  }
  // Without the window breakdown, the one window the event is about still says whether Claude can be used.
  if (!Object.keys(windows).length && info?.rateLimitType) windows[info.rateLimitType] = { utilization: info.status === 'rejected' ? 1 : 0, resetsAt: Number(info.resetsAt) || 0 }
  limits = { status: String(info?.status ?? 'allowed'), windows, isUsingOverage: !!info?.isUsingOverage, at: new Date().toISOString() }
  await fs.writeFile(LIMITS_FILE, JSON.stringify(limits, null, 2)).catch(() => {})
}

// Feed every stream-json event from a Claude run. Never throws: usage tracking must not break the run itself.
export function trackClaudeEvent(pid: string, kind: UsageKind, ev: any) {
  if (ev?.type === 'rate_limit_event') noteLimits(ev.rate_limit_info).catch(() => {})
  else if (ev?.type === 'result') recordResult(pid, kind, ev).catch(() => {})
}
