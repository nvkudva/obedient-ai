import { expect, test } from 'claude-code/testing'

type Run = { exitCode: number; stdout: string; stderr: string; isStdoutTruncated: boolean; isStderrTruncated: boolean }
const result = (exitCode: number, stdout: string, stderr = ''): Run => ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })
const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const GIT_DEFAULTS: Array<[string, Run]> = [
  ['diff --cached --name-only', result(0, 'greet.js\n')],
  ['rev-parse --short', result(0, 'abc1234\n')],
  ['rev-parse --abbrev-ref', result(0, 'main\n')],
  ['symbolic-ref', result(0, 'origin/main\n')],
]

// Prefix-matched answers for `git ...` as register.ts runs it through `sh -c 'exec git "$@"' git <args>`.
const setup = async ($: any, on: any, gitAnswers: Array<[string, Run]> = []) => {
  const gitCalls: string[] = []
  const store = new Map<string, unknown>()
  const seen: string[] = []
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => {
    const gitArgs = e.argv.slice(4).join(' ')
    gitCalls.push(gitArgs)
    const answer = [...gitAnswers, ...GIT_DEFAULTS].find(([prefix]) => gitArgs.startsWith(prefix))
    return { value: answer?.[1] ?? result(0, '') }
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: 'feat: add greet', usage } }))
  on('ui.status', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 0 }))
  on('session.id', () => ({ value: 's1' }))
  on('command.register', () => ({ value: undefined }))
  on('store.get', (_: unknown, e: { key: string }) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => (store.set(e.key, e.value), { value: undefined }))
  on('store.delete', (_: unknown, e: { key: string }) => (store.delete(e.key), { value: undefined }))
  on('prompt.submit', (_: unknown, e: { text: string; context?: readonly string[] }) => {
    seen.push((e.context ?? []).join('\n'))
    return { text: e.text, context: e.context }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const submit = (text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
  return { gitCalls, store, seen, submit }
}

test('a handled command is dropped, and the next prompt tells the model what ran', async ($, on) => {
  const { seen, submit } = await setup($, on)
  const handled = await submit('comit n psuh')
  expect(handled.drop).toBe('tinymodel: committed abc1234 "feat: add greet" (message by haiku, 0 ms) · pushed main')
  expect(seen.length).toBe(0)

  await submit('explain the greet helper')
  expect(seen[0]).toContain('committed abc1234')
})

test('a failed push hands the prompt to the model with the error, after the commit', async ($, on) => {
  const { seen, submit } = await setup($, on, [['push', result(1, '', 'rejected: non-fast-forward')]])
  await submit('commit and push')
  expect(seen[0]).toContain('already did: committed abc1234')
  expect(seen[0]).toContain('non-fast-forward')
})

test('files that look like secrets are unstaged and nothing is committed', async ($, on) => {
  const { gitCalls, seen, submit } = await setup($, on, [['diff --cached --name-only', result(0, 'app.ts\n.env\n.env.example\n')]])
  await submit('commit')
  expect(gitCalls).toContain('reset -q -- .env')
  expect(gitCalls.some(call => call.startsWith('commit'))).toBe(false)
  expect(seen[0]).toContain('look like secrets (.env)')
})

test('merge fast-forwards main in its own worktree, then push pushes main', async ($, on) => {
  const { gitCalls, submit } = await setup($, on, [
    ['rev-parse --abbrev-ref', result(0, 'feature\n')],
    ['worktree list', result(0, 'worktree /repo-main\nHEAD 1\nbranch refs/heads/main\n\nworktree /repo\nHEAD 2\nbranch refs/heads/feature\n')],
  ])
  const handled = await submit('merge n push')
  expect(gitCalls).toContain('-C /repo-main merge --ff-only feature')
  expect(gitCalls).toContain('push origin main')
  expect(handled.drop).toBe('tinymodel: merged feature into main · pushed main')
})

test('a merge that cannot fast-forward goes to the main model', async ($, on) => {
  const { seen, submit } = await setup($, on, [
    ['rev-parse --abbrev-ref', result(0, 'feature\n')],
    ['fetch .', result(1, '', 'rejected: non-fast-forward')],
  ])
  await submit('merge')
  expect(seen[0]).toContain('fast-forward merge of feature into main failed')
})

test('stop without a server tinymodel started goes to the main model; pull fast-forwards', async ($, on) => {
  const { gitCalls, seen, submit } = await setup($, on)
  await submit('stop dev server')
  expect(seen[0]).toContain('no running server it started')
  const pulled = await submit('pull latest')
  expect(gitCalls).toContain('pull --ff-only')
  expect(pulled.drop).toBe('tinymodel: pulled main')
})

test('/tinymodel reports handled prompts and estimated savings', async ($, on) => {
  const { submit } = await setup($, on)
  await submit('commit')
  const report = await ($ as any).command.run({ command: 'tinymodel', args: '' })
  expect(report.text).toContain('handled 1 prompts (commit 1)')
  expect(report.text).toContain('~$0.72')
  expect(report.text).toContain('haiku 0 ms (1)')
})
