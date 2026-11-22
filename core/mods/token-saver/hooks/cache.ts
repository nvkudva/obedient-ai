import type { EngineInterface } from 'claude-code'

const MS_PER_MINUTE = 60_000
const STATS_KEY = 'cacheStats'
const stats = { pings: 0, compactions: 0 }

export async function report($: EngineInterface) {
  Object.assign(stats, (await $.store.get(STATS_KEY)) as object | undefined)
  return `cache keep-alive: ${stats.pings} pings, ${stats.compactions} compactions`
}

let intervalMs = 55 * MS_PER_MINUTE
let maxPings = 2
let minTokens = 150_000
let lastActivityAt = 0
let isTurnRunning = false
let isPinging = false
let pingsSent = 0

export const configure = (options: Record<string, unknown>) => {
  intervalMs = Number(options.intervalMinutes ?? 55) * MS_PER_MINUTE
  maxPings = Number(options.maxPings ?? 2)
  minTokens = Number(options.minTokens ?? 150_000)
}

// Runs once a minute; a top-level function because the hook loader only follows `$` into those.
async function tick($: EngineInterface) {
  const now = await $.clock.now()
  if (isTurnRunning || now - lastActivityAt < intervalMs) return

  const { context } = await $.session.usage()
  if ((context.tokens ?? 0) < minTokens) return

  lastActivityAt = now
  if (pingsSent < maxPings) {
    pingsSent += 1
    stats.pings += 1
    await $.store.set(STATS_KEY, stats)
    isPinging = true
    await $.prompt.submit({ text: 'Reply with only: ok' })
    return
  }

  pingsSent = 0
  stats.compactions += 1
  await $.store.set(STATS_KEY, stats)
  await $.session.compact().catch(() => $.ui.status('cache-keeper: compact failed'))
}

export async function onSessionStart($: EngineInterface) {
  lastActivityAt = await $.clock.now()
  $.clock.every(MS_PER_MINUTE, () => tick($))
}

export const onPrompt = () => {
  isTurnRunning = true
  if (!isPinging) pingsSent = 0
}

export async function onTurnComplete($: EngineInterface) {
  isTurnRunning = false
  isPinging = false
  lastActivityAt = await $.clock.now()
}
