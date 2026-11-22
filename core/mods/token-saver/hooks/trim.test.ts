import { expect, test } from 'claude-code/testing'
import { normalizeError } from './trim'

test('error keys ignore digits and the exit-code line', () => {
  expect(normalizeError('Exit code 1\ncat: /a/file: No such file (os error 2)')).toBe(
    normalizeError('Exit code 2\ncat: /a/file: No such file (os error 9)'),
  )
})

test('the third identical failure in a turn gets a stop note, once', async ($, on) => {
  on('clock.every', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
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


test('/token-saver off trim stops the stop note, /token-saver on trim restores it', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('clock.now', () => ({ value: 0 }))
  on('clock.every', () => ({ value: undefined }))
  on('session.usage', () => ({ value: { context: {} } }))
  const store = new Map<string, unknown>()
  on('store.get', (_: unknown, e: { key: string }) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => (store.set(e.key, e.value), { value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', () => ({ isError: true, result: undefined, text: 'Exit code 1\nboom 7' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const run = (args: string) => ($ as any).command.run({ command: 'token-saver', args })
  const noteCount = async (turnId: string) => {
    await $.turn.start({ text: 'go', turnId })
    let notes = 0
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const result = await $.tool.call({ tool: 'Bash', command: 'false' })
      notes += (result.context ?? []).length
    }
    return notes
  }

  expect((await run('off trim')).text).toBe('trim is off.')
  expect(await noteCount('t1')).toBe(0)
  expect((await run('on trim')).text).toBe('trim is on.')
  expect(await noteCount('t2')).toBe(1)
})
