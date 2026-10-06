import { tmpdir } from 'node:os'
import { createInterface } from 'node:readline'
import type { ClaudeBin } from './claudeBin'
import { spawnClaude } from './claudeBin'
import { trackClaudeEvent } from './usage'

// "Auto" model for chat edits: Haiku sizes the request up first, then the edit runs on the lightest model that
// can do it. One sizing call costs about 2k Haiku tokens, far less than running a small tweak on Opus.
// Small requests also skip the snapshot check, since images are the dearest thing Claude reads.
export type RequestSize = 'small' | 'medium' | 'large'
export const SIZE_MODELS: Record<RequestSize, string> = { small: 'haiku', medium: 'sonnet', large: 'opus' }

const TIMEOUT_MS = 30_000
const SCHEMA = JSON.stringify({ type: 'object', properties: { size: { type: 'string', enum: ['small', 'medium', 'large'] } }, required: ['size'] })
const SYSTEM = [
  'You size up edit requests for a motion graphics editor where every scene is an HTML file animated over time.',
  'Answer with the size of the work the request needs:',
  '- small: change copy, colours, fonts, sizes, timing or easing of existing elements, or nudge positions.',
  '- medium: add, remove or restyle a few elements, change some motion or the layout of part of a scene.',
  '- large: build or rebuild a whole scene, redesign it, change several scenes at once, or anything needing app screenshots, recordings or code research.',
  'When unsure between two sizes, pick the larger one.'
].join('\n')

export interface RouteInput { message: string, scope: 'scene' | 'project', attachments: number }

// The size of a request, or null when the sizing call fails or times out (the caller then uses its fallback).
export function sizeRequest(bin: ClaudeBin, pid: string, input: RouteInput) {
  const prompt = [
    `Scope: ${input.scope === 'project' ? 'the whole project (all scenes)' : 'one scene'}.`,
    input.attachments ? `The user attached ${input.attachments} reference image(s).` : '',
    `Request:\n${input.message.slice(0, 2000)}`
  ].filter(Boolean).join('\n')
  // A bare session: own system prompt, no tools, no MCP servers or skills, and a scratch folder as cwd so the
  // project's long CLAUDE.md is not loaded.
  const args = [
    '-p', '--output-format', 'json', '--model', 'haiku',
    '--system-prompt', SYSTEM, '--tools', '', '--strict-mcp-config', '--disable-slash-commands',
    '--no-session-persistence', '--json-schema', SCHEMA
  ]
  return new Promise<RequestSize | null>((resolve) => {
    const proc = spawnClaude(bin, args, { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, MAX_THINKING_TOKENS: '0' } })
    let size: RequestSize | null = null
    const timer = setTimeout(() => proc.kill(), TIMEOUT_MS)
    createInterface({ input: proc.stdout }).on('line', (line) => {
      try {
        const ev = JSON.parse(line)
        trackClaudeEvent(pid, 'chat', ev)
        const s = ev.type === 'result' && !ev.is_error ? ev.structured_output?.size : null
        if (s in SIZE_MODELS) size = s
      } catch {}
    })
    proc.on('error', () => resolve(null))
    proc.on('close', () => { clearTimeout(timer); resolve(size) })
    proc.stdin.end(prompt)
  })
}
