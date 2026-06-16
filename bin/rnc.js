#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { join } from "node:path";
import {
  getGitLog,
  fetchPRLabels,
  getRepoInfo,
  getTags,
  registerCustomPrefixes,
  detectWorkspaces,
  isGitRepo,
  MERGE_PR_RE,
} from "../src/git.js";
import { groupByLabel, mergeLabels } from "../src/group.js";
import { render, generateMarkdown, generatePlainText, backfillKeepAChangelog } from "../src/markdown.js";
import {
  DEFAULT_OUTPUT,
  LABEL_ORDER,
  LABEL_MAP,
  TEMPLATES,
  registerTeamAliases,
  loadTeamConfig,
  getAllAliases,
  loadTeamConfigFromApi,
  setApiRetryConfig,
} from "../src/config.js";
import { writeFileSync, existsSync } from "node:fs";

const program = new Command();

program
  .name("rnc")
  .description("Release Notes Curator — 从 git commits 生成按标签分组的发版提案稿")
  .version("1.0.0");

const sharedOptions = (cmd) => {
  return cmd
    .option("-f, --from <tag>", "起始 tag 或 commit ref")
    .option("-t, --to <tag>", "结束 tag 或 commit ref（默认 HEAD）")
    .option("-r, --repo <path>", "Git 仓库路径（默认当前目录）")
    .option("-v, --version-label <version>", "版本号，如 v2.1.0")
    .option("--token <token>", "GitHub Personal Access Token，用于获取 PR 标签")
    .option(
      "-p, --package <paths...>",
      "Monorepo 中过滤的 package 路径，支持 glob，如 packages/* packages/core",
    )
    .option(
      "--template <type>",
      "输出模板: default | keepachangelog | release-notes-yaml",
      "default",
    )
    .option("--prefix <pairs...>", "自定义 commit prefix 映射，格式: prefix=type，如 修改=feat")
    .option("--team-config <path>", "团队标签别名配置 JSON 文件路径")
    .option("--team-api <url>", "从 API 加载团队标签别名配置，支持限流重试与降级")
    .option("--team-api-token <token>", "团队 API 的 Bearer token")
    .option("--team-alias <pairs...>", "团队标签别名，格式: label=type，如 team-alpha-feat=feat")
    .option("--merges-only", "仅包含 merge commit（适用于 squash-merge 工作流）")
    .option(
      "--backfill <file>",
      "Keep a Changelog 历史回填：从现有 CHANGELOG.md 读取历史并重组，将新内容插入正确位置",
    )
    .option("--format <format>", "dry-run 输出格式: human | json", "human");
};

sharedOptions(
  program
    .command("generate")
    .description("生成发版提案稿并输出到终端")
    .option("--dry-run", "仅分析不输出，显示统计信息与分类决策依据")
    .option("--preview", "预览模式：输出摘要而非完整内容")
    .option("--plain", "使用纯文本输出（非 Markdown）"),
).action(async (opts) => {
  try {
    if (opts.teamConfig) {
      const cfgPath = opts.repo ? join(opts.repo, opts.teamConfig) : opts.teamConfig;
      loadTeamConfig(cfgPath);
    }
    if (opts.teamApi) {
      const result = await loadTeamConfigFromApi(opts.teamApi, { token: opts.teamApiToken });
      if (result.success) {
        console.log(chalk.gray(`团队别名加载完成 (来源: ${result.source})`));
        if (result.warning) console.log(chalk.yellow(`⚠️  ${result.warning}`));
      } else {
        console.log(chalk.yellow(`⚠️  团队 API 加载失败: ${result.error}`));
      }
    }
    if (opts.teamAlias) applyTeamAliases(opts.teamAlias);
    if (opts.prefix) applyCustomPrefixes(opts.prefix);

    const commits = await processCommits(opts);
    if (commits.length === 0) {
      console.log(chalk.yellow("未找到任何 commit 记录。"));
      return;
    }

    const groups = groupByLabel(commits);

    if (opts.dryRun) {
      printDryRun(commits, groups, opts);
      return;
    }

    if (opts.preview) {
      printPreview(commits, groups);
      return;
    }

    const repoInfo = getRepoInfo(opts.repo);
    const repoUrl = repoInfo ? `https://github.com/${repoInfo.owner}/${repoInfo.repo}` : null;

    const options = {
      version: opts.versionLabel,
      repoUrl,
      date: new Date().toISOString().split("T")[0],
      template: opts.template,
    };

    let content;
    if (opts.backfill) {
      const existingContent = existsSync(opts.backfill)
        ? readFileSync(opts.backfill, "utf-8")
        : "";
      content = backfillKeepAChangelog(existingContent, groups, options);
    } else if (opts.plain) {
      content = generatePlainText(groups, options);
    } else {
      content = render(groups, options);
    }

    console.log(content);
  } catch (err) {
    console.error(chalk.red(`错误: ${err.message}`));
    process.exit(1);
  }
});

