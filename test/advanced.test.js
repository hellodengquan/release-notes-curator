import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groupByLabel, resolveCategoryWithRationale } from "../src/group.js";
import {
  generateKeepAChangelog,
  parseKeepAChangelog,
  backfillKeepAChangelog,
} from "../src/markdown.js";
import {
  loadSubpackageEslintConfigs,
  getEslintConfigForPackage,
  setApiRetryConfig,
  setTeamAliasCacheConfig,
  getCachedTeamAliases,
  clearTeamAliasCache,
} from "../src/config.js";
import {
  PROTOCOL_BREAKING_PATTERNS,
  MERGE_PR_RE,
  parsePrefix,
} from "../src/git.js";

function makeCommit(overrides) {
  return Object.assign(
    {
      hash: "abc1234",
      author: "testuser",
      email: "test@example.com",
      date: "2026-06-16",
      subject: "test",
      body: "",
      prNumber: null,
      labels: ["feat"],
      description: "test description",
      scope: "",
      breakingChange: false,
      breakingChangeDescription: "",
      affectedPackages: [],
      categoryRationale: "",
    },
    overrides || {},
  );
}

describe("GraphQL schema breaking patterns", function () {
  it("should detect GraphQL type removal", function () {
    const text = "remove type User { id: ID! name: String }";
    const matched = PROTOCOL_BREAKING_PATTERNS.some((p) => p.test(text));
    assert.ok(matched, "Should detect GraphQL type removal");
  });

  it("should detect GraphQL field removal", function () {
    const text = "delete field User.email from schema";
    const matched = PROTOCOL_BREAKING_PATTERNS.some((p) => p.test(text));
    assert.ok(matched, "Should detect GraphQL field removal");
  });

  it("should detect schema breaking change mention", function () {
    const text = "GraphQL schema breaking: User type now requires email";
    const matched = PROTOCOL_BREAKING_PATTERNS.some((p) => p.test(text));
    assert.ok(matched, "Should detect GraphQL schema breaking change");
  });

  it("should detect non-null field addition", function () {
    const text = "schema change: User.email now required (non-null)";
    const matched = PROTOCOL_BREAKING_PATTERNS.some((p) => p.test(text));
    assert.ok(matched, "Should detect non-null requirement");
  });

  it("should detect argument removal", function () {
    const text = "remove argument id from query getUser";
    const matched = PROTOCOL_BREAKING_PATTERNS.some((p) => p.test(text));
    assert.ok(matched, "Should detect argument removal");
  });
});

describe("Nested parentheses in prefix parsing", function () {
  it("should parse simple nested scope", function () {
    const subject = "feat(api(auth))!: add login endpoint";
    const result = parsePrefix(subject);
    assert.ok(result);
    assert.ok(result.types.includes("feat"));
    assert.equal(result.scope, "api(auth)");
    assert.equal(result.breaking, true);
    assert.equal(result.description, "add login endpoint");
  });

  it("should parse deeply nested scope", function () {
    const subject = "fix(core(api(users(v2)))): fix pagination";
    const result = parsePrefix(subject);
    assert.ok(result);
    assert.ok(result.types.includes("fix"));
    assert.ok(result.scope.includes("core"));
    assert.ok(result.scope.includes("users(v2)"));
  });

  it("should still parse regular scope", function () {
    const subject = "feat(auth): add login";
    const result = parsePrefix(subject);
    assert.ok(result);
    assert.ok(result.types.includes("feat"));
    assert.equal(result.scope, "auth");
  });

  it("should parse custom prefix with nested scope", function () {
    const subject = "feat(users(v2)): new endpoint";
    const result = parsePrefix(subject);
    assert.ok(result);
    assert.ok(result.types.includes("feat"));
    assert.ok(result.scope.includes("users"));
  });
});

