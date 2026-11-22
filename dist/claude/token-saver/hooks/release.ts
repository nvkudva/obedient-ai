export type Level = 'major' | 'minor' | 'patch'
export type Version = { prefix: string; major: number; minor: number; patch: number }

export const parseVersion = (tag: string): Version | undefined => {
  const match = tag.match(/^(v?)(\d+)\.(\d+)\.(\d+)$/)
  if (!match) return undefined
  return { prefix: match[1] ?? '', major: Number(match[2]), minor: Number(match[3]), patch: Number(match[4]) }
}

export const format = (version: Version) => `${version.major}.${version.minor}.${version.patch}`

// Conventional Commits: a breaking change bumps major (minor while still 0.x), feat bumps minor, the rest patch.
export const levelOf = (messages: string[], current: Version): Level => {
  const isBreaking = messages.some(message => /^\w+(\([^)]*\))?!:/.test(message) || /BREAKING CHANGE/.test(message))
  if (isBreaking) return current.major === 0 ? 'minor' : 'major'
  return messages.some(message => /^feat(\([^)]*\))?:/.test(message)) ? 'minor' : 'patch'
}

export const nextVersion = (current: Version, level: Level): Version => {
  if (level === 'major') return { ...current, major: current.major + 1, minor: 0, patch: 0 }
  if (level === 'minor') return { ...current, minor: current.minor + 1, patch: 0 }
  return { ...current, patch: current.patch + 1 }
}

// Only the first version field of a manifest: package.json's own, not a nested one.
export const bumpText = (text: string, from: string, to: string): string | undefined => {
  const field = new RegExp(`("version"\\s*:\\s*"|^version\\s*=\\s*")${from.replace(/\./g, '\\.')}"`, 'm')
  if (!field.test(text)) return undefined
  return text.replace(field, `$1${to}"`)
}

export const fallbackNotes = (subjects: string[]) => subjects.map(subject => `- ${subject}`).join('\n')