sharedOptions(
  program
    .command("export")
    .description("导出 Markdown 格式的发版提案稿到文件")
    .option("-o, --output <file>", `输出文件路径（默认 ${DEFAULT_OUTPUT}）`, DEFAULT_OUTPUT)
    .option("--dry-run", "仅分析不输出，显示统计信息与分类决策依据"),
).action(async (opts) => {
  try {
    if (opts.teamConfig) {
      const cfgPath = opts.repo ? join(opts.repo, opts.teamConfig) : opts.teamConfig;
      loadTeamConfig(cfgPath);
    }
    if (opts.teamApi) {
      const result = await loadTeamConfigFromApi(opts.teamApi, { token: opts.teamApiToken });
      if (result.success) {
        console.log(chalk.gray(`团队别名加载完成 (来源: ${result.source})`));
        if (result.warning) console.log(chalk.yellow(`⚠️  ${result.warning}`));
      } else {
        console.log(chalk.yellow(`⚠️  团队 API 加载失败: ${result.error}`));
      }
    }
    if (opts.teamAlias) applyTeamAliases(opts.teamAlias);
    if (opts.prefix) applyCustomPrefixes(opts.prefix);

    const commits = await processCommits(opts);
    if (commits.length === 0) {
      console.log(chalk.yellow("未找到任何 commit 记录。"));
      return;
    }

    const groups = groupByLabel(commits);

    if (opts.dryRun) {
      printDryRun(commits, groups, opts);
      return;
    }

    const repoInfo = getRepoInfo(opts.repo);
    const repoUrl = repoInfo ? `https://github.com/${repoInfo.owner}/${repoInfo.repo}` : null;

    const options = {
      version: opts.versionLabel,
      repoUrl,
      date: new Date().toISOString().split("T")[0],
      template: opts.template,
    };

    let content;
    if (opts.backfill) {
      const existingContent = existsSync(opts.backfill)
        ? readFileSync(opts.backfill, "utf-8")
        : "";
      content = backfillKeepAChangelog(existingContent, groups, options);
    } else {
      content = render(groups, options);
    }
    writeFileSync(opts.output, content, "utf-8");

    console.log(chalk.green(`✓ 发版提案稿已导出到 ${chalk.bold(opts.output)}`));
    console.log(
      chalk.gray(`  共 ${commits.length} 条 commit，${groups.size} 个分组，模板: ${opts.template}`),
    );
  } catch (err) {
    console.error(chalk.red(`错误: ${err.message}`));
    process.exit(1);
  }
});

program
  .command("workspaces")
  .description("检测并列出 monorepo 中的 workspace 路径")
  .option("-r, --repo <path>", "Git 仓库路径（默认当前目录）")
  .action((opts) => {
    if (!isGitRepo(opts.repo)) {
      console.log(chalk.yellow("当前路径不是 git 仓库。"));
      return;
    }
    const paths = detectWorkspaces(opts.repo);
    if (paths.length === 0) {
      console.log(
        chalk.yellow(
          "未检测到 monorepo workspace（未找到 package.json workspaces、turbo.json、pnpm-workspace.yaml 或 lerna.json）。",
        ),
      );
      return;
    }
    console.log(chalk.cyan(`检测到 ${paths.length} 个 workspace:`));
    paths.forEach((p, i) => {
      console.log(`  ${chalk.gray(String(i + 1).padStart(2))}. ${p}`);
    });
  });

program
  .command("tags")
  .description("列出仓库中可用的 git tags")
  .option("-r, --repo <path>", "Git 仓库路径（默认当前目录）")
  .action((opts) => {
    if (!isGitRepo(opts.repo)) {
      console.log(chalk.yellow("当前路径不是 git 仓库。"));
      return;
    }
    const tags = getTags(opts.repo);
    if (tags.length === 0) {
      console.log(chalk.yellow("未找到任何 git tag。"));
      return;
    }
    console.log(chalk.cyan("可用的 git tags:"));
    tags.slice(0, 30).forEach((tag, i) => {
      console.log(`  ${chalk.gray(String(i + 1).padStart(2))}. ${tag}`);
    });
    if (tags.length > 30) {
      console.log(chalk.gray(`  ... 共 ${tags.length} 个 tag`));
    }
  });

