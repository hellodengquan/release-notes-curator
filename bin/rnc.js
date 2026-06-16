#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { getGitLog, fetchPRLabels, getRepoInfo, getTags, registerCustomPrefixes } from "../src/git.js";
import { groupByLabel, mergeLabels } from "../src/group.js";
import {
  render,
  generateMarkdown,
  generatePlainText,
} from "../src/markdown.js";
import { DEFAULT_OUTPUT, LABEL_ORDER, LABEL_MAP, TEMPLATES } from "../src/config.js";
import { writeFileSync } from "node:fs";

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
    .option("-p, --package <paths...>", "Monorepo 中过滤的 package 路径，如 packages/core packages/utils")
    .option("--template <type>", "输出模板: default | keepachangelog | release-notes-yaml", "default")
    .option("--prefix <pairs...>", "自定义 commit prefix 映射，格式: prefix=type，如 修改=feat");
};

sharedOptions(
  program
    .command("generate")
    .description("生成发版提案稿并输出到终端")
    .option("--dry-run", "仅分析不输出，显示统计信息")
    .option("--preview", "预览模式：输出摘要而非完整内容")
    .option("--plain", "使用纯文本输出（非 Markdown）")
).action(async (opts) => {
  try {
    if (opts.prefix) applyCustomPrefixes(opts.prefix);

    const commits = await processCommits(opts);
    if (commits.length === 0) {
      console.log(chalk.yellow("未找到任何 commit 记录。"));
      return;
    }

    const groups = groupByLabel(commits);

    if (opts.dryRun) {
      printDryRun(commits, groups);
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

    if (opts.plain) {
      console.log(generatePlainText(groups, options));
    } else {
      console.log(render(groups, options));
    }
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
    .option("--dry-run", "仅分析不输出，显示统计信息")
).action(async (opts) => {
  try {
    if (opts.prefix) applyCustomPrefixes(opts.prefix);

    const commits = await processCommits(opts);
    if (commits.length === 0) {
      console.log(chalk.yellow("未找到任何 commit 记录。"));
      return;
    }

    const groups = groupByLabel(commits);

    if (opts.dryRun) {
      printDryRun(commits, groups);
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

    const content = render(groups, options);
    writeFileSync(opts.output, content, "utf-8");

    console.log(
      chalk.green(`✓ 发版提案稿已导出到 ${chalk.bold(opts.output)}`)
    );
    console.log(
      chalk.gray(
        `  共 ${commits.length} 条 commit，${groups.size} 个分组，模板: ${opts.template}`
      )
    );
  } catch (err) {
    console.error(chalk.red(`错误: ${err.message}`));
    process.exit(1);
  }
});

program
  .command("tags")
  .description("列出仓库中可用的 git tags")
  .option("-r, --repo <path>", "Git 仓库路径（默认当前目录）")
  .action((opts) => {
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
  .action(() => {
    console.log(chalk.cyan("标签分类映射:"));
    for (const category of LABEL_ORDER) {
      const sources = Object.entries(LABEL_MAP)
        .filter(([, cat]) => cat === category)
        .map(([key]) => key);
      console.log(`  ${category}`);
      console.log(chalk.gray(`    ← ${sources.join(", ")}`));
    }

    console.log("");
    console.log(chalk.cyan("可用模板:"));
    for (const [key] of Object.entries(TEMPLATES)) {
      console.log(`  - ${key}`);
    }
  });

function applyCustomPrefixes(pairs) {
  const map = {};
  for (const pair of pairs) {
    const [prefix, type] = pair.split("=");
    if (prefix && type) {
      map[prefix.trim()] = type.trim();
    }
  }
  registerCustomPrefixes(map);
  console.log(chalk.gray(`已注册自定义 prefix: ${Object.entries(map).map(([k, v]) => `${k}→${v}`).join(", ")}`));
}

function printDryRun(commits, groups) {
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
  if (!opts.from && !opts.to) {
    const tags = getTags(opts.repo);
    if (tags.length >= 2) {
      opts.from = opts.from || tags[1];
      opts.to = opts.to || tags[0];
      console.log(
        chalk.gray(
          `自动检测版本范围: ${opts.from} ... ${opts.to}`
        )
      );
    } else if (tags.length === 1) {
      opts.from = opts.from || tags[0];
      console.log(chalk.gray(`自动检测起始 tag: ${opts.from}`));
    }
  }

  const packagePaths = opts.package || [];
  const commits = getGitLog(opts.from, opts.to, opts.repo, packagePaths);

  if (packagePaths.length > 0) {
    console.log(chalk.gray(`Monorepo 过滤路径: ${packagePaths.join(", ")}`));
  }

  if (opts.token && commits.length > 0) {
    const repoInfo = getRepoInfo(opts.repo);
    if (repoInfo) {
      console.log(chalk.gray(`正在从 GitHub 获取 PR 标签...`));
      for (const commit of commits) {
        if (commit.prNumber) {
          const prLabels = await fetchPRLabels(
            commit.prNumber,
            repoInfo,
            opts.token
          );
          commit.labels = mergeLabels(commit.labels, prLabels);
        }
      }
    } else {
      console.log(
        chalk.yellow("无法解析仓库信息，跳过 GitHub PR 标签获取。")
      );
    }
  }

  return commits;
}

program.parse();