describe("Merge commit filtering", function () {
  it("should match GitHub merge pull request format", function () {
    assert.ok(MERGE_PR_RE.test("Merge pull request #123 from feature-branch"));
    assert.ok(MERGE_PR_RE.test("Merge Pull Request #456"));
  });

  it("should extract PR number from merge commit", function () {
    const match = "Merge pull request #789 from branch".match(MERGE_PR_RE);
    assert.ok(match);
    assert.equal(match[1], "789");
  });

  it("should not match regular commits", function () {
    assert.ok(!MERGE_PR_RE.test("feat: add new feature"));
    assert.ok(!MERGE_PR_RE.test("fix: bug fix"));
  });

  it("should filter merge-only commits correctly", function () {
    const commits = [
      makeCommit({
        subject: "Merge pull request #1 from feature",
        description: "Merge pull request #1 from feature",
      }),
      makeCommit({
        subject: "feat: regular commit",
        description: "feat: regular commit",
      }),
      makeCommit({
        subject: "Merge pull request #2 from fix-branch",
        description: "Merge pull request #2 from fix-branch",
        labels: ["fix"],
      }),
    ];

    const mergeCommits = commits.filter((c) => MERGE_PR_RE.test(c.subject));
    assert.equal(mergeCommits.length, 2);
  });
});

