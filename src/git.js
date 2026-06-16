import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";

const MERGE_PR_RE = /Merge pull request #(\d+)/i;
const PR_REF_RE = /\(#(\d+)\)/;
const CONVENTIONAL_RE = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)/;
const BREAKING_FOOTER_RE = /^BREAKING[ -]CHANGE:\s*(.+)/im;
const NESTED_PAREN_RE = /^(\w+)(?:\(([^(]+(?:\([^)]+\)[^)]*)*)\))?(!)?:\s*(.+)/;

const CHINESE_PREFIX_MAP = {
  新增: "feat",
  新功能: "feat",
  功能: "feat",
  修复: "fix",
  缺陷: "fix",
  补丁: "fix",
  文档: "docs",
  重构: "refactor",
  优化: "perf",
  性能: "perf",
  测试: "test",
  样式: "style",
  格式: "style",
  构建: "build",
  发布: "build",
  部署: "build",
  杂项: "chore",
  维护: "chore",
  持续集成: "ci",
  安全: "security",
  撤回: "yanked",
};

const CHINESE_PREFIX_RE = /^([\u4e00-\u9fff]+)(?:\(([^(]+(?:\([^)]+\)[^)]*)*)\))?(!)?:\s*(.+)/;
const COMBINED_PREFIX_RE = /^([\w\u4e00-\u9fff+&/\-\s]+)(?:\(([^(]+(?:\([^)]+\)[^)]*)*)\))?(!)?:\s*(.+)/;

const DEFAULT_SEPARATOR = "---COMMIT_SEP---";
const DEFAULT_FIELD_SEP = "---FIELD_SEP---";

const PROTOCOL_BREAKING_PATTERNS = [
  /v\d+\s*->\s*v[2-9]/,
  /api\s+(?:version|ver)\s+\d+\s*(?:->|to)\s*[2-9]/i,
  /remove[d]?\s+(?:public|private|api|endpoint|interface)/i,
  /deprecat[e|ed]\s+(?:api|endpoint|method|function|interface)/i,
  /breaking\s+change/i,
  /incompatible/i,
  /major\s+(?:version|release|bump)/i,
  /semver\s*:\s*major/i,
  /protocol\s+(?:change|upgrade|break)/i,
  /graphql\s+schema\s+(?:breaking|change)/i,
  /rest\s+api\s+(?:breaking|change)/i,
  /rename\s+(?:endpoint|method|field|param)/i,
  /type\s+(\w+)\s*\{[\s\S]*?(?:remove|delete)[\s\S]*?\}/i,
  /(?:remove|delete|drop)\s+(?:type|interface|enum|union|field|argument|input)/i,
  /@deprecated\s+.*?(?:remove|delete)/i,
  /change\s+(?:type|field|argument|input)\s+.*?required/i,
  /graphql\s+(?:breaking|schema\s+change|type\s+removal)/i,
  /schema.*?(?:non-null|nonnull|!.*?->|required\s+field)/i,
  /federation.*?(?:breaking|incompatible|change)/i,
  /subgraph.*?(?:breaking|incompatible|change)/i,
  /@key.*?(?:remove|delete|change|modify)/i,
  /(?:remove|delete|drop)\s+@key/i,
  /(?:remove|delete|drop)\s+@external/i,
  /(?:remove|delete|drop)\s+@requires/i,
  /(?:remove|delete|drop)\s+@provides/i,
  /change\s+@key\s+fields/i,
  /entity.*?(?:remove|delete|change|break)/i,
  /(?:remove|delete)\s+entity\s+type/i,
  /extends\s+type.*?(?:remove|delete)/i,
  /(?:remove|delete)\s+@extends/i,
  /shared\s+type.*?(?:incompatible|breaking)/i,
  /(?:remove|delete).*?from\s+subgraph/i,
  /composition.*?(?:error|fail|break)/i,
  /schema\s+composition.*?breaking/i,
];

let customPrefixes = {};

export function registerCustomPrefixes(prefixes) {
  customPrefixes = { ...customPrefixes, ...prefixes };
}

