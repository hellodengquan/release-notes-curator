import { CATEGORY_DESCRIPTIONS } from "./config.js";
import { readFileSync, existsSync } from "node:fs";

const KEEPACHANGELOG_SECTIONS = [
  "Breaking Changes",
  "Added",
  "Changed",
  "Deprecated",
  "Removed",
  "Fixed",
  "Security",
  "Yanked",
];

const VERSION_HEADER_RE = /^##\s+\[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?\s*$/m;
const LOOSE_VERSION_HEADER_RE = /^##\s+(?:\[)?(v?\d+\.\d+\.\d+|Unreleased)(?:\])?(?:\s*-\s*(\d{4}-\d{2}-\d{2}))?\s*$/i;

export function render(groups, options = {}) {
  const template = options.template || "default";

  switch (template) {
    case "keepachangelog":
      return generateKeepAChangelog(groups, options);
    case "release-notes-yaml":
      return generateReleaseNotesYaml(groups, options);
    default:
      return generateMarkdown(groups, options);
  }
}

export function generateMarkdown(groups, options = {}) {
  const { version, repoUrl, date } = options;
  const lines = [];

  const title = version ? `Release Notes - ${version}` : "Release Notes";
  lines.push(`# ${title}`);
  lines.push("");

  if (date) {
    lines.push(`> ${date}`);
    lines.push("");
  }

  const totalCommits = [...groups.values()].reduce((sum, items) => sum + items.length, 0);
  lines.push(
    `**Total Changes**: ${totalCommits} commit${totalCommits !== 1 ? "s" : ""} across ${groups.size} categor${groups.size !== 1 ? "ies" : "y"}`,
  );
  lines.push("");

  lines.push("---");
  lines.push("");

  for (const [category, commits] of groups) {
    const desc = CATEGORY_DESCRIPTIONS[category] || "";
    lines.push(`## ${category}`);
    if (desc) {
      lines.push("");
      lines.push(`*${desc}*`);
    }
    lines.push("");

    for (const commit of commits) {
      const bullet = formatCommit(commit, repoUrl, "default");
      lines.push(`- ${bullet}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

export function generateKeepAChangelog(groups, options = {}) {
  const { version, date } = options;
  const lines = [];

  const versionStr = version || "Unreleased";
  const dateStr = date || "";
  const header = dateStr ? `[${versionStr}] - ${dateStr}` : `[${versionStr}]`;
  lines.push(`## ${header}`);
  lines.push("");

  const categoryMap = {
    "💥 Breaking Changes": "Breaking Changes",
    "🚀 Features": "Added",
    "🐛 Bug Fixes": "Fixed",
    "🔒 Security": "Security",
    "♻️ Refactoring": "Changed",
    "⚡ Performance": "Changed",
    "📝 Documentation": "Changed",
    "🎨 Style": "Changed",
    "✅ Tests": "Changed",
    "🔧 Chore": "Changed",
    "📌 Yanked": "Yanked",
    "📦 Uncategorized": "Changed",
  };

  const merged = new Map();
  for (const [category, commits] of groups) {
    const kaSection = categoryMap[category] || "Changed";
    if (!merged.has(kaSection)) merged.set(kaSection, []);
    merged.get(kaSection).push(...commits);
  }

  const sectionOrder = [
    "Breaking Changes",
    "Added",
    "Changed",
    "Deprecated",
    "Removed",
    "Fixed",
    "Security",
    "Yanked",
  ];
  for (const section of sectionOrder) {
    const commits = merged.get(section);
    if (!commits || commits.length === 0) continue;

    lines.push(`### ${section}`);
    lines.push("");

    for (const commit of commits) {
      const bullet = formatCommit(commit, null, "keepachangelog");
      lines.push(`- ${bullet}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

export function generateReleaseNotesYaml(groups, options = {}) {
  const { version, date, repoUrl } = options;
  const lines = [];

  lines.push(`title: "${version || "Unreleased"}"`);
  if (date) lines.push(`date: "${date}"`);
  lines.push("");

  const totalCommits = [...groups.values()].reduce((sum, items) => sum + items.length, 0);
  lines.push(`total_commits: ${totalCommits}`);
  lines.push("");

  for (const [category, commits] of groups) {
    const yamlKey = categoryToYamlKey(category);
    lines.push(`${yamlKey}:`);
    lines.push("");

    for (const commit of commits) {
      const desc = escapeYaml(commit.description);
      const author = escapeYaml(commit.author);
      const prStr = commit.prNumber ? ` pr: "${commit.prNumber}"` : "";
      const breakingStr = commit.breakingChange ? ` breaking: true` : "";
      const scopeStr = commit.scope ? ` scope: "${escapeYaml(commit.scope)}"` : "";
      const pkgStr =
        commit.affectedPackages && commit.affectedPackages.length > 0
          ? ` packages: [${commit.affectedPackages.map((p) => `"${escapeYaml(p)}"`).join(", ")}]`
          : "";

      lines.push(`  - description: "${desc}"`);
      lines.push(`    author: "${author}"`);
      lines.push(`    hash: "${commit.hash}"`);
      if (prStr) lines.push(`    pr: "${commit.prNumber}"`);
      if (scopeStr) lines.push(`    scope: "${escapeYaml(commit.scope)}"`);
      if (breakingStr) lines.push(`    breaking: true`);
      if (pkgStr) {
        lines.push(`    packages:`);
        for (const p of commit.affectedPackages) {
          lines.push(`      - "${escapeYaml(p)}"`);
        }
      }
      if (commit.breakingChangeDescription) {
        lines.push(`    breaking_description: "${escapeYaml(commit.breakingChangeDescription)}"`);
      }
      if (repoUrl && commit.prNumber) {
        lines.push(`    url: "${repoUrl}/pull/${commit.prNumber}"`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

function categoryToYamlKey(category) {
  return category
    .replace(/^[^\w]*/, "")
    .replace(/\s+/g, "_")
    .toLowerCase();
}

function escapeYaml(str) {
  if (!str) return "";
  return str.replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function formatCommit(commit, repoUrl, template) {
  let line = commit.description;

  if (commit.scope) {
    line = `**${commit.scope}**: ${line}`;
  }

  const isBreaking = commit.breakingChange;

  if (template === "keepachangelog") {
    if (isBreaking) {
      line = `**BREAKING**: ${line}`;
      if (commit.breakingChangeDescription) {
        line += ` — ${commit.breakingChangeDescription}`;
      }
    }
    if (commit.prNumber) {
      line += ` (#${commit.prNumber})`;
    }
    return line;
  }

  if (isBreaking) {
    line = `⚠️ **BREAKING**: ${line}`;
    if (commit.breakingChangeDescription) {
      line += ` — *${commit.breakingChangeDescription}*`;
    }
  }

  if (commit.affectedPackages && commit.affectedPackages.length > 0) {
    line += ` [${commit.affectedPackages.join(", ")}]`;
  }

  if (commit.prNumber && repoUrl) {
    line += ` ([#${commit.prNumber}](${repoUrl}/pull/${commit.prNumber}))`;
  } else if (commit.prNumber) {
    line += ` (#${commit.prNumber})`;
  }

  line += ` — ${commit.author}`;

  return line;
}

export function generatePlainText(groups, options = {}) {
  const { version, date } = options;
  const lines = [];

  const title = version ? `Release Notes - ${version}` : "Release Notes";
  lines.push(title);
  lines.push("=".repeat(title.length));
  lines.push("");

  if (date) {
    lines.push(`Date: ${date}`);
    lines.push("");
  }

  for (const [category, commits] of groups) {
    lines.push(category);
    lines.push("-".repeat(category.length));
    lines.push("");

    for (const commit of commits) {
      let line = `  * ${commit.description}`;
      if (commit.scope) line = `  * [${commit.scope}] ${commit.description}`;
      if (commit.prNumber) line += ` (#${commit.prNumber})`;
      if (commit.breakingChange) line += " [BREAKING]";
      line += ` - ${commit.author}`;
      lines.push(line);
    }

    lines.push("");
  }

  return lines.join("\n");
}

export function parseKeepAChangelog(content) {
  const entries = [];
  const lines = content.split("\n");
  let currentVersion = null;
  let currentSection = null;
  let currentEntry = null;
  let pendingSections = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let versionMatch = line.match(VERSION_HEADER_RE);
    if (!versionMatch) {
      versionMatch = line.match(LOOSE_VERSION_HEADER_RE);
    }

    if (versionMatch) {
      if (currentEntry) entries.push(currentEntry);
      currentVersion = {
        version: versionMatch[1],
        date: versionMatch[2] || "",
        sections: {},
      };
      if (pendingSections.length > 0) {
        currentVersion.sections = { ...pendingSections.reduce((acc, s) => ({ ...acc, ...s }), {}) };
        pendingSections = [];
      }
      currentEntry = currentVersion;
      currentSection = null;
      continue;
    }

    if (line.startsWith("### ")) {
      currentSection = line.replace("### ", "").trim();
      if (currentVersion) {
        if (!currentVersion.sections[currentSection]) {
          currentVersion.sections[currentSection] = [];
        }
      } else {
        pendingSections.push({ [currentSection]: [] });
      }
      continue;
    }

    if (currentSection && line.startsWith("- ")) {
      const item = line.replace(/^-\s*/, "").trim();
      if (currentVersion && currentVersion.sections[currentSection]) {
        currentVersion.sections[currentSection].push(item);
      } else if (pendingSections.length > 0) {
        const last = pendingSections[pendingSections.length - 1];
        if (last[currentSection]) {
          last[currentSection].push(item);
        } else {
          last[currentSection] = [item];
        }
      }
    }
  }

  if (currentEntry) entries.push(currentEntry);

  if (pendingSections.length > 0 && entries.length === 0) {
    const fallbackEntry = {
      version: "Unreleased",
      date: "",
      sections: pendingSections.reduce((acc, s) => ({ ...acc, ...s }), {}),
    };
    entries.unshift(fallbackEntry);
  }

  return entries;
}

export function backfillKeepAChangelog(existingContent, newGroups, options = {}) {
  const { version, date, removeEmptySections = true } = options;
  const parsed = parseKeepAChangelog(existingContent || "");

  const newVersionStr = version || "Unreleased";
  const newDateStr = date || "";

  const categoryMap = {
    "💥 Breaking Changes": "Breaking Changes",
    "🚀 Features": "Added",
    "🐛 Bug Fixes": "Fixed",
    "🔒 Security": "Security",
    "♻️ Refactoring": "Changed",
    "⚡ Performance": "Changed",
    "📝 Documentation": "Changed",
    "🎨 Style": "Changed",
    "✅ Tests": "Changed",
    "🔧 Chore": "Changed",
    "📌 Yanked": "Yanked",
    "📦 Uncategorized": "Changed",
  };

  const newMerged = new Map();
  for (const [category, commits] of newGroups) {
    const kaSection = categoryMap[category] || "Changed";
    if (!newMerged.has(kaSection)) newMerged.set(kaSection, []);
    for (const c of commits) {
      const bullet = formatCommit(c, null, "keepachangelog");
      newMerged.get(kaSection).push(bullet);
    }
  }

  const newEntry = {
    version: newVersionStr,
    date: newDateStr,
    sections: Object.fromEntries(newMerged),
  };

  if (removeEmptySections) {
    for (const section of Object.keys(newEntry.sections)) {
      if (newEntry.sections[section].length === 0) {
        delete newEntry.sections[section];
      }
    }
  }

  const existingUnreleasedIdx = parsed.findIndex((e) => e.version === "Unreleased");
  if (newVersionStr === "Unreleased") {
    if (existingUnreleasedIdx !== -1) {
      const existing = parsed[existingUnreleasedIdx];
      for (const [section, items] of Object.entries(newEntry.sections)) {
        if (!existing.sections[section]) existing.sections[section] = [];
        existing.sections[section] = [...items, ...existing.sections[section]];
      }
      if (newDateStr && !existing.date) existing.date = newDateStr;
    } else {
      parsed.unshift(newEntry);
    }
  } else {
    const existingIdx = parsed.findIndex((e) => e.version === newVersionStr);
    if (existingIdx !== -1) {
      parsed[existingIdx] = newEntry;
    } else {
      const unreleasedIdx = parsed.findIndex((e) => e.version === "Unreleased");
      if (unreleasedIdx !== -1) {
        parsed.splice(unreleasedIdx, 0, newEntry);
      } else {
        parsed.unshift(newEntry);
      }
    }
  }

  const sectionOrder = [...KEEPACHANGELOG_SECTIONS];
  for (const entry of parsed) {
    const reordered = {};
    for (const s of sectionOrder) {
      if (entry.sections[s]) reordered[s] = entry.sections[s];
    }
    for (const [s, v] of Object.entries(entry.sections)) {
      if (!reordered[s]) reordered[s] = v;
    }
    entry.sections = reordered;
  }

  return renderParsedKeepAChangelog(parsed);
}

function renderParsedKeepAChangelog(entries) {
  const lines = ["# Changelog", "", "> All notable changes to this project will be documented in this file.", ""];

  for (const entry of entries) {
    const header = entry.date ? `[${entry.version}] - ${entry.date}` : `[${entry.version}]`;
    lines.push(`## ${header}`);
    lines.push("");

    for (const [section, items] of Object.entries(entry.sections)) {
      if (items.length === 0) continue;
      lines.push(`### ${section}`);
      lines.push("");
      for (const item of items) {
        lines.push(`- ${item}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n").trim() + "\n";
}
