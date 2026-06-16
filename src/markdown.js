import { CATEGORY_DESCRIPTIONS } from "./config.js";

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

  const totalCommits = [...groups.values()].reduce(
    (sum, items) => sum + items.length,
    0
  );
  lines.push(
    `**Total Changes**: ${totalCommits} commit${totalCommits !== 1 ? "s" : ""} across ${groups.size} categor${groups.size !== 1 ? "ies" : "y"}`
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
      const bullet = formatCommit(commit, repoUrl);
      lines.push(`- ${bullet}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

function formatCommit(commit, repoUrl) {
  let line = commit.description;

  if (commit.scope) {
    line = `**${commit.scope}**: ${line}`;
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
      line += ` - ${commit.author}`;
      lines.push(line);
    }

    lines.push("");
  }

  return lines.join("\n");
}
