// Replays your Claude Code transcripts through the token-saver router.
//   bun core/mods/token-saver/tools/history.ts eval   which past prompts would have been routed (check for false positives)
//   bun core/mods/token-saver/tools/history.ts misses routed prompts where the main model did something else
//   bun core/mods/token-saver/tools/history.ts seed   write the run/test commands the main model used per repo to learned.json
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as router from '../hooks/router.ts'
import * as project from '../hooks/project.ts'

const PROJECTS_DIR = join(homedir(), '.claude', 'projects')
const LEARNED_FILE = join(homedir(), '.claude', 'quickrun', 'learned.json')

type Prompt = { text: string; cwd: string; timestamp: string; bashAfter: Array<{ command: string; isError: boolean; isBackground: boolean }> }

const promptText = (entry: any): string | undefined => {
  if (entry.type !== 'user' || entry.isMeta || entry.isSidechain) return undefined
  const content = entry.message?.content
  if (typeof content === 'string') return content.startsWith('<') ? undefined : content.trim() || undefined
  if (!Array.isArray(content) || content.some(block => block.type === 'tool_result')) return undefined
  const text = content.filter(block => block.type === 'text').map(block => block.text).join(' ').trim()
  return text && !text.startsWith('<') ? text : undefined
}

const readTranscript = (path: string): Prompt[] => {
  const prompts: Prompt[] = []
  const pendingBash = new Map<string, { command: string; isBackground: boolean }>()
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) continue
    let entry: any
    try { entry = JSON.parse(line) } catch { continue }
    const text = promptText(entry)
    if (text) {
      prompts.push({ text, cwd: entry.cwd ?? '', timestamp: entry.timestamp ?? '', bashAfter: [] })
      continue
    }
    const current = prompts.at(-1)
    if (!current || entry.isSidechain || !Array.isArray(entry.message?.content)) continue
    for (const block of entry.message.content) {
      if (block.type === 'tool_use' && block.name === 'Bash') pendingBash.set(block.id, { command: block.input?.command ?? '', isBackground: block.input?.run_in_background === true })
      if (block.type === 'tool_result' && pendingBash.has(block.tool_use_id)) {
        current.bashAfter.push({ ...pendingBash.get(block.tool_use_id)!, isError: block.is_error === true })
      }
    }
  }
  return prompts
}

const allPrompts = () => {
  const prompts: Prompt[] = []
  for (const dir of readdirSync(PROJECTS_DIR)) {
    let files: string[] = []
    try { files = readdirSync(join(PROJECTS_DIR, dir)).filter(name => name.endsWith('.jsonl')) } catch { continue }
    for (const file of files) prompts.push(...readTranscript(join(PROJECTS_DIR, dir, file)))
  }
  return prompts.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

const routeAll = (prompts: Prompt[]) => {
  const routed: Array<{ prompt: Prompt; actions: router.Action[] }> = []
  for (const prompt of prompts) {
    const actions = router.route(prompt.text)
    if (actions) routed.push({ prompt, actions })
  }
  return routed
}

// Whether the main model's turn did what token-saver would have done: a check on the router, not on the model.
const ACTION_EVIDENCE: Record<router.Action, (bash: Prompt['bashAfter'][number]) => boolean> = {
  commit: bash => /\bgit\b.*\bcommit\b/.test(bash.command),
  merge: bash => /\bgit\b.*\b(merge|fetch \.)/.test(bash.command),
  push: bash => /\bgit\b.*\bpush\b/.test(bash.command),
  pull: bash => /\bgit\b.*\bpull\b/.test(bash.command),
  release: bash => /\bgit\b.*\btag\b|\bnpm version\b|\bgh release\b/.test(bash.command),
  stop: bash => /\b(kill|pkill|killall)\b/.test(bash.command),
  restart: bash => bash.isBackground,
  test: bash => /\b(test|pytest|vitest|jest)\b/.test(bash.command),
  run: bash => bash.isBackground,
  deploy: bash => /deploy|wrangler|vercel|fly |netlify|firebase/.test(bash.command),
}
const didAll = (prompt: Prompt, actions: router.Action[]) =>
  actions.every(action => prompt.bashAfter.some(ACTION_EVIDENCE[action]))

const evaluate = async () => {
  const prompts = allPrompts()
  const routed = routeAll(prompts)
  const rows = new Map<string, { count: number; matched: number }>()
  for (const { prompt, actions } of routed) {
    const key = `${actions.join('+').padEnd(20)} ${prompt.text.toLowerCase().slice(0, 60)}`
    const row = rows.get(key) ?? { count: 0, matched: 0 }
    row.count += 1
    if (didAll(prompt, actions)) row.matched += 1
    rows.set(key, row)
  }
  const matched = routed.filter(({ prompt, actions }) => didAll(prompt, actions)).length
  console.log(`prompts: ${prompts.length}, routed: ${routed.length}, main model did the same: ${matched}`)
  console.log('count  did  route')
  for (const [key, row] of [...rows].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`${String(row.count).padStart(5)} ${String(row.matched).padStart(4)}  ${key}`)
  }
}

const seed = async () => {
  const learned: Record<string, project.Commands> = {}
  for (const { prompt, actions } of routeAll(allPrompts())) {
    for (const action of actions) {
      if (action !== 'run' && action !== 'test') continue
      const used = prompt.bashAfter
        .filter(bash => !bash.isError)
        .map(bash => project.learnable(action, bash.command, bash.isBackground))
        .find(Boolean)
      if (used && prompt.cwd) learned[prompt.cwd] = { ...learned[prompt.cwd], [action]: used }
    }
  }
  mkdirSync(join(homedir(), '.claude', 'quickrun'), { recursive: true })
  writeFileSync(LEARNED_FILE, JSON.stringify(learned, null, 2))
  console.log(`wrote ${Object.keys(learned).length} repos to ${LEARNED_FILE}`)
  for (const [cwd, commands] of Object.entries(learned)) console.log(`${cwd}\n  ${JSON.stringify(commands)}`)
}

const misses = async () => {
  for (const { prompt, actions } of routeAll(allPrompts())) {
    if (didAll(prompt, actions)) continue
    const commands = prompt.bashAfter.map(bash => bash.command.split('\n')[0]!.slice(0, 80))
    console.log(`${actions.join('+').padEnd(20)} ${prompt.text.slice(0, 40).padEnd(40)} | ${commands.slice(0, 3).join(' ⏐ ') || '(no Bash)'}`)
  }
}

const mode = process.argv[2]
if (mode === 'eval') await evaluate()
else if (mode === 'misses') await misses()
else if (mode === 'seed') await seed()
else console.log('usage: bun core/mods/token-saver/tools/history.ts eval|misses|seed')
