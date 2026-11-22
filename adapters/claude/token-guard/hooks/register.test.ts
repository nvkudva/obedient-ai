import { expect, test } from 'claude-code/testing'
import { normalizeError } from './register'

test('error keys ignore digits and the exit-code line', () => {
  expect(normalizeError('Exit code 1\ncat: /a/file: No such file (os error 2)')).toBe(
    normalizeError('Exit code 2\ncat: /a/file: No such file (os error 9)'),
  )
})

test('the third identical failure in a turn gets a stop note, once', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('clock.now', () => ({ value: 0 }))
  on('session.usage', () => ({ value: { context: {} } }))
  on('tool.call', () => ({ isError: true, result: undefined, text: 'Exit code 1\nboom 7' }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })

  const notes: boolean[] = []
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const result = await $.tool.call({ tool: 'Bash', command: 'false' })
    notes.push((result.context ?? []).length > 0)
  }
  expect(notes).toEqual([false, false, true, false])
})
