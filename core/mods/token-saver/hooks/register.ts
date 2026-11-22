import type { EngineInterface, Register } from 'claude-code'
import {
  configure as configureCache, onPrompt as cachePrompt, onSessionStart as cacheStart, onTurnComplete as cacheTurnComplete, report as cacheReport,
} from './cache'
import {
  configure as configureQuick, onBash as quickBash, onPrompt as quickPrompt, onPromptError as quickPromptError,
  onSessionEnd as quickEnd, onSessionStart as quickStart, onTurnComplete as quickTurnComplete, report as quickReport,
} from './quick'
import {
  onBash as trimBash, onNudgePrompt as trimNudge, onRead as trimRead, onSessionStart as trimStart, onToolCall as trimToolCall,
  onTurnComplete as trimTurnComplete, onTurnStart as trimTurnStart, report as trimReport,
} from './trim'

// Claude Code allows one handler per event in a plugin, so this file is the only one that calls `on`.
// Each feature exports plain handler functions; they run in this order and a switched-off one is skipped.
const FEATURES = ['quick', 'trim', 'nudge', 'cache'] as const
type Feature = (typeof FEATURES)[number]
const DISABLED_KEY = 'disabledFeatures'

const isEnabledByConfig: Record<Feature, boolean> = { quick: true, trim: true, nudge: true, cache: false }
let disabledAtRuntime = new Set<string>()

const isOn = (feature: Feature) => isEnabledByConfig[feature] && !disabledAtRuntime.has(feature)
const isOptionOn = (value: unknown, fallback: boolean) => (value === undefined ? fallback : String(value) !== 'false')
const done = (event: unknown) => event

const saverText = async ($: EngineInterface, args: string) => {
  const [word, name] = args.trim().toLowerCase().split(/\s+/)
  if (word === 'on' || word === 'off') {
    if (!FEATURES.includes(name as Feature)) return `usage: /saver ${word} <${FEATURES.join('|')}>`
    if (word === 'off') disabledAtRuntime.add(name!)
    else disabledAtRuntime.delete(name!)
    await $.store.set(DISABLED_KEY, [...disabledAtRuntime])
    return `${name} is ${word}.`
  }
  const state = FEATURES.map(feature => `${feature} ${isOn(feature) ? 'on' : 'off'}`).join(' · ')
  return [state, await quickReport($), await trimReport($), await cacheReport($)].join('\n')
}

const startAll = async ($: EngineInterface, e: any) => {
  disabledAtRuntime = new Set(((await $.store.get(DISABLED_KEY)) as string[] | undefined) ?? [])
  await $.command.register({ name: 'saver', description: 'Show what token-saver did; `/saver off|on <feature>` switches one of quick, trim, nudge, cache' })
  if (isOn('quick')) await quickStart($, e)
  if (isOn('trim')) await trimStart($, e, done)
  if (isOn('cache')) await cacheStart($)
}

const quickStep = ($: EngineInterface, e: any, next: any) => (isOn('quick') ? quickPrompt($, e, next) : next(e))
const nudgeStep = ($: EngineInterface, e: any, next: any) => (isOn('nudge') ? trimNudge($, e, next) : next(e))
const cacheStep = (e: any, next: any) => {
  if (isOn('cache')) cachePrompt()
  return next(e)
}
const promptAll = ($: EngineInterface, e: any, next: any) =>
  quickStep($, e, (afterQuick: any) => nudgeStep($, afterQuick, (afterNudge: any) => cacheStep(afterNudge, next)))

const bashAll = ($: EngineInterface, e: any, next: any) => {
  const trimmed = (later: any) => (isOn('trim') ? trimBash($, later, next) : next(later))
  return isOn('quick') ? quickBash($, e, trimmed) : trimmed(e)
}

const turnCompleteAll = async ($: EngineInterface, e: any) => {
  if (isOn('trim')) trimTurnComplete($, e, done)
  if (isOn('quick')) quickTurnComplete()
  if (isOn('cache')) await cacheTurnComplete($)
}

export const register: Register = (on, options) => {
  const settings = options as Record<string, unknown>
  isEnabledByConfig.quick = isOptionOn(settings.isQuickOn, true)
  isEnabledByConfig.trim = isOptionOn(settings.isTrimOn, true)
  isEnabledByConfig.nudge = isOptionOn(settings.isNudgeOn, true)
  isEnabledByConfig.cache = isOptionOn(settings.isCacheKeeperOn, false)
  configureQuick(settings)
  configureCache(settings)

  on('session.start', async ($, e, next) => {
    await startAll($, e)
    return next(e)
  })

  on('command.run', { command: 'saver' }, async ($, e) => ({ text: await saverText($, e.args) }))

  on('prompt.submit', ($, e, next) => promptAll($, e, next)).catch(($, e, next) =>
    isOn('quick') ? quickPromptError($, e, next) : next(e),
  )

  on('tool.call', ($, e, next) => (isOn('trim') ? trimToolCall($, e, next) : next(e)))
  on('tool.call', { tool: 'Read' }, ($, e, next) => (isOn('trim') ? trimRead($, e, next) : next(e)))
  on('tool.call', { tool: 'Bash' }, ($, e, next) => bashAll($, e, next))

  on('turn.start', ($, e, next) => (isOn('trim') ? trimTurnStart($, e, next) : next(e)))
  on('turn.complete', async ($, e, next) => {
    await turnCompleteAll($, e)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (isOn('quick')) await quickEnd($)
    return next(e)
  })
}