export function getGitLog(from, to, repoPath, packagePaths) {
  const format = `%s${DEFAULT_FIELD_SEP}%H${DEFAULT_FIELD_SEP}%an${DEFAULT_FIELD_SEP}%ai${DEFAULT_FIELD_SEP}%b${DEFAULT_FIELD_SEP}%ae${DEFAULT_SEPARATOR}`;
  const range = from && to ? `${from}...${to}` : from ? `${from}..HEAD` : to ? `${to}` : "";

  const resolvedPaths = resolvePackagePaths(packagePaths, repoPath);

  let cmd = `git log`;
  if (range) cmd += ` ${range}`;
  cmd += ` --pretty=format:"${format}"`;

  if (resolvedPaths && resolvedPaths.length > 0) {
    cmd += " --";
    for (const p of resolvedPaths) {
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
    return raw
      .split(DEFAULT_SEPARATOR)
      .map((r) => parseCommit(r, resolvedPaths, from, to, repoPath))
      .filter(Boolean);
  } catch (err) {
    throw new Error(`Failed to read git log: ${err.message}`);
  }
}

export function detectWorkspaces(repoPath) {
  const root = repoPath || process.cwd();
  const paths = [];

  try {
    const pkgPath = join(root, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (pkg.workspaces) {
        const globs = Array.isArray(pkg.workspaces)
          ? pkg.workspaces
          : pkg.workspaces.packages || [];
        paths.push(...expandWorkspaceGlobs(globs, root));
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const turboPath = join(root, "turbo.json");
    if (existsSync(turboPath)) {
      const turbo = JSON.parse(readFileSync(turboPath, "utf-8"));
      if (turbo.pipeline) {
        try {
          const pkgJson = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
          if (pkgJson.workspaces) {
            const globs = Array.isArray(pkgJson.workspaces)
              ? pkgJson.workspaces
              : pkgJson.workspaces.packages || [];
            if (paths.length === 0) {
              paths.push(...expandWorkspaceGlobs(globs, root));
            }
          }
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const pnpmPath = join(root, "pnpm-workspace.yaml");
    if (existsSync(pnpmPath)) {
      const content = readFileSync(pnpmPath, "utf-8");
      const packagesMatch = content.match(/packages:\s*([\s\S]*?)(?:^[a-z]|$)/im);
      if (packagesMatch) {
        const globs = packagesMatch[1]
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.startsWith("-"))
          .map((l) => l.replace(/^-\s*['"]?/, "").replace(/['"]?\s*$/, ""));
        paths.push(...expandWorkspaceGlobs(globs, root));
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const pnpmLockPath = join(root, "pnpm-lock.yaml");
    if (existsSync(pnpmLockPath) && paths.length === 0) {
      const content = readFileSync(pnpmLockPath, "utf-8");
      const importerMatch = content.match(/importers:\s*([\s\S]*?)(?:^[a-z]|$)/im);
      if (importerMatch) {
        const workspacePaths = importerMatch[1]
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.startsWith("'") || l.startsWith('"') || /^[\w@]/.test(l))
          .map((l) => l.replace(/^['"]/, "").replace(/['"]?:\s*$/, "").trim())
          .filter((l) => l && l !== ".")
          .filter((l) => !l.startsWith("{"));
        if (workspacePaths.length > 0) {
          paths.push(...expandWorkspaceGlobs(workspacePaths, root));
        }
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const lernaPath = join(root, "lerna.json");
    if (existsSync(lernaPath)) {
      const lerna = JSON.parse(readFileSync(lernaPath, "utf-8"));
      if (lerna.packages && Array.isArray(lerna.packages)) {
        const globs = lerna.packages;
        if (globs.length > 0 && paths.length === 0) {
          paths.push(...expandWorkspaceGlobs(globs, root));
        }
      } else if (lerna.npmClient || lerna.useWorkspaces !== false) {
        try {
          const pkgJson = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
          if (pkgJson.workspaces) {
            const globs = Array.isArray(pkgJson.workspaces)
              ? pkgJson.workspaces
              : pkgJson.workspaces.packages || [];
            if (globs.length > 0 && paths.length === 0) {
              paths.push(...expandWorkspaceGlobs(globs, root));
            }
          }
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const nxPath = join(root, "nx.json");
    if (existsSync(nxPath)) {
      try {
        const pkgJson = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
        if (pkgJson.workspaces) {
          const globs = Array.isArray(pkgJson.workspaces)
            ? pkgJson.workspaces
            : pkgJson.workspaces.packages || [];
          if (globs.length > 0 && paths.length === 0) {
            paths.push(...expandWorkspaceGlobs(globs, root));
          }
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }

  return [...new Set(paths)];
}

function expandWorkspaceGlobs(globs, root) {
  const results = [];
  for (const pattern of globs) {
    if (pattern.includes("*")) {
      const simplified = pattern.replace(/\/\*+$/, "");
      try {
        const out = execSync(`find ${simplified} -maxdepth 1 -type d 2>/dev/null || true`, {
          cwd: root,
          encoding: "utf-8",
        }).trim();
        if (out) {
          results.push(...out.split("\n").filter(Boolean));
        } else {
          results.push(simplified);
        }
      } catch {
        results.push(simplified);
      }
    } else {
      results.push(pattern);
    }
  }
  return results;
}

function resolvePackagePaths(packagePaths, repoPath) {
  if (!packagePaths || packagePaths.length === 0) return [];
  const root = repoPath || process.cwd();
  const detected = detectWorkspaces(root);

  const resolved = [];
  for (const input of packagePaths) {
    if (input.includes("*")) {
      const matched = matchGlobAgainstWorkspaces(input, detected);
      if (matched.length > 0) {
        resolved.push(...matched);
      } else {
        resolved.push(input);
      }
    } else if (detected.some((d) => d.endsWith(input) || d === input || d.includes(`/${input}/`))) {
      const matched = detected.filter((d) => d.endsWith(input) || d === input);
      resolved.push(...(matched.length > 0 ? matched : [input]));
    } else {
      resolved.push(input);
    }
  }

  return [...new Set(resolved)];
}

function matchGlobAgainstWorkspaces(pattern, workspaces) {
  const regex = globToRegex(pattern);
  return workspaces.filter((w) => regex.test(w));
}

function globToRegex(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(escaped);
}

function parseCommit(raw, packagePaths, from, to, repoPath) {
  const parts = raw.split(DEFAULT_FIELD_SEP).map((s) => s.trim());
  if (parts.length < 4) return null;

  const [subject, hash, author, date, body, email] = parts;

  const result = {
    hash,
    author,
    email: email || "",
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
    categoryRationale: "",
  };

  if (packagePaths && packagePaths.length > 0) {
    result.affectedPackages = detectAffectedPackages(result.subject, body, packagePaths);
  }

  const breakingFromBody = extractBreakingFromBody(body || "");
  if (breakingFromBody) {
    result.breakingChange = true;
    result.breakingChangeDescription = breakingFromBody;
    result.categoryRationale = `body contains "BREAKING CHANGE" footer`;
  }

  if (from && to && !result.breakingChange) {
    const protocolBreaking = scanForProtocolBreaking(
      hash,
      from,
      to,
      repoPath,
      result.subject,
      body || "",
    );
    if (protocolBreaking) {
      result.breakingChange = true;
      result.breakingChangeDescription = protocolBreaking;
      result.categoryRationale = `diff contains protocol-breaking pattern: ${protocolBreaking}`;
    }
  }

  const mergeMatch = subject.match(MERGE_PR_RE);
  if (mergeMatch) {
    result.prNumber = parseInt(mergeMatch[1], 10);
    const afterMerge = subject.replace(MERGE_PR_RE, "").trim();
    result.description = afterMerge || subject;

    const parsed = parsePrefix(afterMerge);
    if (parsed) {
      result.labels.push(...parsed.types);
      result.scope = parsed.scope || "";
      result.description = parsed.description || afterMerge;
      if (parsed.breaking && !result.breakingChange) {
        result.breakingChange = true;
        result.categoryRationale = `commit prefix contains "!" marker`;
      }
      if (!result.categoryRationale) {
        result.categoryRationale = `parsed conventional prefix types: ${parsed.types.join(", ")}`;
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

  const parsed = parsePrefix(result.description);
  if (parsed) {
    result.labels.push(...parsed.types);
    result.scope = parsed.scope || "";
    result.description = parsed.description || result.description;
    if (parsed.breaking && !result.breakingChange) {
      result.breakingChange = true;
      result.categoryRationale = `commit prefix contains "!" marker`;
    }
    if (!result.categoryRationale) {
      result.categoryRationale = `parsed prefix types: ${parsed.types.join(", ")}`;
    }
  } else {
    result.categoryRationale = result.categoryRationale || "no prefix matched → Uncategorized";
  }

  return result;
}

function extractNestedParenContent(str, openPos) {
  if (str.charCodeAt(openPos) !== 40) return null;
  let depth = 1;
  let i = openPos + 1;
  while (i < str.length && depth > 0) {
    const ch = str.charCodeAt(i);
    if (ch === 40) depth++;
    else if (ch === 41) depth--;
    i++;
  }
  return depth === 0 ? str.slice(openPos + 1, i - 1) : null;
}

export function parsePrefix(subject) {
  const typeMatch = subject.match(/^(\w+)\(/);
  if (typeMatch) {
    const types = parseCombinedTypes(typeMatch[1]);
    const openPos = typeMatch[0].length - 1;
    const scopeContent = extractNestedParenContent(subject, openPos);
    if (scopeContent !== null) {
      let rest = subject.slice(openPos + scopeContent.length + 2);
      let breaking = false;
      if (rest.charCodeAt(0) === 33) {
        breaking = true;
        rest = rest.slice(1);
      }
      if (rest.charCodeAt(0) === 58) {
        rest = rest.slice(1).trimStart();
        return {
          types,
          scope: scopeContent,
          breaking,
          description: rest,
        };
      }
    }
  }

  const convMatch = subject.match(CONVENTIONAL_RE);
  if (convMatch) {
    const types = parseCombinedTypes(convMatch[1]);
    return {
      types,
      scope: convMatch[2] || "",
      breaking: convMatch[3] === "!",
      description: convMatch[4],
    };
  }

  const cnMatch = subject.match(CHINESE_PREFIX_RE);
  if (cnMatch) {
    const prefixRaw = cnMatch[1];
    const mapped = CHINESE_PREFIX_MAP[prefixRaw] || customPrefixes[prefixRaw] || null;
    const types = mapped ? [mapped] : parseCombinedTypes(prefixRaw);
    return {
      types,
      scope: cnMatch[2] || "",
      breaking: cnMatch[3] === "!",
      description: cnMatch[4],
    };
  }

  const combinedMatch = subject.match(COMBINED_PREFIX_RE);
  if (combinedMatch) {
    const rawTypes = combinedMatch[1];
    const separators = /[+&/\-\s,]+/;
    if (separators.test(rawTypes) && rawTypes.length > 1) {
      const parts = rawTypes.split(separators).filter(Boolean);
      if (parts.length >= 2) {
        const types = parts
          .map((p) => CHINESE_PREFIX_MAP[p] || customPrefixes[p] || p.toLowerCase())
          .filter(Boolean);
        if (types.length >= 1) {
          return {
            types,
            scope: combinedMatch[2] || "",
            breaking: combinedMatch[3] === "!",
            description: combinedMatch[4],
          };
        }
      }
    }
  }

  const customMatch = tryCustomPrefix(subject);
  if (customMatch) return customMatch;

  return null;
}

function parseCombinedTypes(raw) {
  const separators = /[+&/\-\s,]+/;
  if (separators.test(raw)) {
    const parts = raw.split(separators).filter(Boolean);
    return parts
      .map((p) => CHINESE_PREFIX_MAP[p] || customPrefixes[p] || p.toLowerCase())
      .filter(Boolean);
  }
  const mapped = CHINESE_PREFIX_MAP[raw] || customPrefixes[raw];
  return mapped ? [mapped] : [raw.toLowerCase()];
}

function extractBreakingFromBody(body) {
  const match = body.match(BREAKING_FOOTER_RE);
  return match ? match[1].trim() : "";
}

function scanForProtocolBreaking(hash, from, to, repoPath, subject, body) {
  const combined = `${subject} ${body}`;

  for (const pattern of PROTOCOL_BREAKING_PATTERNS) {
    if (pattern.test(combined)) {
      return pattern
        .toString()
        .replace(/[\/^$\\]/g, "")
        .slice(0, 60);
    }
  }

  try {
    const diff = execSync(`git show --stat --format="" ${hash} 2>/dev/null | head -30`, {
      cwd: repoPath || process.cwd(),
      encoding: "utf-8",
      timeout: 3000,
    });

    const versionFileChanged = /(package\.json|Cargo\.toml|go\.mod|pom\.xml|build\.gradle)/.test(
      diff,
    );
    if (versionFileChanged) {
      try {
        const versionDiff = execSync(
          `git diff ${from}..${to} -- package.json Cargo.toml go.mod pom.xml build.gradle 2>/dev/null | grep -E '^[+-].*"version"|^[+-].*version.*=' | head -5`,
          { cwd: repoPath || process.cwd(), encoding: "utf-8", timeout: 3000 },
        ).trim();
        if (versionDiff) {
          const majorBump =
            /-\s*"?version"?\s*[:=]\s*"?(\d+)\..*\+\s*"?version"?\s*[:=]\s*"?(\d+)\./.exec(
              versionDiff,
            );
          if (majorBump && parseInt(majorBump[2], 10) > parseInt(majorBump[1], 10)) {
            return `major version bump detected (${majorBump[1]} → ${majorBump[2]})`;
          }
        }
      } catch {
        /* ignore */
      }
    }

    const fullDiff = execSync(`git show --format="" ${hash} 2>/dev/null | head -200`, {
      cwd: repoPath || process.cwd(),
      encoding: "utf-8",
      timeout: 3000,
    });

    for (const pattern of PROTOCOL_BREAKING_PATTERNS) {
      if (pattern.test(fullDiff)) {
        return pattern
          .toString()
          .replace(/[\/^$\\]/g, "")
          .slice(0, 60);
      }
    }
  } catch {
    /* ignore */
  }

  return "";
}

function tryCustomPrefix(subject) {
  for (const [prefix, mappedType] of Object.entries(customPrefixes)) {
    const escapedPrefix = escapeRegex(prefix);
    const prefixRe = new RegExp(`^${escapedPrefix}`);
    if (prefixRe.test(subject)) {
      const afterPrefix = subject.slice(prefix.length);
      if (afterPrefix.charCodeAt(0) === 40) {
        const scopeContent = extractNestedParenContent(subject, prefix.length);
        if (scopeContent !== null) {
          let rest = subject.slice(prefix.length + scopeContent.length + 2);
          let breaking = false;
          if (rest.charCodeAt(0) === 33) {
            breaking = true;
            rest = rest.slice(1);
          }
          if (rest.charCodeAt(0) === 58) {
            rest = rest.slice(1).trimStart();
            return {
              types: [mappedType],
              scope: scopeContent,
              breaking,
              description: rest,
            };
          }
        }
      } else if (afterPrefix.charCodeAt(0) === 58 || afterPrefix.charCodeAt(0) === 33) {
        let rest = afterPrefix;
        let breaking = false;
        if (rest.charCodeAt(0) === 33) {
          breaking = true;
          rest = rest.slice(1);
        }
        if (rest.charCodeAt(0) === 58) {
          rest = rest.slice(1).trimStart();
          return {
            types: [mappedType],
            scope: "",
            breaking,
            description: rest,
          };
        }
      }
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
    return (data.labels || []).map((l) => (typeof l === "string" ? l : l.name));
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

export function isGitRepo(repoPath) {
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      cwd: repoPath || process.cwd(),
      encoding: "utf-8",
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

export { CHINESE_PREFIX_MAP, PROTOCOL_BREAKING_PATTERNS, MERGE_PR_RE };
