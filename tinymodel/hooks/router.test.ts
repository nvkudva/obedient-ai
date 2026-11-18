import { expect, test } from 'claude-code/testing'
import * as router from './router'
import * as project from './project'

test('command words with typos route in a fixed order', () => {
  expect(router.route('comit n psuh')).toEqual(['commit', 'push'])
  expect(router.route('deploy, commit and push')).toEqual(['commit', 'push', 'deploy'])
  expect(router.route('commit and merge')).toEqual(['commit', 'merge'])
  expect(router.route('merge push')).toEqual(['merge', 'push'])
  expect(router.route('run tests')).toEqual(['test'])
  expect(router.route('run dev server')).toEqual(['run'])
  expect(router.route('push it to prod')).toEqual(['push', 'deploy'])
  expect(router.route('pull latest')).toEqual(['pull'])
  expect(router.route('stop all servers')).toEqual(['stop'])
  expect(router.route('stop all servers and restart')).toEqual(['restart'])
  expect(router.route('restart dev server')).toEqual(['restart'])
})

test('questions, work requests, paraphrases and bare run go to the main model', () => {
  const texts = [
    'what does deploy.sh do', 'run the tests and fix failures', 'why did push fail?', 'commit and version',
    'stop', 'restart', 'run it', 'run this', 'kill the dev server', 'fire up the dev server', 'merge that remote branch',
  ]
  for (const text of texts) expect(router.route(text)).toBe(undefined)
})

test('the run command comes from package.json with the lockfile tool, deploy only from config', () => {
  const base = { files: new Set(['package.json', 'bun.lock']), packageJson: '{"scripts":{"dev":"vite"}}', config: {}, learned: {} }
  expect(project.commandFor('run', base)).toBe('bun run dev')
  expect(project.commandFor('deploy', base)).toBe(undefined)
  expect(project.commandFor('deploy', { ...base, config: { deploy: './deploy.sh' } })).toBe('./deploy.sh')
  expect(project.commandFor('run', { ...base, packageJson: '{}', learned: { run: 'uv run app serve' } })).toBe('uv run app serve')
})

test('only clean background start commands are learned', () => {
  expect(project.learnable('run', 'cd /a/b && bun run dev', true)).toBe('bun run dev')
  expect(project.learnable('run', 'bun run dev', false)).toBe(undefined)
  expect(project.learnable('run', 'ls node_modules || bun install; bun run dev', true)).toBe(undefined)
  expect(project.learnable('test', 'npm test 2>&1 | tail -40', false)).toBe('npm test')
})