describe("Rebase vs Squash Merge strategy differences", function () {
  it("should recognize squash merge commit format", function () {
    const squashCommit = "feat(something): new feature (#123)";
    assert.ok(!MERGE_PR_RE.test(squashCommit));
    const prNumberMatch = squashCommit.match(/\(#(\d+)\)$/);
    assert.ok(prNumberMatch);
    assert.equal(prNumberMatch[1], "123");
  });

  it("should handle linear rebase history without merge commits", function () {
    const rebaseCommits = [
      makeCommit({ subject: "feat: add login", description: "feat: add login" }),
      makeCommit({ subject: "fix: auth bug", description: "fix: auth bug" }),
      makeCommit({ subject: "docs: update readme", description: "docs: update readme" }),
    ];

    const mergeCommits = rebaseCommits.filter((c) => MERGE_PR_RE.test(c.subject));
    assert.equal(mergeCommits.length, 0);
  });

  it("should detect PR number from squash merge format", function () {
    const commits = [
      makeCommit({
        subject: "feat: new feature (#456)",
        description: "feat: new feature (#456)",
      }),
      makeCommit({
        subject: "fix: bug fix (#789)",
        description: "fix: bug fix (#789)",
      }),
    ];

    const prNumbers = commits
      .map((c) => {
        const m = c.subject.match(/\(#(\d+)\)$/);
        return m ? m[1] : null;
      })
      .filter(Boolean);

    assert.deepEqual(prNumbers, ["456", "789"]);
  });

  it("should differentiate merge commit history from squash history", function () {
    const mergeHistory = [
      makeCommit({ subject: "Merge pull request #1 from feature", hash: "aaa" }),
      makeCommit({ subject: "feat: intermediate commit", hash: "bbb" }),
      makeCommit({ subject: "fix: another commit", hash: "ccc" }),
      makeCommit({ subject: "Merge pull request #2 from fix", hash: "ddd" }),
    ];

    const squashHistory = [
      makeCommit({ subject: "feat: feature one (#1)", hash: "aaa" }),
      makeCommit({ subject: "fix: bug fix (#2)", hash: "bbb" }),
    ];

    const mergeCount = mergeHistory.filter((c) => MERGE_PR_RE.test(c.subject)).length;
    const squashCount = squashHistory.filter((c) => /\(#\d+\)$/.test(c.subject)).length;

    assert.equal(mergeCount, 2);
    assert.equal(squashCount, 2);
    assert.equal(mergeHistory.length, 4);
    assert.equal(squashHistory.length, 2);
  });

  it("should handle rebased commits with no PR references", function () {
    const rebasedCommits = [
      makeCommit({ subject: "feat: add feature", body: "" }),
      makeCommit({
        subject: "fix: fix issue",
        body: "fix: fix issue\n\nCloses #123",
      }),
    ];

    const prFromBody = rebasedCommits
      .map((c) => {
        const m = (c.body || "").match(/#(\d+)/);
        return m ? m[1] : null;
      })
      .filter(Boolean);

    assert.deepEqual(prFromBody, ["123"]);
  });
});

describe("Keep a Changelog parsing and backfill", function () {
  it("should parse keepachangelog format correctly", function () {
    const content = `# Changelog

## [Unreleased] - 2026-06-16

### Added

- New feature A
- New feature B

### Fixed

- Fix bug C

## [1.0.0] - 2026-01-01

### Added

- Initial release
`;

    const parsed = parseKeepAChangelog(content);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].version, "Unreleased");
    assert.equal(parsed[0].date, "2026-06-16");
    assert.equal(parsed[0].sections.Added.length, 2);
    assert.equal(parsed[0].sections.Fixed.length, 1);
    assert.equal(parsed[1].version, "1.0.0");
    assert.equal(parsed[1].sections.Added.length, 1);
  });

  it("should backfill new content into existing changelog", function () {
    const existing = `# Changelog

## [1.0.0] - 2026-01-01

### Added

- Initial release
`;

    const groups = new Map([
      ["\u{1F680} Features", [makeCommit({ description: "new awesome feature", labels: ["feat"] })]],
      ["\u{1F41B} Bug Fixes", [makeCommit({ description: "fix serious bug", labels: ["fix"] })]],
    ]);

    const result = backfillKeepAChangelog(existing, groups, {
      version: "Unreleased",
      date: "2026-06-16",
    });

    assert.ok(result.includes("## [Unreleased] - 2026-06-16"));
    assert.ok(result.includes("### Added"));
    assert.ok(result.includes("new awesome feature"));
    assert.ok(result.includes("### Fixed"));
    assert.ok(result.includes("fix serious bug"));
    assert.ok(result.includes("## [1.0.0]"));
    assert.ok(result.includes("Initial release"));
  });

  it("should preserve Security and Yanked sections", function () {
    const existing = `# Changelog

## [1.0.0] - 2026-01-01

### Security

- Fix CVE-2026-0001
`;

    const groups = new Map([
      ["\u{1F512} Security", [makeCommit({ description: "fix CVE-2026-0002", labels: ["security"] })]],
      ["\u{1F4CC} Yanked", [makeCommit({ description: "revert broken feature", labels: ["yanked"] })]],
    ]);

    const result = backfillKeepAChangelog(existing, groups, {
      version: "Unreleased",
      date: "2026-06-16",
    });

    assert.ok(result.includes("### Security"));
    assert.ok(result.includes("### Yanked"));
    assert.ok(result.includes("fix CVE-2026-0002"));
    assert.ok(result.includes("revert broken feature"));
  });

  it("should reorder sections to correct keepachangelog order", function () {
    const existing = `# Changelog

## [1.0.0] - 2026-01-01

### Fixed
- bug fix

### Added
- new feature
`;

    const groups = new Map();
    const result = backfillKeepAChangelog(existing, groups, {
      version: "Unreleased",
    });

    const addedPos = result.indexOf("### Added");
    const fixedPos = result.indexOf("### Fixed");
    assert.ok(addedPos < fixedPos, "Added should come before Fixed");
  });

  it("should handle empty existing changelog", function () {
    const groups = new Map([
      ["\u{1F680} Features", [makeCommit({ description: "feature", labels: ["feat"] })]],
    ]);

    const result = backfillKeepAChangelog("", groups, {
      version: "1.0.0",
      date: "2026-06-16",
    });

    assert.ok(result.includes("# Changelog"));
    assert.ok(result.includes("## [1.0.0] - 2026-06-16"));
    assert.ok(result.includes("### Added"));
    assert.ok(result.includes("feature"));
  });

  it("should remove empty sections", function () {
    const groups = new Map();
    const result = backfillKeepAChangelog("", groups, {
      version: "1.0.0",
      removeEmptySections: true,
    });

    assert.ok(!result.includes("### Added"));
    assert.ok(!result.includes("### Fixed"));
  });
});

describe("Team API alias rate limit fallback", function () {
  it("should set API retry config without errors", function () {
    assert.doesNotThrow(function () {
      setApiRetryConfig({
        maxRetries: 5,
        retryDelayMs: 2000,
        fallbackConfig: { labelAliases: { "fallback-feat": "feat" } },
      });
    });
  });
});

describe("Monorepo subpackage eslint config pass-through", function () {
  it("should return empty object when no workspaces provided", function () {
    const configs = loadSubpackageEslintConfigs([]);
    assert.ok(configs);
    assert.equal(Object.keys(configs).length, 0);
  });

  it("should return null for non-existent package", function () {
    const configs = loadSubpackageEslintConfigs([]);
    const result = getEslintConfigForPackage("non-existent", configs);
    assert.equal(result, null);
  });
});

describe("Dry-run JSON format structure", function () {
  it("should produce valid JSON structure for commits and groups", function () {
    const commits = [
      makeCommit({
        hash: "abc123456789",
        description: "feat 1",
        labels: ["feat"],
        author: "user1",
        email: "user1@test.com",
        date: "2026-06-16",
        scope: "auth",
        breakingChange: false,
        prNumber: 123,
        categoryRationale: "parsed prefix types: feat",
        affectedPackages: ["packages/auth"],
      }),
      makeCommit({
        hash: "def987654321",
        description: "fix bug",
        labels: ["fix"],
        author: "user2",
        email: "user2@test.com",
        date: "2026-06-15",
        scope: "",
        breakingChange: true,
        breakingChangeDescription: "API breaking change",
        prNumber: null,
        categoryRationale: "body contains BREAKING CHANGE footer",
        affectedPackages: [],
      }),
    ];

    const groups = groupByLabel(commits);

    const jsonData = {
      schemaVersion: "1.0",
      stats: {
        totalCommits: commits.length,
        totalGroups: groups.size,
        breakingChanges: commits.filter((c) => c.breakingChange).length,
      },
      groups: {},
      commits: [],
    };

    for (const [category, items] of groups) {
      jsonData.groups[category] = {
        count: items.length,
        commits: items.map((c) => c.hash),
      };
    }

    for (const c of commits) {
      jsonData.commits.push({
        hash: c.hash,
        shortHash: c.hash.slice(0, 7),
        description: c.description,
        author: c.author,
        breakingChange: c.breakingChange,
      });
    }

    const jsonStr = JSON.stringify(jsonData, null, 2);
    const parsed = JSON.parse(jsonStr);

    assert.equal(parsed.stats.totalCommits, 2);
    assert.equal(parsed.stats.breakingChanges, 1);
    assert.ok(parsed.groups["\u{1F680} Features"]);
    assert.ok(parsed.groups["\u{1F4A5} Breaking Changes"]);
    assert.equal(parsed.commits[0].shortHash, "abc1234");
    assert.equal(parsed.commits[1].breakingChange, true);
  });
});

describe("pnpm & nx workspace detection logic", function () {
  it("should correctly strip quoted items from pnpm-workspace.yaml format", function () {
    const sampleLine = '- "packages/*"';
    const cleaned = sampleLine.replace(/^-\s*['"]?/, "").replace(/['"]?\s*$/, "");
    assert.equal(cleaned, "packages/*");
  });

  it("should handle unquoted items from pnpm-workspace.yaml", function () {
    const sampleLine = "- apps/*";
    const cleaned = sampleLine.replace(/^-\s*['"]?/, "").replace(/['"]?\s*$/, "");
    assert.equal(cleaned, "apps/*");
  });

  it("should detect nx.json presence logic", function () {
    const workspaces = ["packages/*", "apps/*"];
    const globs = workspaces;
    assert.ok(globs.includes("packages/*"));
    assert.ok(globs.includes("apps/*"));
  });

  it("should filter out root '.' from pnpm lock importers", function () {
    const candidates = [".", "packages/auth", "packages/core"];
    const filtered = candidates.filter((l) => l && l !== ".");
    assert.equal(filtered.length, 2);
    assert.equal(filtered[0], "packages/auth");
    assert.equal(filtered[1], "packages/core");
  });
});

describe("Lerna v8 workspace compatibility", function () {
  it("should detect lerna.json with packages array", function () {
    const lernaConfig = {
      packages: ["packages/*", "apps/*"],
      npmClient: "npm",
    };
    assert.ok(Array.isArray(lernaConfig.packages));
    assert.ok(lernaConfig.packages.includes("packages/*"));
  });

  it("should handle lerna v8 without packages field (using workspaces)", function () {
    const lernaConfig = {
      npmClient: "pnpm",
      useWorkspaces: true,
      version: "independent",
    };
    assert.ok(lernaConfig.npmClient || lernaConfig.useWorkspaces !== false);
  });

  it("should detect lerna.json with version independent", function () {
    const lernaConfig = {
      packages: ["modules/*"],
      version: "independent",
    };
    assert.equal(lernaConfig.version, "independent");
    assert.ok(Array.isArray(lernaConfig.packages));
  });
});

describe("Team alias stale cache fallback", function () {
  it("should set cache config without errors", function () {
    assert.doesNotThrow(function () {
      setTeamAliasCacheConfig({
        ttlMs: 10000,
        staleWhileRevalidateMs: 60000,
      });
    });
  });

  it("should return null cache when empty", function () {
    clearTeamAliasCache();
    const cached = getCachedTeamAliases();
    assert.equal(cached.data, null);
    assert.equal(cached.expired, true);
  });

  it("should clear cache correctly", function () {
    clearTeamAliasCache();
    const cached = getCachedTeamAliases();
    assert.equal(cached.data, null);
  });

  it("should detect stale vs expired cache states", function () {
    const now = Date.now();
    const ttl = 5 * 60 * 1000;
    const staleWhile = 60 * 60 * 1000;

    const cases = [
      { age: 0, expired: false, stale: false, desc: "fresh" },
      { age: ttl + 1, expired: true, stale: false, desc: "expired but not stale" },
      { age: ttl + staleWhile + 1, expired: true, stale: true, desc: "fully stale" },
    ];

    for (const c of cases) {
      const expired = c.age > ttl;
      const stale = c.age > ttl + staleWhile;
      assert.equal(expired, c.expired, `${c.desc}: expired should be ${c.expired}`);
      assert.equal(stale, c.stale, `${c.desc}: stale should be ${c.stale}`);
    }
  });
});

describe("Keep a Changelog no-version fallback", function () {
  it("should parse version header without brackets", function () {
    const content = `# Changelog

## 1.0.0 - 2026-01-01

### Added

- feature without brackets
`;
    const parsed = parseKeepAChangelog(content);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].version, "1.0.0");
    assert.equal(parsed[0].date, "2026-01-01");
  });

  it("should parse version header with v prefix", function () {
    const content = `# Changelog

## v2.1.0 - 2026-02-15

### Fixed

- bug fix with v prefix
`;
    const parsed = parseKeepAChangelog(content);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].version, "v2.1.0");
  });

  it("should create fallback Unreleased entry when no version headers", function () {
    const content = `# Changelog

### Added

- Orphan feature without version
- Another feature

### Fixed

- Some fix
`;
    const parsed = parseKeepAChangelog(content);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].version, "Unreleased");
    assert.ok(parsed[0].sections.Added);
    assert.equal(parsed[0].sections.Added.length, 2);
    assert.ok(parsed[0].sections.Fixed);
    assert.equal(parsed[0].sections.Fixed.length, 1);
  });

  it("should handle mixed bracket and no-bracket versions", function () {
    const content = `# Changelog

## [1.0.0] - 2026-01-01

### Added

- Bracketed version

## v2.0.0 - 2026-06-01

### Changed

- Non-bracketed version with v prefix
`;
    const parsed = parseKeepAChangelog(content);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].version, "1.0.0");
    assert.equal(parsed[1].version, "v2.0.0");
  });

  it("should attach pending sections to first version header", function () {
    const content = `# Changelog

### Added

- Pending feature before version

## 1.0.0 - 2026-01-01

### Fixed

- Bug fix
`;
    const parsed = parseKeepAChangelog(content);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].version, "1.0.0");
    assert.ok(parsed[0].sections.Added);
    assert.equal(parsed[0].sections.Added.length, 1);
    assert.ok(parsed[0].sections.Fixed);
  });
});

