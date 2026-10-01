## Coding style (all languages)

- Call local code through its owner: `<module|class>.<function>()`. The call site
  shows where the function lives.
  - JS/TS: `import * as tools from "./tools.js"` then `tools.run()`.
  - Python: `import tools` then `tools.run()`. Not `from tools import run`.
  - Go, Rust, Swift: same idea. Use the package or module path: `tools.Run()`, `tools::run()`.
  - Java, C#, Kotlin: static or instance call on the class: `Tools.run()`.
- Name exports so the qualified call reads clean: `tools.run`, not `tools.runTool`.
  No stutter: no `agent.runAgent`, no `io.ioRead`.
- Bare imports only for: a single export used alone, standard-library or
  well-known third-party names (`fs`, `os`, `Path`, `useState`), types, and
  decorators or macros.
- Match the file's existing import style when it already differs.
