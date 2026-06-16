import { execSync } from "node:child_process";

const MERGE_PR_RE = /Merge pull request #(\d+)/i;
const PR_REF_RE = /\(#(\d+)\)/;
const CONVENTIONAL_RE = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)/;
const BREAKING_FOOTER_RE = /^BREAKING[ -]CHANGE:\s*(.+)/im;

const CHINESE_PREFIX_MAP = {
  "新增": "feat",
  "新功能": "feat",
  "功能": "feat",
  "修复": "fix",
  "缺陷": "fix",
  "补丁": "fix",
  "文档": "docs",
  "重构": "refactor",
  "优化": "perf",
  "性能": "perf",
  "测试": "test",
  "样式": "style",
  "格式": "style",
  "构建": "build",
  "发布": "build",
  "部署": "build",
  "杂项": "chore",
  "维护": "chore",
  "持续集成": "ci",
};

const CHINESE_PREFIX_RE = /^([\u4e00-\u9fff]+)(?:\(([^)]+)\))?(!)?:\s*(.+)/;

const DEFAULT_SEPARATOR = "---COMMIT_SEP---";
const DEFAULT_FIELD_SEP = "---FIELD_SEP---";

let customPrefixes = {};

export function registerCustomPrefixes(prefixes) {
  customPrefixes = { ...customPrefixes, ...prefixes };
}

export function getGitLog(from, to, repoPath, packagePaths) {
  const format = `%s${DEFAULT_FIELD_SEP}%H${DEFAULT_FIELD_SEP}%an${DEFAULT_FIELD_SEP}%ai${DEFAULT_FIELD_SEP}%b${DEFAULT_SEPARATOR}`;
  const range = from && to ? `${from}...${to}` : from ? `${from}..HEAD` : to ? `${to}` : "";

  let cmd = `git log`;
  if (range) cmd += ` ${range}`;
  cmd += ` --pretty=format:"${format}"`;

  if (packagePaths && packagePaths.length > 0) {
    cmd += " --";
    for (const p of packagePaths) {
      cmd += ` ${p}`;
    }
  }

  try {
    const raw = execSync(cmd, {
      cwd: repoPath || process.cwd(),
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
    }).trim();

    if (!raw) return [];
    return raw.split(DEFAULT_SEPARATOR).map((r) => parseCommit(r, packagePaths)).filter(Boolean);
  } catch (err) {
    throw new Error(`Failed to read git log: ${err.message}`);
  }
}