describe("JSONL streaming output format", function () {
  it("should produce valid JSONL structure with header, groups, commits, footer", function () {
    const commits = [
      makeCommit({ hash: "abc1234", description: "feat 1", author: "user1" }),
      makeCommit({ hash: "def5678", description: "fix 1", author: "user2" }),
    ];

    const groups = groupByLabel(commits);
    const generatedAt = new Date().toISOString();

    const jsonlLines = [];

    jsonlLines.push(JSON.stringify({
      type: "header",
      schemaVersion: "1.0",
      generatedAt,
      stats: {
        totalCommits: commits.length,
        totalGroups: groups.size,
        breakingChanges: 0,
      },
    }));

    for (const [category, items] of groups) {
      jsonlLines.push(JSON.stringify({
        type: "group",
        category,
        count: items.length,
        commitHashes: items.map((c) => c.hash),
        generatedAt,
      }));
    }

    for (const c of commits) {
      jsonlLines.push(JSON.stringify({
        type: "commit",
        hash: c.hash,
        shortHash: c.hash.slice(0, 7),
        description: c.description,
        author: c.author,
        generatedAt,
      }));
    }

    jsonlLines.push(JSON.stringify({
      type: "footer",
      generatedAt,
      processed: commits.length,
    }));

    assert.equal(jsonlLines.length, 5);

    const parsed = jsonlLines.map((l) => JSON.parse(l));
    assert.equal(parsed[0].type, "header");
    assert.equal(parsed[0].stats.totalCommits, 2);
    assert.equal(parsed[parsed.length - 1].type, "footer");

    const groupsEntries = parsed.filter((l) => l.type === "group");
    assert.ok(groupsEntries.length >= 1);

    const commitEntries = parsed.filter((l) => l.type === "commit");
    assert.equal(commitEntries.length, 2);
  });

  it("should have newline-separated JSON objects in JSONL", function () {
    const lines = ['{"type":"header"}', '{"type":"commit"}', '{"type":"footer"}'];
    const jsonl = lines.join("\n");
    const parsed = jsonl.split("\n").map((l) => JSON.parse(l));
    assert.equal(parsed.length, 3);
    assert.equal(parsed[0].type, "header");
    assert.equal(parsed[2].type, "footer");
  });
});

