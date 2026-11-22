import { expect, test } from 'claude-code/testing'
import * as router from './router'
import * as project from './project'
import * as release from './release'

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
  expect(router.route('commit and tag')).toEqual(['commit', 'release'])
  expect(router.route('bump version n push')).toEqual(['release'])
  expect(router.route('rlease')).toEqual(['release'])
  expect(router.route('merge to main.')).toEqual(['merge'])
  expect(router.route('push them')).toEqual(['push'])
  expect(router.route('comimt n ppush')).toEqual(['commit', 'push'])
})

test('questions, work requests, paraphrases and bare run go to the main model', () => {
  const texts = [
    'what does deploy.sh do', 'run the tests and fix failures', 'why did push fail?', 'commit and changelog', 'which version is this', 'yes', 'hi', 'try again', 'yup', 'rerun',
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

test('the next version follows the commits since the last tag', () => {
  const v1 = release.parseVersion('v1.4.2')!
  const v0 = release.parseVersion('0.26.0')!
  expect(release.parseVersion('v1.0-beta.3')).toBe(undefined)
  expect(release.format(release.nextVersion(v1, release.levelOf(['fix: typo'], v1)))).toBe('1.4.3')
  expect(release.format(release.nextVersion(v1, release.levelOf(['fix: a', 'feat(ui): b'], v1)))).toBe('1.5.0')
  expect(release.format(release.nextVersion(v1, release.levelOf(['feat!: drop node 18'], v1)))).toBe('2.0.0')
  expect(release.format(release.nextVersion(v0, release.levelOf(['refactor: x\n\nBREAKING CHANGE: y'], v0)))).toBe('0.27.0')
})

test('only the first version field is bumped', () => {
  const manifest = '{\n  "version": "0.26.0",\n  "deps": { "a": { "version": "0.26.0" } }\n}'
  expect(release.bumpText(manifest, '0.26.0', '0.27.0')).toBe('{\n  "version": "0.27.0",\n  "deps": { "a": { "version": "0.26.0" } }\n}')
  expect(release.bumpText('[package]\nversion = "1.2.3"\n', '1.2.3', '1.3.0')).toBe('[package]\nversion = "1.3.0"\n')
  expect(release.bumpText('{ "version": "9.9.9" }', '1.2.3', '1.3.0')).toBe(undefined)
})
