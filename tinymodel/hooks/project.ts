export type ProjectAction = 'run' | 'test' | 'deploy'
export type Commands = Partial<Record<ProjectAction, string>>
export type Project = {
  files: ReadonlySet<string>
  packageJson?: string
  config: Commands
  learned: Commands
}

const RUN_SCRIPTS = ['dev', 'start', 'serve']

const packageRunner = (files: ReadonlySet<string>) => {
  if (files.has('bun.lock') || files.has('bun.lockb')) return (script: string) => `bun run ${script}`
  if (files.has('pnpm-lock.yaml')) return (script: string) => `pnpm ${script}`
  if (files.has('yarn.lock')) return (script: string) => `yarn ${script}`
  return (script: string) => `npm run ${script}`
}

const scriptsOf = (packageJson: string | undefined): Record<string, string> => {
  try {
    return JSON.parse(packageJson ?? '{}').scripts ?? {}
  } catch {
    return {}
  }
}

const fromPackageJson = (action: ProjectAction, project: Project) => {
  const scripts = scriptsOf(project.packageJson)
  const runner = packageRunner(project.files)
  if (action === 'run') {
    const script = RUN_SCRIPTS.find(name => scripts[name])
    return script ? runner(script) : undefined
  }
  if (action === 'test' && scripts.test && !/no test specified/.test(scripts.test)) return runner('test')
  return undefined
}

const fromProjectFiles = (action: ProjectAction, files: ReadonlySet<string>) => {
  if (action === 'run') {
    if (files.has('manage.py')) return 'uv run manage.py runserver'
    if (files.has('pyproject.toml') && files.has('main.py')) return 'uv run main.py'
    if (files.has('Cargo.toml')) return 'cargo run'
    if (files.has('go.mod')) return 'go run .'
  }
  if (action === 'test') {
    if (files.has('pyproject.toml') || files.has('pytest.ini')) return 'uv run pytest'
    if (files.has('Cargo.toml')) return 'cargo test'
    if (files.has('go.mod')) return 'go test ./...'
  }
  return undefined
}

// Deploy never guesses: only the project's own config names it.
export const commandFor = (action: ProjectAction, project: Project): string | undefined => {
  if (project.config[action]) return project.config[action]
  if (action === 'deploy') return undefined
  return fromPackageJson(action, project) ?? project.learned[action] ?? fromProjectFiles(action, project.files)
}

const MAX_LEARNED_LENGTH = 150

// The command the main model used after a hand-off, cleaned to what tinymodel can rerun, or undefined.
// Only a background Bash call starts a server; the model's probes (curl, cat, ls) run in the foreground.
export const learnable = (action: ProjectAction, command: string, isBackground: boolean): string | undefined => {
  if (command.includes('\n') || command.includes('<<')) return undefined
  const withoutCd = command.replace(/^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*(&&|;)\s*/, '')
  if (/&&|\|\||;/.test(withoutCd)) return undefined
  const cleaned = withoutCd.replace(/\s*(2>&1\s*)?\|.*$/, '').trim()
  if (cleaned.length === 0 || cleaned.length > MAX_LEARNED_LENGTH || /&/.test(cleaned)) return undefined
  if (action === 'run' && isBackground && /\b(dev|start|serve|runserver|run|up)\b/.test(cleaned)) return cleaned
  if (action === 'test' && /^\S+\s.*\b(test|pytest|vitest|jest)\b|^(pytest|vitest|jest)\b/.test(cleaned)) return cleaned
  return undefined
}