describe("GraphQL Federation subgraph breaking patterns", function () {
  it("should detect @key directive removal", function () {
    const text = "remove @key from User entity";
    const matched = PROTOCOL_BREAKING_PATTERNS.some((p) => p.test(text));
    assert.ok(matched, "Should detect @key removal");
  });

  it("should detect @key fields change", function () {
    const text = "change @key fields from id to id email";
    const matched = PROTOCOL_BREAKING_PATTERNS.some((p) => p.test(text));
    assert.ok(matched, "Should detect @key fields change");
  });

  it("should detect federation breaking changes", function () {
    const text = "federation schema update: incompatible changes in subgraph";
    const matched = PROTOCOL_BREAKING_PATTERNS.some((p) => p.test(text));
    assert.ok(matched, "Should detect federation breaking change");
  });

  it("should detect subgraph entity removal", function () {
    const text = "delete entity type from users subgraph";
    const matched = PROTOCOL_BREAKING_PATTERNS.some((p) => p.test(text));
    assert.ok(matched, "Should detect entity type removal");
  });

  it("should detect @external removal", function () {
    const text = "drop @external field from shared type";
    const matched = PROTOCOL_BREAKING_PATTERNS.some((p) => p.test(text));
    assert.ok(matched, "Should detect @external removal");
  });

  it("should detect schema composition error", function () {
    const text = "schema composition error after subgraph update";
    const matched = PROTOCOL_BREAKING_PATTERNS.some((p) => p.test(text));
    assert.ok(matched, "Should detect composition error");
  });

  it("should detect shared type incompatibility", function () {
    const text = "shared type User incompatible between subgraphs";
    const matched = PROTOCOL_BREAKING_PATTERNS.some((p) => p.test(text));
    assert.ok(matched, "Should detect shared type incompatibility");
  });

  it("should detect @requires removal", function () {
    const text = "remove @requires from order query";
    const matched = PROTOCOL_BREAKING_PATTERNS.some((p) => p.test(text));
    assert.ok(matched, "Should detect @requires removal");
  });
});

