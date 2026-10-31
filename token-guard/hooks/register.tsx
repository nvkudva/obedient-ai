import type { Register } from 'claude-code'

const MAX_TURNS = 150
const MAX_CALLS = 300
const IMAGE_BYTES = 300_000
const TEXT_BYTES = 30_000
const MAX_LINES = 600
const READ_LIMIT = 400
const IMAGE_PATTERN = /\.(png|jpe?g)$/i
const INLINE_PATCH_HELPER = /python3?\s+-\s*<<.*\n[\s\S]*def edit\(/

export const register: Register = on => {
  let turns = 0
  let calls = 0
  let hasWarnedTurns = false
  let hasWarnedCalls = false
  const stats = { duplicateReadsBlocked: 0, imagesDownscaled: 0, readsCapped: 0, repeatBash: 0, patchHelpers: 0 }
  const readMtimes = new Map<string, number>()
  const bashCommands = new Set<string>()

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'guard', description: 'Show token-guard counters and session hygiene' })
    return next(e)
  })

  on('command.run', { command: 'guard' }, async $ => {
    const home = (await $.env.get('HOME')) ?? ''
    const { stdout } = await $.process.run(['du', '-sh', `${home}/.claude/projects`]).catch(() => ({ stdout: '?' }))
    return {
      text: [
        `turns ${turns} (warn at ${MAX_TURNS}) · calls ${calls} (warn at ${MAX_CALLS})`,
        `duplicate Reads blocked ${stats.duplicateReadsBlocked} · images downscaled ${stats.imagesDownscaled} · Reads capped ${stats.readsCapped}`,
        `repeat Bash ${stats.repeatBash} · inline patch helpers ${stats.patchHelpers}`,
        `transcripts: ${stdout.split('\t')[0]}`,
      ].join('\n'),
    }
  })

  on('tool.call', ($, e, next) => {
    calls += 1
    $.ui.status(`turns ${turns} · calls ${calls}`)
    if (calls >= MAX_CALLS && !hasWarnedCalls) {
      hasWarnedCalls = true
      $.ui.toast(`${calls} tool calls: write a handoff and start a fresh session`)
    }
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    turns += 1
    if (turns >= MAX_TURNS && !hasWarnedTurns) {
      hasWarnedTurns = true
      $.ui.toast(`${turns} turns: /compact or /clear soon, every turn re-reads the whole context`)
    }
    return next(e)
  })

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
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
    if (INLINE_PATCH_HELPER.test(e.command)) {
      stats.patchHelpers += 1
      $.ui.toast('Inline patch helper: save it once as tools/edit.py or use Edit')
    }
    if (bashCommands.has(e.command)) {
      stats.repeatBash += 1
      $.ui.toast('Same Bash command ran earlier this session')
    }
    bashCommands.add(e.command)
    return next(e)
  })
}
