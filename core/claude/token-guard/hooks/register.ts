import type { EngineInterface, Register } from 'claude-code'

const CACHE_TTL_MS = 5 * 60_000
const MAX_TURNS = 150
const MAX_CALLS = 300
const IMAGE_BYTES = 300_000
const TEXT_BYTES = 30_000
const MAX_LINES = 600
const READ_LIMIT = 400
const IMAGE_PATTERN = /\.(png|jpe?g)$/i
const INLINE_PATCH_HELPER = /python3?\s+-\s*<<.*\n[\s\S]*def edit\(/
const CD_THEN_SINGLE_GIT = /^\s*cd\s+("[^"]+"|'[^']+'|[^\s;&|]+)\s*&&\s*git\s+([^;&|\n`$()<>]*)$/
const TOPIC_CHECK_MIN_TOKENS = 150_000
const TOPIC_CHECK_MIN_CHARS = 40
const RECENT_PROMPTS_KEPT = 3
const CONTINUE_HERE = 'Continue here'
const START_FRESH = 'Start fresh (/clear, resend prompt)'
const COMPACT_FIRST = 'Compact first, then send'

const SAME_FAILURE_LIMIT = 3
const ERROR_KEY_LENGTH = 120

// Agents vary the command but the error stays the same, so the key is the error's first meaningful line.
export const normalizeError = (text: string) => {
  const meaningfulLine = text.split('\n').find(line => line.trim() !== '' && !/^exit code \d+$/i.test(line.trim()))
  return (meaningfulLine ?? text).toLowerCase().replace(/0x[0-9a-f]+|\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, ERROR_KEY_LENGTH)
}

// State and helpers sit at module level: the loader only follows `$` into top-level functions.
let turns = 0
let calls = 0
let hasWarnedTurns = false
let hasWarnedCalls = false
let lastRequestAt = 0
let stopTicker: (() => void) | undefined
const stats = { duplicateReadsBlocked: 0, imagesDownscaled: 0, readsCapped: 0, repeatBash: 0, patchHelpers: 0, failureLoops: 0 }
const readMtimes = new Map<string, number>()
const bashCommands = new Set<string>()
const recentPrompts: string[] = []
const failureCounts = new Map<string, number>()
let hasRedirectedThisTurn = false

const isUnrelatedTopic = async ($: EngineInterface, text: string, contextTokens: number) => {
  if (recentPrompts.length === 0 || text.length < TOPIC_CHECK_MIN_CHARS || contextTokens < TOPIC_CHECK_MIN_TOKENS) {
    return false
  }
  const history = recentPrompts.map(prompt => `- ${prompt}`).join('\n')
  const question = `Earlier requests in this coding session:\n${history}\n\nNew request:\n${text}\n\nDoes the new request continue the earlier work, or start an unrelated task?`
  const label = await $.model.classify(question, ['continues', 'unrelated']).catch(() => undefined)
  return label === 'unrelated'
}
const rememberPrompt = (text: string) => {
  recentPrompts.push(text.slice(0, 500))
  if (recentPrompts.length > RECENT_PROMPTS_KEPT) recentPrompts.shift()
}

const showStatus = async ($: EngineInterface) => {
  const { context } = await $.session.usage()
  const trimmed = Object.values(stats).reduce((sum, count) => sum + count, 0)
  const left = lastRequestAt === 0 ? 0 : Math.max(0, lastRequestAt + CACHE_TTL_MS - (await $.clock.now()))
  const cache = left === 0 ? 'cache cold' : `cache ${Math.floor(left / 60_000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`
  $.ui.status(`◆ ctx ${context.percent ?? '?'}% · ${cache} · ${turns}t ${calls}c · ${trimmed} trimmed`)
}
const touch = async ($: EngineInterface) => {
  lastRequestAt = await $.clock.now()
  await showStatus($)
}

const IS_OFF_KEY = 'isOff'
let isGuardOff = false

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    isGuardOff = (await $.store.get(IS_OFF_KEY)) === true
    stopTicker?.()
    stopTicker = $.clock.every(15_000, () => void showStatus($))
    await $.command.register({ name: 'guard', description: 'Show token-guard counters; `/guard off` or `on` switches it' })
    return next(e)
  })

  on('command.run', { command: 'guard' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    if (word === 'on' || word === 'off') {
      isGuardOff = word === 'off'
      await $.store.set(IS_OFF_KEY, isGuardOff)
      return { text: `token-guard is ${word}.` }
    }
    const home = (await $.env.get('HOME')) ?? ''
    const { stdout } = await $.process.run(['du', '-sh', `${home}/.claude/projects`]).catch(() => ({ stdout: '?' }))
    return {
      text: [
        ...(isGuardOff ? ['token-guard is off (`/guard on` turns it back on).'] : []),
        `turns ${turns} (warn at ${MAX_TURNS}) · calls ${calls} (warn at ${MAX_CALLS})`,
        `duplicate Reads blocked ${stats.duplicateReadsBlocked} · images downscaled ${stats.imagesDownscaled} · Reads capped ${stats.readsCapped}`,
        `repeat Bash ${stats.repeatBash} · inline patch helpers ${stats.patchHelpers} · failure loops ${stats.failureLoops}`,
        `transcripts: ${stdout.split('\t')[0]}`,
      ].join('\n'),
    }
  })

  // A new unrelated task in a big session re-reads all old context every turn: offer a fresh start.
  on('prompt.submit', async ($, e, next) => {
    // T3 Code and other SDK hosts deliver typed prompts as `sdk` or `unclassified`, not `composer`.
    const isHumanOrigin = ['composer', 'bridge', 'sdk', 'unclassified'].includes(e.origin.kind)
    const isTypedPrompt = isHumanOrigin && !e.command && !e.isMeta && e.turnId === undefined
    if (isGuardOff || !isTypedPrompt) return next(e)

    const { context } = await $.session.usage()
    const contextTokens = context.tokens ?? 0
    const isUnrelated = await isUnrelatedTopic($, e.text, contextTokens)
    if (!isUnrelated) {
      rememberPrompt(e.text)
      return next(e)
    }

    const isCacheCold = lastRequestAt === 0 || (await $.clock.now()) - lastRequestAt > CACHE_TTL_MS
    const coldNote = isCacheCold ? ' Cache has expired, so continuing re-caches all of it.' : ''
    const question = `This looks like a new task. The session holds ${Math.round(contextTokens / 1000)}k tokens that every turn re-reads.${coldNote} Start fresh?`
    const choice = await $.ui
      .ask(question, { options: [CONTINUE_HERE, START_FRESH, COMPACT_FIRST], header: 'Context' })
      .catch(() => CONTINUE_HERE)

    if (choice === START_FRESH) {
      recentPrompts.length = 0
      rememberPrompt(e.text)
      await $.command.run({ command: 'clear' })
      void $.prompt.submit({ text: e.text })
      return { drop: 'started a fresh session for an unrelated task' }
    }
    if (choice === COMPACT_FIRST) {
      await $.session.compact({ instructions: `Keep only what the next task needs: ${e.text.slice(0, 300)}` }).catch(() => undefined)
    }
    rememberPrompt(e.text)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (isGuardOff) return next(e)
    calls += 1
    void touch($)
    if (calls >= MAX_CALLS && !hasWarnedCalls) {
      hasWarnedCalls = true
      $.ui.toast(`${calls} tool calls: write a handoff and start a fresh session`)
    }

    // The same error three times in one turn: tell the model to stop retrying. Never blocks.
    const result = await next(e)
    if (e.agentId !== undefined || result.isError !== true || result.text === undefined) return result

    const errorKey = normalizeError(result.text)
    const failureCount = (failureCounts.get(errorKey) ?? 0) + 1
    failureCounts.set(errorKey, failureCount)
    if (failureCount < SAME_FAILURE_LIMIT || hasRedirectedThisTurn) return result

    hasRedirectedThisTurn = true
    stats.failureLoops += 1
    $.ui.toast(`Same error ${failureCount} times: told the model to stop and report`)
    const redirect = `token-guard: this error has now failed ${failureCount} times this turn ("${errorKey}"). Do not retry it again. Stop and tell the user what you tried and what you think is wrong.`
    return { ...result, context: [...(result.context ?? []), redirect] }
  })

  on('turn.start', (_, e, next) => {
    if (e.agentId === undefined) {
      failureCounts.clear()
      hasRedirectedThisTurn = false
    }
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (isGuardOff) return next(e)
    turns += 1
    void touch($)
    if (turns >= MAX_TURNS && !hasWarnedTurns) {
      hasWarnedTurns = true
      $.ui.toast(`${turns} turns: /compact or /clear soon, every turn re-reads the whole context`)
    }
    return next(e)
  })

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    if (isGuardOff) return next(e)
    const stat = await $.fs.stat(e.file_path).catch(() => undefined)
    if (stat === undefined) {
      return { deny: `${e.file_path} not found: locate it with rg --files first.` }
    }

    if (IMAGE_PATTERN.test(e.file_path) && stat.size > IMAGE_BYTES) {
      const smallPath = `${(await $.env.get('TMPDIR')) ?? '/tmp'}/token-guard-${stat.size}-${e.file_path.split('/').pop()}`
      const { exitCode } = await $.process.run(['sips', '-Z', '1200', e.file_path, '--out', smallPath])
      if (exitCode === 0) {
        stats.imagesDownscaled += 1
        $.ui.toast(`Downscaled ${Math.round(stat.size / 1000)} KB image before reading`)
        return next({ ...e, file_path: smallPath })
      }
      return next(e)
    }

    const isWholeFile = e.offset === undefined && e.limit === undefined
    if (isWholeFile && readMtimes.get(e.file_path) === stat.mtimeMs) {
      stats.duplicateReadsBlocked += 1
      return { deny: `${e.file_path} already read and unchanged since: use that result, or pass offset/limit.` }
    }
    readMtimes.set(e.file_path, stat.mtimeMs)

    const isUnbounded = isWholeFile && !e.allow_large
    if (isUnbounded && stat.size > TEXT_BYTES && !IMAGE_PATTERN.test(e.file_path)) {
      const text = await $.fs.read(e.file_path).catch(() => '')
      const lineCount = text.split('\n').length
      if (lineCount > MAX_LINES) {
        stats.readsCapped += 1
        $.ui.toast(`${lineCount}-line file: read capped at ${READ_LIMIT} lines, pass offset for more`)
        return next({ ...e, limit: READ_LIMIT })
      }
    }
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, ($, e, next) => {
    if (isGuardOff) return next(e)
    if (INLINE_PATCH_HELPER.test(e.command)) {
      stats.patchHelpers += 1
      $.ui.toast('Inline patch helper: save it once as tools/edit.py or use Edit')
    }
    if (bashCommands.has(e.command)) {
      stats.repeatBash += 1
      $.ui.toast('Same Bash command ran earlier this session')
    }
    bashCommands.add(e.command)

    // `cd dir && git …` trips permission prompts and fails when cwd resets; `git -C` does neither.
    const cdGit = CD_THEN_SINGLE_GIT.exec(e.command)
    if (cdGit !== null) {
      return next({ ...e, command: `git -C ${cdGit[1]} ${cdGit[2]}` })
    }
    return next(e)
  })
}
