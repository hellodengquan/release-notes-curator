#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { getGitLog, fetchPRLabels, getRepoInfo, getTags } from "../src/git.js";
import { groupByLabel, mergeLabels } from "../src/group.js";
import {
  generateMarkdown,
  generatePlainText,
} from "../src/markdown.js";
import { DEFAULT_OUTPUT, LABEL_ORDER, LABEL_MAP } from "../src/config.js";
import { writeFileSync } from "node:fs";

const program = new Command();

program
  .name("rnc")
  .description("Release Notes Curator — 从 git commits 生成按标签分组的发版提案稿")
  .version("1.0.0");

program
  .command("generate")
  .description("生成发版提案稿并输出到终端")
  .option("-f, --from <tag>", "起始 tag 或 commit ref")
  .option("-t, --to <tag>", "结束 tag 或 commit ref（默认 HEAD）")
  .option("-r, --repo <path>", "Git 仓库路径（默认当前目录）")
  .option("-v, --version-label <version>", "版本号，如 v2.1.0")
  .option("--token <token>", "GitHub Personal Access Token，用于获取 PR 标签")
  .option("--plain", "使用纯文本输出（非 Markdown）")
  .action(async (opts) => {
    try {
      const commits = await processCommits(opts);
      if (commits.length === 0) {
        console.log(chalk.yellow("未找到任何 commit 记录。"));
        return;
      }

      const groups = groupByLabel(commits);
      const repoInfo = getRepoInfo(opts.repo);
      const repoUrl = repoInfo ? `https://github.com/${repoInfo.owner}/${repoInfo.repo}` : null;

      const options = {
        version: opts.versionLabel,
        repoUrl,
        date: new Date().toISOString().split("T")[0],
      };

      const output = opts.plain
        ? generatePlainText(groups, options)
        : generateMarkdown(groups, options);

      console.log(output);
    } catch (err) {
      console.error(chalk.red(`错误: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command("export")
  .description("导出 Markdown 格式的发版提案稿到文件")
  .option("-f, --from <tag>", "起始 tag 或 commit ref")
  .option("-t, --to <tag>", "结束 tag 或 commit ref（默认 HEAD）")
  .option("-r, --repo <path>", "Git 仓库路径（默认当前目录）")
  .option("-v, --version-label <version>", "版本号，如 v2.1.0")
  .option("-o, --output <file>", `输出文件路径（默认 ${DEFAULT_OUTPUT}）`, DEFAULT_OUTPUT)
  .option("--token <token>", "GitHub Personal Access Token，用于获取 PR 标签")
  .action(async (opts) => {
    try {
      const commits = await processCommits(opts);
      if (commits.length === 0) {
        console.log(chalk.yellow("未找到任何 commit 记录。"));
        return;
      }

      const groups = groupByLabel(commits);
      const repoInfo = getRepoInfo(opts.repo);
      const repoUrl = repoInfo ? `https://github.com/${repoInfo.owner}/${repoInfo.repo}` : null;

      const options = {
        version: opts.versionLabel,
        repoUrl,
        date: new Date().toISOString().split("T")[0],
      };

      const markdown = generateMarkdown(groups, options);
      writeFileSync(opts.output, markdown, "utf-8");

      console.log(
        chalk.green(`✓ 发版提案稿已导出到 ${chalk.bold(opts.output)}`)
      );
      console.log(
        chalk.gray(
          `  共 ${commits.length} 条 commit，${groups.size} 个分组`
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
  });

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

  const commits = getGitLog(opts.from, opts.to, opts.repo);

  if (opts.token && commits.length > 0) {
    const repoInfo = getRepoInfo(opts.repo);
    if (repoInfo) {
      console.log(
        chalk.gray(`正在从 GitHub 获取 PR 标签...`)
      );
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