program
  .command("labels")
  .description("显示支持的标签分类映射")
  .option("--team-config <path>", "团队标签别名配置 JSON 文件路径")
  .action((opts) => {
    if (opts.teamConfig) {
      loadTeamConfig(opts.teamConfig);
    }
    console.log(chalk.cyan("标签分类映射:"));
    for (const category of LABEL_ORDER) {
      const sources = Object.entries(LABEL_MAP)
        .filter(([, cat]) => cat === category)
        .map(([key]) => key);
      console.log(`  ${category}`);
      console.log(chalk.gray(`    ← ${sources.join(", ")}`));
    }

    console.log("");
    console.log(chalk.cyan("标签别名:"));
    const allAliases = getAllAliases();
    const aliasEntries = Object.entries(allAliases);
    aliasEntries.slice(0, 20).forEach(([alias, target]) => {
      console.log(chalk.gray(`  ${alias} → ${target}`));
    });
    if (aliasEntries.length > 20) {
      console.log(chalk.gray(`  ... 共 ${aliasEntries.length} 个别名`));
    }

    console.log("");
    console.log(chalk.cyan("可用模板:"));
    for (const [key] of Object.entries(TEMPLATES)) {
      console.log(`  - ${key}`);
    }
  });

function applyTeamAliases(pairs) {
  const map = {};
  for (const pair of pairs) {
    const [label, type] = pair.split("=");
    if (label && type) {
      map[label.trim()] = type.trim();
    }
  }
  registerTeamAliases(map);
  console.log(
    chalk.gray(
      `已注册团队别名: ${Object.entries(map)
        .map(([k, v]) => `${k}→${v}`)
        .join(", ")}`,
    ),
  );
}

function applyCustomPrefixes(pairs) {
  const map = {};
  for (const pair of pairs) {
    const [prefix, type] = pair.split("=");
    if (prefix && type) {
      map[prefix.trim()] = type.trim();
    }
  }
  registerCustomPrefixes(map);
  console.log(
    chalk.gray(
      `已注册自定义 prefix: ${Object.entries(map)
        .map(([k, v]) => `${k}→${v}`)
        .join(", ")}`,
    ),
  );
}