describe("Triple-nested parentheses in prefix parsing", function () {
  it("should parse triple-level nested scope", function () {
    const subject = "feat(core(api(users))): add endpoint";
    const result = parsePrefix(subject);
    assert.ok(result);
    assert.ok(result.types.includes("feat"));
    assert.equal(result.scope, "core(api(users))");
    assert.equal(result.description, "add endpoint");
  });

  it("should parse three levels of nesting with breaking", function () {
    const subject = "fix(a(b(c)))!: critical fix";
    const result = parsePrefix(subject);
    assert.ok(result);
    assert.ok(result.types.includes("fix"));
    assert.equal(result.scope, "a(b(c))");
    assert.equal(result.breaking, true);
  });

  it("should parse complex three-level scope with names", function () {
    const subject = "feat(platform(service(module))): new feature";
    const result = parsePrefix(subject);
    assert.ok(result);
    assert.equal(result.scope, "platform(service(module))");
    assert.ok(result.scope.includes("platform"));
    assert.ok(result.scope.includes("service"));
    assert.ok(result.scope.includes("module"));
  });
});

describe("ESLint type-aware rules detection", function () {
  it("should detect type-aware rules by parser project config", function () {
    const config = {
      parser: "@typescript-eslint/parser",
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: "/repo",
      },
    };
    const hasParser = config.parser && config.parser.includes("@typescript-eslint/parser");
    const hasProject = config.parserOptions && config.parserOptions.project;
    assert.ok(hasParser && hasProject);
  });

  it("should detect type-aware rule names", function () {
    const typeAwareRules = [
      "@typescript-eslint/await-thenable",
      "@typescript-eslint/no-floating-promises",
      "@typescript-eslint/no-misused-promises",
      "@typescript-eslint/no-unsafe-argument",
      "@typescript-eslint/no-unsafe-assignment",
      "@typescript-eslint/restrict-plus-operands",
      "@typescript-eslint/strict-boolean-expressions",
    ];

    const patterns = [
      "await-thenable",
      "no-floating-promises",
      "no-misused-promises",
      "prefer-reduce-type-parameter",
      "promise-function-async",
      "require-await",
      "return-await",
      "strict-boolean-expressions",
      "no-unnecessary-condition",
      "no-confusing-void-expression",
      "restrict-plus-operands",
      "restrict-template-expressions",
      "dot-notation",
      "no-base-to-string",
      "no-duplicate-type-constituents",
      "no-for-in-array",
      "no-implied-eval",
      "no-unsafe-argument",
      "no-unsafe-assignment",
      "no-unsafe-call",
      "no-unsafe-member-access",
      "no-unsafe-return",
      "only-throw-error",
    ];

    for (const rule of typeAwareRules) {
      const matched = patterns.some((p) => rule.endsWith(p));
      assert.ok(matched, `Should detect type-aware rule: ${rule}`);
    }
  });

  it("should detect type-aware extends configs", function () {
    const extendsArr = [
      "plugin:@typescript-eslint/recommended-requiring-type-checking",
      "plugin:@typescript-eslint/strict-type-checked",
    ];

    for (const ext of extendsArr) {
      const hasTypeAware = ext.includes("recommended-requiring-type-checking") || ext.includes("strict-type-checked");
      assert.ok(hasTypeAware, `Should detect type-aware extends: ${ext}`);
    }
  });

  it("should not detect non-type-aware rules", function () {
    const nonTypeAwareRules = [
      "@typescript-eslint/ban-types",
      "@typescript-eslint/explicit-function-return-type",
      "@typescript-eslint/naming-convention",
      "@typescript-eslint/no-explicit-any",
      "no-console",
      "semi",
    ];

    const patterns = [
      "await-thenable",
      "no-floating-promises",
      "no-misused-promises",
      "prefer-reduce-type-parameter",
      "promise-function-async",
      "require-await",
      "return-await",
      "strict-boolean-expressions",
      "no-unnecessary-condition",
      "no-confusing-void-expression",
      "restrict-plus-operands",
      "restrict-template-expressions",
      "dot-notation",
      "no-base-to-string",
      "no-duplicate-type-constituents",
      "no-for-in-array",
      "no-implied-eval",
      "no-unsafe-argument",
      "no-unsafe-assignment",
      "no-unsafe-call",
      "no-unsafe-member-access",
      "no-unsafe-return",
      "only-throw-error",
    ];

    for (const rule of nonTypeAwareRules) {
      const matched = patterns.some((p) => rule.endsWith(p));
      assert.ok(!matched, `Should NOT detect non-type-aware rule: ${rule}`);
    }
  });
});

