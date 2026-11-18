export type Action = 'pull' | 'commit' | 'merge' | 'push' | 'test' | 'deploy' | 'stop' | 'restart' | 'run'

const MAX_WORDS = 6
const ACTION_ORDER: Action[] = ['pull', 'commit', 'merge', 'push', 'test', 'deploy', 'stop', 'restart', 'run']

const ACTION_WORDS: Record<string, Action> = {
  pull: 'pull', stop: 'stop', restart: 'restart', commit: 'commit', merge: 'merge', push: 'push', deploy: 'deploy', ship: 'deploy',
  test: 'test', tests: 'test', run: 'run', start: 'run', serve: 'run', prod: 'deploy', production: 'deploy',
}
// Bare "run it" usually means a script just written (1 of 13 started a server in past sessions), and a bare
// "stop" usually means stop the model, so server actions need a target.
const SERVER_ACTIONS = new Set<Action>(['run', 'stop', 'restart'])
const SERVER_TARGETS = new Set(['dev', 'server', 'servers', 'app', 'start', 'serve'])
const FILLER_WORDS = new Set([
  'it', 'this', 'that', 'all', 'and', 'n', 'then', 'the', 'my', 'these', 'current', 'now', 'please', 'pls',
  'ok', 'okay', 'lets', 'go', 'changes', 'change', 'code', 'everything', 'to', 'origin', 'main', 'git',
  'locally', 'local', 'app', 'server', 'servers', 'dev', 'project', 'again', 'up', 'latest',
])
// A prompt with any of these asks for thinking, not a fixed command.
const BLOCKING_WORDS = new Set([
  'what', 'why', 'how', 'when', 'where', 'which', 'who', 'does', 'did', 'is', 'are', 'can', 'should',
  'fix', 'add', 'explain', 'refactor', 'update', 'remove', 'delete', 'write', 'implement', 'check', 'debug',
  'review', 'make', 'create', 'not', 'dont', 'don', 'no', 'without', 'after', 'before', 'if', 'until', 'but',
  'failing', 'failed', 'fails', 'error', 'errors', 'broken', 'only', 'except', 'skip', 'plan',
  'kill',
])

const wordsOf = (text: string) => text.toLowerCase().replace(/['’]/g, '').split(/[^a-z0-9.\/_-]+/).filter(Boolean)

// Damerau-Levenshtein; a distance of 1 covers for "comit", "psuh", "deploi".
const editDistance = (a: string, b: string) => {
  const width = b.length + 1
  const cells = new Array<number>((a.length + 1) * width).fill(0)
  const at = (i: number, j: number) => cells[i * width + j] ?? 0
  for (let i = 0; i <= a.length; i++) cells[i * width] = i
  for (let j = 0; j <= b.length; j++) cells[j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, at(i - 2, j - 2) + 1)
      cells[i * width + j] = best
    }
  }
  return at(a.length, b.length)
}

const actionOfWord = (word: string): Action | undefined => {
  const exact = ACTION_WORDS[word]
  if (exact) return exact
  if (word.length < 4) return undefined
  const close = Object.keys(ACTION_WORDS).find(known => known.length >= 4 && editDistance(word, known) <= 1)
  return close ? ACTION_WORDS[close] : undefined
}

const inOrder = (actions: Iterable<Action>) => {
  const wanted = new Set(actions)
  if (wanted.has('test')) wanted.delete('run') // "run tests" means test
  if (wanted.has('restart')) {
    wanted.delete('stop') // "stop servers and restart" means restart
    wanted.delete('run')
  }
  return ACTION_ORDER.filter(action => wanted.has(action))
}

const isGuarded = (text: string) => {
  const words = wordsOf(text)
  if (words.length === 0 || words.length > MAX_WORDS || text.includes('?')) return true
  return words.some(word => BLOCKING_WORDS.has(word) || /[.\/]/.test(word))
}

const actionsFromWords = (text: string): Action[] | undefined => {
  const actions: Action[] = []
  const words = wordsOf(text)
  for (const word of words) {
    if (FILLER_WORDS.has(word)) continue
    const action = actionOfWord(word)
    if (!action) return undefined
    actions.push(action)
  }
  const ordered = inOrder(actions)
  if (ordered.some(action => SERVER_ACTIONS.has(action)) && !words.some(word => SERVER_TARGETS.has(word))) return undefined
  return ordered.length > 0 ? ordered : undefined
}

// Every word an action word or filler; anything else (a paraphrase, "commit and version") is the main model's job.
export const route = (text: string): Action[] | undefined => (isGuarded(text) ? undefined : actionsFromWords(text))