function parseCommit(raw, packagePaths) {
  const parts = raw.split(DEFAULT_FIELD_SEP).map((s) => s.trim());
  if (parts.length < 4) return null;

  const [subject, hash, author, date, body] = parts;

  const result = {
    hash,
    author,
    date: date ? date.split(" ")[0] : "",
    subject: subject.replace(/^"|"$/g, ""),
    body: body ? body.replace(/^"|"$/g, "") : "",
    prNumber: null,
    labels: [],
    description: "",
    scope: "",
    breakingChange: false,
    breakingChangeDescription: "",
    affectedPackages: [],
  };

  if (packagePaths && packagePaths.length > 0) {
    result.affectedPackages = detectAffectedPackages(result.subject, body, packagePaths);
  }

  const breakingFromBody = extractBreakingFromBody(body || "");
  if (breakingFromBody) {
    result.breakingChange = true;
    result.breakingChangeDescription = breakingFromBody;
  }

  const mergeMatch = subject.match(MERGE_PR_RE);
  if (mergeMatch) {
    result.prNumber = parseInt(mergeMatch[1], 10);
    const afterMerge = subject.replace(MERGE_PR_RE, "").trim();
    result.description = afterMerge || subject;

    const convMatch = afterMerge.match(CONVENTIONAL_RE);
    if (convMatch) {
      result.labels.push(convMatch[1].toLowerCase());
      result.scope = convMatch[2] || "";
      result.description = convMatch[4] || afterMerge;
      if (convMatch[3] === "!") {
        result.breakingChange = true;
      }
    } else {
      const cnMatch = afterMerge.match(CHINESE_PREFIX_RE);
      if (cnMatch) {
        const mapped = CHINESE_PREFIX_MAP[cnMatch[1]] || customPrefixes[cnMatch[1]] || null;
        if (mapped) result.labels.push(mapped);
        result.scope = cnMatch[2] || "";
        result.description = cnMatch[4] || afterMerge;
        if (cnMatch[3] === "!") {
          result.breakingChange = true;
        }
      }
    }

    return result;
  }

  const prRefMatch = subject.match(PR_REF_RE);
  if (prRefMatch) {
    result.prNumber = parseInt(prRefMatch[1], 10);
    result.description = subject.replace(PR_REF_RE, "").trim();
  } else {
    result.description = subject;
  }

  const convMatch = subject.match(CONVENTIONAL_RE);
  if (convMatch) {
    result.labels.push(convMatch[1].toLowerCase());
    result.scope = convMatch[2] || "";
    result.description = convMatch[4] || result.description;
    if (convMatch[3] === "!") {
      result.breakingChange = true;
    }
  } else {
    const cnMatch = subject.match(CHINESE_PREFIX_RE);
    if (cnMatch) {
      const mapped = CHINESE_PREFIX_MAP[cnMatch[1]] || customPrefixes[cnMatch[1]] || null;
      if (mapped) result.labels.push(mapped);
      else result.labels.push(cnMatch[1]);
      result.scope = cnMatch[2] || "";
      result.description = cnMatch[4] || result.description;
      if (cnMatch[3] === "!") {
        result.breakingChange = true;
      }
    } else {
      const customMatch = tryCustomPrefix(subject);
      if (customMatch) {
        result.labels.push(customMatch.type);
        result.scope = customMatch.scope || "";
        result.description = customMatch.description;
        if (customMatch.breaking) {
          result.breakingChange = true;
        }
      }
    }
  }

  return result;
}

function extractBreakingFromBody(body) {
  const match = body.match(BREAKING_FOOTER_RE);
  return match ? match[1].trim() : "";
}

function tryCustomPrefix(subject) {
  for (const [prefix, mappedType] of Object.entries(customPrefixes)) {
    const re = new RegExp(`^${escapeRegex(prefix)}(?:\\(([^)]+)\\))?(!)?:\\s*(.+)`);
    const match = subject.match(re);
    if (match) {
      return {
        type: mappedType,
        scope: match[1] || "",
        breaking: match[2] === "!",
        description: match[3],
      };
    }
  }
  return null;
}

function detectAffectedPackages(subject, body, packagePaths) {
  const fullText = `${subject} ${body}`;
  const affected = [];
  for (const pkgPath of packagePaths) {
    const pkgName = pkgPath.split("/").pop();
    if (fullText.includes(pkgName) || fullText.includes(pkgPath)) {
      affected.push(pkgName);
    }
  }
  return affected;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function fetchPRLabels(prNumber, repoInfo, token) {
  if (!token || !repoInfo || !prNumber) return [];

  const { owner, repo } = repoInfo;
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "release-notes-curator",
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.labels || []).map((l) =>
      typeof l === "string" ? l : l.name
    );
  } catch {
    return [];
  }
}

export function getRepoInfo(repoPath) {
  try {
    const remoteUrl = execSync("git remote get-url origin", {
      cwd: repoPath || process.cwd(),
      encoding: "utf-8",
    }).trim();

    const sshMatch = remoteUrl.match(/git@[^:]+:([^/]+)\/([^/.]+)/);
    if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

    const httpsMatch = remoteUrl.match(/https?:\/\/[^/]+\/([^/]+)\/([^/.]+)/);
    if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };

    return null;
  } catch {
    return null;
  }
}

export function getTags(repoPath) {
  try {
    const raw = execSync("git tag --sort=-v:refname", {
      cwd: repoPath || process.cwd(),
      encoding: "utf-8",
    }).trim();
    return raw ? raw.split("\n") : [];
  } catch {
    return [];
  }
}

export { CHINESE_PREFIX_MAP };