function printDryRun(commits, groups, opts) {
  const format = (opts && opts.format) || "human";

  if (format === "json") {
    const result = {
      schemaVersion: "1.0",
      generatedAt: new Date().toISOString(),
      stats: {
        totalCommits: commits.length,
        totalGroups: groups.size,
        breakingChanges: commits.filter((c) => c.breakingChange).length,
      },
      groups: {},
      commits: [],
    };

    for (const [category, items] of groups) {
      result.groups[category] = {
        count: items.length,
        commits: items.map((c) => c.hash),
      };
    }

    for (const c of commits) {
      result.commits.push({
        hash: c.hash,
        shortHash: c.hash.slice(0, 7),
        description: c.description,
        author: c.author,
        email: c.email,
        date: c.date,
        scope: c.scope,
        breakingChange: c.breakingChange,
        breakingChangeDescription: c.breakingChangeDescription,
        labels: c.labels,
        prNumber: c.prNumber,
        categoryRationale: c.categoryRationale,
        affectedPackages: c.affectedPackages,
      });
    }

    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (format === "jsonl") {
    const generatedAt = new Date().toISOString();
    const stream = process.stdout;

    stream.write(JSON.stringify({
      type: "header",
      schemaVersion: "1.0",
      generatedAt,
      stats: {
        totalCommits: commits.length,
        totalGroups: groups.size,
        breakingChanges: commits.filter((c) => c.breakingChange).length,
      },
    }) + "\n");

    for (const [category, items] of groups) {
      stream.write(JSON.stringify({
        type: "group",
        category,
        count: items.length,
        commitHashes: items.map((c) => c.hash),
        generatedAt,
      }) + "\n");
    }

    for (const c of commits) {
      stream.write(JSON.stringify({
        type: "commit",
        hash: c.hash,
        shortHash: c.hash.slice(0, 7),
        description: c.description,
        author: c.author,
        email: c.email,
        date: c.date,
        scope: c.scope,
        breakingChange: c.breakingChange,
        breakingChangeDescription: c.breakingChangeDescription,
        labels: c.labels,
        prNumber: c.prNumber,
        categoryRationale: c.categoryRationale,
        affectedPackages: c.affectedPackages,
        generatedAt,
      }) + "\n");
    }

    stream.write(JSON.stringify({
      type: "footer",
      generatedAt,
      processed: commits.length,
    }) + "\n");

    return;
  }

  console.log(chalk.cyan.bold("🔍 Dry Run — 分析结果"));
  console.log("");
  console.log(`  总 commit 数: ${chalk.bold(commits.length)}`);
  console.log(`  分组数: ${chalk.bold(groups.size)}`);

  const breakingCount = commits.filter((c) => c.breakingChange).length;
  if (breakingCount > 0) {
    console.log(`  ${chalk.red.bold(`⚠️ Breaking Changes: ${breakingCount}`)}`);
  }

  console.log("");
  console.log(chalk.cyan("分组统计:"));
  for (const [category, items] of groups) {
    const count = items.length;
    const bar = "█".repeat(Math.min(count, 20));
    console.log(`  ${category} ${chalk.gray(bar)} ${count}`);
  }

  console.log("");
  console.log(chalk.cyan("分类决策依据（前 10 条）:"));
  commits.slice(0, 10).forEach((c) => {
    const shortDesc = c.description.slice(0, 40);
    console.log(
      chalk.gray(`  · ${c.hash.slice(0, 7)} "${shortDesc}" → ${c.categoryRationale || "N/A"}`),
    );
  });
  if (commits.length > 10) {
    console.log(chalk.gray(`  ... 还有 ${commits.length - 10} 条`));
  }

  console.log("");
  console.log(chalk.gray("（使用不带 --dry-run 的命令生成完整输出）"));
}

function printPreview(commits, groups) {
  console.log(chalk.cyan.bold("📋 Preview — 发版提案稿摘要"));
  console.log("");

  for (const [category, items] of groups) {
    console.log(`${category} (${items.length})`);
    const preview = items.slice(0, 3);
    for (const commit of preview) {
      let line = `  - ${commit.description}`;
      if (commit.breakingChange) line = `  - ⚠️ BREAKING: ${commit.description}`;
      if (commit.prNumber) line += ` (#${commit.prNumber})`;
      console.log(chalk.gray(line));
    }
    if (items.length > 3) {
      console.log(chalk.gray(`  ... 及其他 ${items.length - 3} 条`));
    }
    console.log("");
  }

  console.log(chalk.gray("（使用不带 --preview 的命令查看完整内容）"));
}

async function processCommits(opts) {
  if (!isGitRepo(opts.repo)) {
    throw new Error(
      opts.repo
        ? `指定路径 ${opts.repo} 不是 git 仓库`
        : "当前目录不是 git 仓库，请使用 --repo 指定正确路径或先执行 git init",
    );
  }

  if (!opts.from && !opts.to) {
    const tags = getTags(opts.repo);
    if (tags.length >= 2) {
      opts.from = opts.from || tags[1];
      opts.to = opts.to || tags[0];
      console.log(chalk.gray(`自动检测版本范围: ${opts.from} ... ${opts.to}`));
    } else if (tags.length === 1) {
      opts.from = opts.from || tags[0];
      console.log(chalk.gray(`自动检测起始 tag: ${opts.from}`));
    } else {
      console.log(chalk.gray("未检测到 tag，将使用全部历史记录"));
    }
  }

  const packagePaths = opts.package || [];
  if (packagePaths.length === 0) {
    const autoDetected = detectWorkspaces(opts.repo);
    if (autoDetected.length > 0) {
      console.log(chalk.gray(`自动检测到 ${autoDetected.length} 个 monorepo workspace`));
    }
  }

  let commits = getGitLog(opts.from, opts.to, opts.repo, packagePaths);

  if (opts.mergesOnly) {
    commits = commits.filter((c) => {
      const subject = c.subject || c.description || "";
      return MERGE_PR_RE.test(subject);
    });
    console.log(chalk.gray(`仅 merge commit 模式，过滤后 ${commits.length} 条`));
  }

  if (packagePaths.length > 0) {
    console.log(chalk.gray(`Monorepo 过滤路径: ${packagePaths.join(", ")}`));
  }

  if (opts.token && commits.length > 0) {
    const repoInfo = getRepoInfo(opts.repo);
    if (repoInfo) {
      console.log(chalk.gray(`正在从 GitHub 获取 PR 标签...`));
      for (const commit of commits) {
        if (commit.prNumber) {
          const prLabels = await fetchPRLabels(commit.prNumber, repoInfo, opts.token);
          commit.labels = mergeLabels(commit.labels, prLabels);
        }
      }
    } else {
      console.log(chalk.yellow("无法解析仓库信息，跳过 GitHub PR 标签获取。"));
    }
  }

  return commits;
}

program.parse();
