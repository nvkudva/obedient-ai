import type { Register } from 'claude-code'

const MS_PER_MINUTE = 60_000

export const register: Register = (on, options) => {
  if (String(options.isCacheKeeperOn) === 'false') return

  const intervalMs = Number(options.intervalMinutes) * MS_PER_MINUTE
  const maxPings = Number(options.maxPings)
  const minTokens = Number(options.minTokens)

  let lastActivityAt = 0
  let isTurnRunning = false
  let isPinging = false
  let pingsSent = 0

  on('session.start', async ($, e, next) => {
    lastActivityAt = await $.clock.now()

    $.clock.every(MS_PER_MINUTE, async () => {
      const now = await $.clock.now()
      if (isTurnRunning || now - lastActivityAt < intervalMs) return

      const { context } = await $.session.usage()
      if ((context.tokens ?? 0) < minTokens) return

      lastActivityAt = now
      if (pingsSent < maxPings) {
        pingsSent += 1
        isPinging = true
        await $.prompt.submit({ text: 'Reply with only: ok' })
        return
      }

      pingsSent = 0
      await $.session.compact().catch(() => $.ui.status('cache-keeper: compact failed'))
    })

    return next(e)
  })

  on('prompt.submit', ($, e, next) => {
    isTurnRunning = true
    if (!isPinging) pingsSent = 0
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    isTurnRunning = false
    isPinging = false
    lastActivityAt = await $.clock.now()
    return next(e)
  })
}
