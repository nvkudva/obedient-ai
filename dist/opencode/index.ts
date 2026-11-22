// OpenCode entrypoint for the obedient-ai plugin. Runs from dist/opencode, where
// tools/sync.py puts context.md (the shared rules plus rules/opencode.md) and skills/
// beside it. OpenCode injects the rules through ctx.session.hook("context") and
// registers the skills through ctx.skill.transform.

import { Plugin } from "@opencode/plugin";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = fileURLToPath(new URL(".", import.meta.url));
const contextFile = join(pluginRoot, "context.md");
const skillsRoot = join(pluginRoot, "skills");

async function readContext() {
  try {
    return (await readFile(contextFile, "utf8")).trim();
  } catch {
    // Not fatal, but never silent: the session would look normal without its rules.
    console.warn(`obedient-ai: missing context file ${contextFile}`);
    return "";
  }
}

const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function parseFrontmatter(text) {
  const match = frontmatter.exec(text);
  if (!match) return { attributes: {}, body: text };
  const attributes = {};
  let key = null;
  for (const line of match[1].split(/\r?\n/)) {
    const entry = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (entry) {
      key = entry[1];
      attributes[key] = entry[2].trim();
    } else if (key && line.trim()) {
      // Folded or plain multi-line value: join continuation lines.
      attributes[key] = `${attributes[key]} ${line.trim()}`.replace(/^[>|]\s*/, "").trim();
    }
  }
  return { attributes, body: text.slice(match[0].length) };
}

async function readSkills() {
  let entries;
  try {
    entries = await readdir(skillsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills = [];
  for (const entry of entries.filter((item) => item.isDirectory())) {
    const path = join(skillsRoot, entry.name, "SKILL.md");
    let text;
    try {
      text = await readFile(path, "utf8");
    } catch {
      continue;
    }
    const { attributes, body } = parseFrontmatter(text);
    skills.push({
      id: entry.name,
      name: attributes.name || entry.name,
      description: attributes.description || "",
      autoinvoke: true,
      path,
      content: body.trim(),
    });
  }
  return skills;
}

export default Plugin.define({
  id: "obedient-ai",
  async setup(ctx) {
    const context = await readContext();
    if (context) {
      await ctx.session.hook("context", (event) => {
        event.system.push({ type: "text", text: context });
      });
    }

    const skills = await readSkills();
    if (skills.length > 0) {
      await ctx.skill.transform((editor) => {
        for (const skill of skills) editor.add(skill);
      });
    }
  },
});