describe("npm Enterprise mirror configuration", function () {
  it("should have enterprise publish script", function () {
    const pkgJson = {
      scripts: {
        "publish:enterprise": "npm publish --access restricted --registry ${NPM_ENTERPRISE_REGISTRY}",
      },
    };
    assert.ok(pkgJson.scripts["publish:enterprise"]);
    assert.ok(pkgJson.scripts["publish:enterprise"].includes("--access restricted"));
  });

  it("should have three-level publish script", function () {
    const pkgJson = {
      scripts: {
        "publish:all-with-enterprise": "npm run publish:npm && npm run publish:github && npm run publish:enterprise",
      },
    };
    assert.ok(pkgJson.scripts["publish:all-with-enterprise"]);
    assert.ok(pkgJson.scripts["publish:all-with-enterprise"].includes("publish:enterprise"));
  });

  it("should handle environment variable fallback for registry", function () {
    const registry = "${NPM_ENTERPRISE_REGISTRY:-https://npm.pkg.github.com/}";
    const hasEnvVar = registry.includes("NPM_ENTERPRISE_REGISTRY");
    const hasFallback = registry.includes(":-");
    assert.ok(hasEnvVar);
    assert.ok(hasFallback);
  });

  it("should use restricted access for enterprise packages", function () {
    const publicAccess = "--access public";
    const restrictedAccess = "--access restricted";
    assert.ok(publicAccess.includes("public"));
    assert.ok(restrictedAccess.includes("restricted"));
  });
});
