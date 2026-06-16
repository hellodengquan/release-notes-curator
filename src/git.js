import { execSync } from "node:child_process";

const MERGE_PR_RE = /Merge pull request #(\d+)/i;
const PR_REF_RE = /\(#(\d+)\)/;
const CONVENTIONAL_RE = /^(\w+)(?:\(([^)]+)\))?:\s*(.+)/;

const DEFAULT_SEPARATOR = "---COMMIT_SEP---";
const DEFAULT_FIELD_SEP = "---FIELD_SEP---";

export function getGitLog(from, to, repoPath) {
  const format = `%s${DEFAULT_FIELD_SEP}%H${DEFAULT_FIELD_SEP}%an${DEFAULT_FIELD_SEP}%ai${DEFAULT_SEPARATOR}`;
  const range = from && to ? `${from}...${to}` : from ? `${from}..HEAD` : to ? `${to}` : "";

  let cmd = `git log`;
  if (range) cmd += ` ${range}`;
  cmd += ` --pretty=format:"${format}"`;

  try {
    const raw = execSync(cmd, {
      cwd: repoPath || process.cwd(),
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
    }).trim();

    if (!raw) return [];
    return raw.split(DEFAULT_SEPARATOR).map(parseCommit).filter(Boolean);
  } catch {
    const simpleFormat = `%s${DEFAULT_FIELD_SEP}%H${DEFAULT_FIELD_SEP}%an${DEFAULT_FIELD_SEP}%ai${DEFAULT_SEPARATOR}`;
    let simpleCmd = `git log --pretty=format:"${simpleFormat}"`;
    if (range) simpleCmd += ` ${range}`;

    try {
      const raw2 = execSync(simpleCmd, {
        cwd: repoPath || process.cwd(),
        encoding: "utf-8",
        maxBuffer: 50 * 1024 * 1024,
      }).trim();
      if (!raw2) return [];
      return raw2.split(DEFAULT_SEPARATOR).map(parseCommit).filter(Boolean);
    } catch (err) {
      throw new Error(`Failed to read git log: ${err.message}`);
    }
  }
}

function parseCommit(raw) {
  const parts = raw.split(DEFAULT_FIELD_SEP).map((s) => s.trim());
  if (parts.length < 4) return null;

  const [subject, hash, author, date] = parts;

  const result = {
    hash,
    author,
    date: date ? date.split(" ")[0] : "",
    subject: subject.replace(/^"|"$/g, ""),
    prNumber: null,
    labels: [],
    description: "",
    scope: "",
  };

  const mergeMatch = subject.match(MERGE_PR_RE);
  if (mergeMatch) {
    result.prNumber = parseInt(mergeMatch[1], 10);
    const afterMerge = subject.replace(MERGE_PR_RE, "").trim();
    result.description = afterMerge || subject;
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
    result.description = convMatch[3] || result.description;
  }

  return result;
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
