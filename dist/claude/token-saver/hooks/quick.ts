import type { EngineInterface } from 'claude-code'
import * as router from './router'
import * as project from './project'
import * as release from './release'

const COMMIT_SYSTEM = 'You write git commit messages in Conventional Commits form. Reply with the message only: a title under 72 characters, then optionally a blank line and up to 3 short bullet lines.'
// Shown as the reason the prompt never reached the model.
const DONE_PREFIX = 'token-saver: '
const HUMAN_ORIGINS = new Set(['composer', 'bridge', 'sdk'])
const MAX_DIFF_CHARS = 12_000
const MAX_OUTPUT_TAIL = 4_000
const RUN_WAIT_MS = 4_000
const RUN_POLL_MS = 250
const STOP_WAIT_MS = 2_000
// npm, vite and esbuild each fork; killing only the top pid leaves the server holding its port.
const KILL_TREE = 'kill_tree() { for child in $(pgrep -P "$1"); do kill_tree "$child"; done; kill "$1" 2>/dev/null; }; kill_tree "$1"'
const TEST_TIMEOUT_MS = 10 * 60_000
const DEPLOY_TIMEOUT_MS = 10 * 60_000
const SECRET_FILE = /(^|\/)(\.env(\.[^/]*)?|[^/]*\.(pem|key|p12|pfx)|id_(rsa|ed25519)[^/]*|[^/]*(credential|secret)[^/]*)$/i
const SAFE_SAMPLE = /\.(example|sample|template)$/i
const LOCAL_URL = /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::\])[^\s"'\x1b]*/

// Main-model cost of one such prompt in your past sessions (median-ish averages from tools/history.ts).
const PAST_TURN_COST: Record<router.Action, { usd: number; seconds: number }> = {
  commit: { usd: 0.72, seconds: 56 }, merge: { usd: 0.83, seconds: 84 }, push: { usd: 0.86, seconds: 64 },
  test: { usd: 1.86, seconds: 112 }, deploy: { usd: 0.76, seconds: 136 }, run: { usd: 1.56, seconds: 168 },
  // shortcut: pull, stop and restart were too rare to measure (about 22 prompts); borrowed from push and run.
  pull: { usd: 0.86, seconds: 64 }, stop: { usd: 0.86, seconds: 64 }, restart: { usd: 1.56, seconds: 168 },
  release: { usd: 1.56, seconds: 168 },
}

type Outcome = { summary: string; mergedInto?: string } | { handoff: string }
type RunRecord = { pid: string; command: string; url?: string; logPath: string }
type MessageTiming = { model: string; ms: number }
type Stats = { prompts: number; byAction: Partial<Record<router.Action, number>>; usd: number; seconds: number; messageTimes?: Record<string, { ms: number; count: number }> }

let doneThisPrompt: string[] = []
let learningAction: project.ProjectAction | undefined
let cwd = '.'
let sessionId = 'unknown'

const tail = (text: string) => (text.length > MAX_OUTPUT_TAIL ? `…${text.slice(-MAX_OUTPUT_TAIL)}` : text)
async function quickrunDir($: EngineInterface) { return `${(await $.env.get('HOME')) ?? '~'}/.claude/quickrun` }
async function learnedPath($: EngineInterface) { return `${await quickrunDir($)}/learned.json` }
const notesKey = () => `notes:${sessionId}`

async function readJson($: EngineInterface, path: string) {
  const text = await $.fs.read(path).catch(() => undefined)
  try {
    return text === undefined ? {} : JSON.parse(text)
  } catch {
    return {}
  }
}

async function takeNotes($: EngineInterface) {
  const notes = ((await $.store.get(notesKey())) as string[] | undefined) ?? []
  if (notes.length) await $.store.delete(notesKey())
  return notes
}
async function addNotes($: EngineInterface, notes: string[]) {
  const kept = ((await $.store.get(notesKey())) as string[] | undefined) ?? []
  await $.store.set(notesKey(), [...kept, ...notes])
}

async function recordStats($: EngineInterface, actions: router.Action[], timing?: MessageTiming) {
  const stats = ((await $.store.get('stats')) as Stats | undefined) ?? { prompts: 0, byAction: {}, usd: 0, seconds: 0 }
  // One handled prompt replaced one main-model turn, so count its costliest action, not the sum.
  const costliest = actions.map(action => PAST_TURN_COST[action]).sort((a, b) => b.usd - a.usd)[0]
  stats.prompts += 1
  stats.usd += costliest?.usd ?? 0
  stats.seconds += costliest?.seconds ?? 0
  for (const action of actions) stats.byAction[action] = (stats.byAction[action] ?? 0) + 1
  if (timing) {
    const times = (stats.messageTimes ??= {})
    const kept = times[timing.model] ?? { ms: 0, count: 0 }
    times[timing.model] = { ms: kept.ms + timing.ms, count: kept.count + 1 }
  }
  await $.store.set('stats', stats)
}

const statsReport = (stats: Stats | undefined) => {
  if (!stats || stats.prompts === 0) return 'token-saver has not handled a prompt yet.'
  const actions = Object.entries(stats.byAction).map(([action, count]) => `${action} ${count}`).join(', ')
  const averages = Object.entries(stats.messageTimes ?? {}).map(([model, time]) => `${model} ${Math.round(time.ms / time.count)} ms (${time.count})`)
  const messageAverage = averages.length ? `. Commit messages: ${averages.join(', ')}` : ''
  return `token-saver handled ${stats.prompts} prompts (${actions}). Estimated main-model turns avoided: ~$${stats.usd.toFixed(2)} and ~${Math.round(stats.seconds / 60)} min${messageAverage}.`
}

async function loadProject($: EngineInterface): Promise<project.Project> {
  const entries = await $.fs.list(cwd).catch(() => [])
  const files = new Set(entries.map(entry => entry.name))
  const learned = await readJson($, await learnedPath($))
  return {
    files,
    packageJson: files.has('package.json') ? await $.fs.read(`${cwd}/package.json`) : undefined,
    config: await readJson($, `${cwd}/.claude/quickrun.json`),
    learned: learned[cwd] ?? {},
  }
}

async function remember($: EngineInterface, action: project.ProjectAction, command: string) {
  const path = await learnedPath($)
  const learned = await readJson($, path)
  learned[cwd] = { ...learned[cwd], [action]: command }
  await $.fs.write(path, JSON.stringify(learned, null, 2))
}

// Through sh, because $.process.run turns repo hooks off for a direct git call; pre-commit and pre-push must run.
function git($: EngineInterface, ...args: string[]) { return $.process.run(['sh', '-c', 'exec git "$@"', 'git', ...args], { cwd }) }
function shell($: EngineInterface, command: string, timeoutMs: number) {
  return $.process.run(['sh', '-c', command], { cwd, timeoutMs })
}
async function isAlive($: EngineInterface, pid: string) { return (await $.process.run(['kill', '-0', pid])).exitCode === 0 }
async function currentBranch($: EngineInterface) { return (await git($, 'rev-parse', '--abbrev-ref', 'HEAD')).stdout.trim() }

async function commitMessage($: EngineInterface, model: string, diff: string) {
  const startedAt = await $.clock.now()
  const prompt = `Write the commit message for this staged diff:\n\n${diff}`
  const reply = await $.model.complete({ model, effort: 'low', maxTokens: 200, timeoutMs: 15_000, system: COMMIT_SYSTEM, prompt })
  const message = reply.isAnswered ? reply.text.trim() || undefined : undefined
  return { message, timing: { model, ms: (await $.clock.now()) - startedAt } }
}

async function commit($: EngineInterface, model: string, timings: MessageTiming[]): Promise<Outcome> {
  await git($, 'add', '-A')
  const staged = (await git($, 'diff', '--cached', '--name-only')).stdout.split('\n').filter(Boolean)
  if (staged.length === 0) return { summary: 'nothing to commit' }
  const secrets = staged.filter(path => SECRET_FILE.test(path) && !SAFE_SAMPLE.test(path))
  if (secrets.length) {
    await $.process.run(['sh', '-c', 'exec git "$@"', 'git', 'reset', '-q', '--', ...secrets], { cwd })
    return { handoff: `staged changes include files that look like secrets (${secrets.join(', ')}). token-saver unstaged them and did not commit; ask the user before committing them or add them to .gitignore.` }
  }
  const stat = (await git($, 'diff', '--cached', '--stat')).stdout
  const diff = (await git($, 'diff', '--cached')).stdout.slice(0, MAX_DIFF_CHARS)
  const { message, timing } = await commitMessage($, model, `${stat}\n${diff}`)
  timings.push(timing)
  if (!message) return { handoff: 'the commit message model gave no answer; changes are staged, write the message and commit.' }
  const result = await git($, 'commit', '-m', message)
  if (result.exitCode !== 0) return { handoff: `git commit failed:\n${tail(result.stdout + result.stderr)}` }
  return { summary: `committed. ${message.split('\n')[0]}` }
}

async function defaultBranch($: EngineInterface) {
  const originHead = (await git($, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD')).stdout.trim()
  if (originHead) return originHead.replace(/^origin\//, '')
  for (const name of ['main', 'master']) {
    if ((await git($, 'rev-parse', '--verify', '-q', `refs/heads/${name}`)).exitCode === 0) return name
  }
  return undefined
}

async function worktreeOf($: EngineInterface, branch: string) {
  const blocks = (await git($, 'worktree', 'list', '--porcelain')).stdout.split('\n\n')
  const block = blocks.find(lines => lines.split('\n').includes(`branch refs/heads/${branch}`))
  return block?.match(/^worktree (.+)$/m)?.[1]
}

// Fast-forward only: anything that needs a real merge or a rebase is the main model's job.
async function merge($: EngineInterface): Promise<Outcome> {
  const target = await defaultBranch($)
  const source = await currentBranch($)
  if (!target) return { handoff: 'no main or master branch found to merge into.' }
  if (source === target || source === 'HEAD') return { handoff: `already on ${target}; the user did not say which branch to merge.` }
  const worktree = await worktreeOf($, target)
  // A branch checked out in another worktree (T3, `git worktree`) can only move there.
  const result = worktree ? await git($, '-C', worktree, 'merge', '--ff-only', source) : await git($, 'fetch', '.', `${source}:${target}`)
  if (result.exitCode !== 0) {
    return { handoff: `fast-forward merge of ${source} into ${target} failed (${target} has moved on, or its worktree has conflicting changes):\n${tail(result.stderr)}` }
  }
  return { summary: `merged. ${source} into ${target}`, mergedInto: target }
}

async function push($: EngineInterface, branch: string | undefined): Promise<Outcome> {
  const pushed = branch ?? (await currentBranch($))
  let result = branch ? await git($, 'push', 'origin', branch) : await git($, 'push')
  if (result.exitCode !== 0 && /no upstream|set-upstream/.test(result.stderr)) result = await git($, 'push', '-u', 'origin', 'HEAD')
  if (result.exitCode !== 0) return { handoff: `git push failed:\n${tail(result.stderr)}` }
  return { summary: `pushed. ${pushed}` }
}

async function test($: EngineInterface, command: string): Promise<Outcome> {
  const result = await shell($, command, TEST_TIMEOUT_MS)
  if (result.exitCode !== 0) return { handoff: `\`${command}\` failed (exit ${result.exitCode}):\n${tail(result.stdout + result.stderr)}` }
  return { summary: `tests passed. (\`${command}\`)` }
}

async function waitForServer($: EngineInterface, pid: string, logPath: string) {
  const deadline = (await $.clock.now()) + RUN_WAIT_MS
  let log = ''
  while ((await $.clock.now()) < deadline) {
    await $.clock.sleep(RUN_POLL_MS)
    log = await $.fs.read(logPath).catch(() => '')
    if (LOCAL_URL.test(log) || !(await isAlive($, pid))) break
  }
  return { log, url: log.match(LOCAL_URL)?.[0], isRunning: await isAlive($, pid) }
}

const runKey = () => `run:${cwd}`
async function runningServer($: EngineInterface) {
  const previous = (await $.store.get(runKey())) as RunRecord | undefined
  return previous && (await isAlive($, previous.pid)) ? previous : undefined
}

// Only the server token-saver started is known; any other one is the main model's to find.
async function stop($: EngineInterface): Promise<Outcome> {
  const server = await runningServer($)
  if (!server) return { handoff: 'token-saver has no running server it started for this project; find and stop the server.' }
  await $.process.run(['sh', '-c', KILL_TREE, 'token-saver', server.pid])
  const deadline = (await $.clock.now()) + STOP_WAIT_MS
  while ((await isAlive($, server.pid)) && (await $.clock.now()) < deadline) await $.clock.sleep(RUN_POLL_MS)
  if (await isAlive($, server.pid)) return { handoff: `\`${server.command}\` (pid ${server.pid}) did not stop within ${STOP_WAIT_MS / 1000} s.` }
  await $.store.delete(runKey())
  return { summary: `stopped. \`${server.command}\` (pid ${server.pid})` }
}

async function pull($: EngineInterface): Promise<Outcome> {
  const result = await git($, 'pull', '--ff-only')
  if (result.exitCode !== 0) return { handoff: `git pull --ff-only failed:\n${tail(result.stderr)}` }
  return { summary: /up to date/i.test(result.stdout) ? 'already up to date' : `pulled. ${await currentBranch($)}` }
}

// Started detached with output to a log file, so the server outlives this hook and a plugin reload.
async function run($: EngineInterface, command: string): Promise<Outcome> {
  const previous = await runningServer($)
  if (previous) {
    return { summary: `already running \`${previous.command}\` (pid ${previous.pid}${previous.url ? `, ${previous.url}` : ''}, log ${previous.logPath})` }
  }
  const logPath = `${await quickrunDir($)}/logs/${cwd.replace(/[^a-zA-Z0-9]+/g, '-')}-run.log`
  const started = await $.process.run(
    ['sh', '-c', 'mkdir -p "$(dirname "$2")"; nohup sh -c "$1" > "$2" 2>&1 < /dev/null & echo $!', 'token-saver', command, logPath],
    { cwd },
  )
  const pid = started.stdout.trim()
  const { log, url, isRunning } = await waitForServer($, pid, logPath)
  if (!isRunning) return { handoff: `\`${command}\` exited right after start. Log ${logPath}:\n${tail(log)}` }
  await $.store.set(runKey(), { pid, command, url, logPath } satisfies RunRecord)
  return { summary: `started. \`${command}\` (pid ${pid}${url ? `, ${url}` : ''}, log ${logPath})` }
}

async function releaseNotes($: EngineInterface, model: string, tag: string, subjects: string[]) {
  const reply = await $.model.complete({
    model,
    effort: 'low',
    maxTokens: 600,
    timeoutMs: 20_000,
    system: 'You write release notes from commit subjects. Reply with the notes only: a one-line headline, a blank line, then short plain-language bullets grouped under "Added", "Fixed" and "Changed" (omit empty groups). Skip release and merge commits.',
    prompt: `Release ${tag}. Commits since the previous release:\n${subjects.join('\n')}`,
  })
  return reply.isAnswered && reply.text.trim() ? reply.text.trim() : release.fallbackNotes(subjects)
}

// Files whose own version field holds the current version, lockfiles left alone.
async function versionFiles($: EngineInterface, current: string) {
  const escaped = current.replace(/\./g, '\\.')
  const found = await git($, 'grep', '-l', '-E', '-e', `"version"[[:space:]]*:[[:space:]]*"${escaped}"`, '-e', `^version[[:space:]]*=[[:space:]]*"${escaped}"`, '--', '*.json', '*.toml', ':!*lock*')
  return found.stdout.split('\n').filter(Boolean)
}

async function bumpFiles($: EngineInterface, files: string[], from: string, to: string) {
  const bumped: string[] = []
  for (const file of files) {
    const text = await $.fs.read(`${cwd}/${file}`)
    const updated = release.bumpText(text, from, to)
    if (updated === undefined) continue
    await $.fs.write(`${cwd}/${file}`, updated)
    bumped.push(file)
  }
  return bumped
}

// Version from the last tag and the commits since it; files bumped, release commit, annotated tag, pushed.
async function releaseVersion($: EngineInterface, model: string): Promise<Outcome> {
  if ((await git($, 'status', '--porcelain')).stdout.trim()) return { handoff: 'the working tree has uncommitted changes; commit or stash them before releasing.' }
  const lastTag = (await git($, 'describe', '--tags', '--abbrev=0')).stdout.trim()
  const current = release.parseVersion(lastTag)
  if (!current) return { handoff: lastTag ? `the last tag ${lastTag} is not plain x.y.z, so token-saver cannot pick the next version.` : 'no previous tag; ask the user for the first version.' }
  const log = (await git($, 'log', `${lastTag}..HEAD`, '--format=%s%n%b%x1e')).stdout
  const messages = log.split('\x1e').map(message => message.trim()).filter(Boolean)
  if (messages.length === 0) return { summary: `nothing to release since ${lastTag}` }
  const level = release.levelOf(messages, current)
  const next = release.nextVersion(current, level)
  const [from, to, tag] = [release.format(current), release.format(next), `${next.prefix}${release.format(next)}`]
  if ((await git($, 'rev-parse', '-q', '--verify', `refs/tags/${tag}`)).exitCode === 0) return { handoff: `tag ${tag} already exists.` }

  const question = `Release ${tag} (${level}, ${messages.length} commits since ${lastTag}): bump, commit, tag and push?`
  const answer = await $.ui.ask(question, ['Release', 'Cancel']).catch(() => 'Cancel')
  if (answer !== 'Release') return { summary: 'release cancelled.' }

  const bumped = await bumpFiles($, await versionFiles($, from), from, to)
  if (bumped.length) {
    await $.process.run(['sh', '-c', 'exec git "$@"', 'git', 'add', '--', ...bumped], { cwd })
    const committed = await git($, 'commit', '-m', `chore: release ${to}`)
    if (committed.exitCode !== 0) return { handoff: `release commit failed:\n${tail(committed.stdout + committed.stderr)}` }
  }
  const subjects = messages.map(message => message.split('\n')[0] ?? '').filter(subject => !/^chore: release/.test(subject))
  const notes = await releaseNotes($, model, tag, subjects)
  const tagged = await git($, 'tag', '-a', tag, '-m', `${tag}: ${notes}`)
  if (tagged.exitCode !== 0) return { handoff: `git tag failed:\n${tail(tagged.stderr)}` }

  const done = `${tag} (${level}${bumped.length ? `, bumped ${bumped.join(', ')}` : ''})`
  if (!(await git($, 'remote')).stdout.trim()) return { summary: `released. ${done}, no remote to push to` }
  const pushed = await push($, undefined)
  if ('handoff' in pushed) return { handoff: `released ${done}, then ${pushed.handoff}` }
  const pushedTag = await git($, 'push', 'origin', tag)
  if (pushedTag.exitCode !== 0) return { handoff: `released ${done}, then pushing the tag failed:\n${tail(pushedTag.stderr)}` }
  return { summary: `released. ${done}, pushed with the tag` }
}

async function deploy($: EngineInterface, command: string): Promise<Outcome> {
  const answer = await $.ui.ask(`Run deploy command \`${command}\`?`, ['Deploy', 'Cancel']).catch(() => 'Cancel')
  if (answer !== 'Deploy') return { summary: 'deploy cancelled.' }
  const result = await shell($, command, DEPLOY_TIMEOUT_MS)
  if (result.exitCode !== 0) return { handoff: `\`${command}\` failed (exit ${result.exitCode}):\n${tail(result.stdout + result.stderr)}` }
  return { summary: `deployed. (\`${command}\`)` }
}

type Plan = { commitModel: string; mergedInto?: string; messageTimings: MessageTiming[] }

async function perform($: EngineInterface, action: router.Action, plan: Plan): Promise<Outcome> {
  if (action === 'commit') return commit($, plan.commitModel, plan.messageTimings)
  if (action === 'merge') return merge($)
  if (action === 'push') return push($, plan.mergedInto)
  if (action === 'pull') return pull($)
  if (action === 'release') return releaseVersion($, plan.commitModel)
  if (action === 'stop') return stop($)
  if (action === 'restart') {
    if (await runningServer($)) {
      const stopped = await stop($)
      if ('handoff' in stopped) return stopped
    }
    const started = await perform($, 'run', plan)
    return 'summary' in started ? { summary: `re${started.summary}` } : started
  }
  const command = project.commandFor(action, await loadProject($))
  if (!command) {
    if (action !== 'deploy') learningAction = action
    const hint = action === 'deploy' ? ' Deploy runs only from "deploy" in .claude/quickrun.json.' : ''
    return { handoff: `token-saver found no ${action} command for this project.${hint}` }
  }
  if (action === 'test') return test($, command)
  if (action === 'run') return run($, command)
  return deploy($, command)
}

export async function report($: EngineInterface) { return statsReport((await $.store.get('stats')) as Stats | undefined) }

let commitModel = 'haiku'

export const configure = (options: Record<string, unknown>) => {
  commitModel = String(options.commitModel ?? 'haiku')
}

export async function onSessionStart($: EngineInterface, e: any) {
  cwd = e.cwd
  sessionId = await $.session.id()
}

export async function onPrompt($: EngineInterface, e: any, next: any) {
  const passOn = async (extra: string[] = []) => {
    const notes = await takeNotes($)
    const noteBlock = notes.length ? [`[token-saver] Since your last turn the user ran, without you: ${notes.join('; ')}`] : []
    const context = [...(e.context ?? []), ...noteBlock, ...extra]
    return next(context.length ? { ...e, context } : e)
  }
  if (e.command || e.isMeta || !HUMAN_ORIGINS.has(e.origin.kind)) return passOn()

  const actions = router.route(e.text)
  if (!actions) return passOn()

  const done: string[] = []
  doneThisPrompt = done
  const plan: Plan = { commitModel, messageTimings: [] }
  const announcement = `token-saver is running ${actions.join(' + ')} itself, without the model`
  $.ui.toast(announcement)
  $.ui.log(announcement)
  for (const action of actions) {
    $.ui.status(`token-saver: ${action}…`)
    const outcome = await perform($, action, plan).catch(error => ({ handoff: `${action} threw: ${error}` }))
    if ('handoff' in outcome) {
      $.ui.status(undefined)
      $.ui.log(`token-saver could not finish ${action}; handing your prompt to the model`)
      const before = done.length ? `token-saver already did: ${done.join('; ')}. ` : ''
      return passOn([`[token-saver] ${before}Then ${action} needs you. ${outcome.handoff}`])
    }
    if (outcome.mergedInto) plan.mergedInto = outcome.mergedInto
    done.push(outcome.summary)
  }
  $.ui.status(undefined)
  await addNotes($, done)
  await recordStats($, actions, plan.messageTimings[0])
  return { drop: `${DONE_PREFIX}${done.join(' · ')}` }
}

// A hook that dies after running actions must not pass the prompt on, or the main model repeats them.
export async function onPromptError($: EngineInterface, e: any, next: any) {
  $.ui.status(undefined)
  if (next.called || doneThisPrompt.length === 0) return next(e)
  await addNotes($, doneThisPrompt)
  return { drop: `${DONE_PREFIX}${doneThisPrompt.join(' · ')} (then stopped: hook timed out or failed)` }
}

export async function onBash($: EngineInterface, e: any, next: any) {
  const result = await next(e)
  if (!learningAction || result.isError || ('deny' in result && result.deny)) return result
  const command = project.learnable(learningAction, e.command, e.run_in_background === true)
  if (command) {
    await remember($, learningAction, command)
    learningAction = undefined
  }
  return result
}

export const onTurnComplete = () => {
  learningAction = undefined
}

export async function onSessionEnd($: EngineInterface) {
  await $.store.delete(notesKey())
}
