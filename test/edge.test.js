import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groupByLabel, resolveCategoryWithRationale } from "../src/group.js";
import {
  generateMarkdown,
  generateKeepAChangelog,
  generatePlainText,
  render,
} from "../src/markdown.js";
import { CHINESE_PREFIX_MAP, PROTOCOL_BREAKING_PATTERNS, isGitRepo } from "../src/git.js";

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

const FEATURES = "\u{1F680} Features";
const BUG_FIXES = "\u{1F41B} Bug Fixes";
const UNCATEGORIZED = "\u{1F4E6} Uncategorized";
const SECURITY = "\u{1F512} Security";
const YANKED = "\u{1F4CC} Yanked";

describe("Edge: Empty commits array", function () {
  it("should return empty Map for empty input", function () {
    const result = groupByLabel([]);
    assert.ok(result instanceof Map);
    assert.equal(result.size, 0);
  });

  it("should generate valid output for empty groups", function () {
    const empty = new Map();
    const md = generateMarkdown(empty, { version: "v0.0.1" });
    assert.ok(md.includes("Release Notes - v0.0.1"));
    assert.ok(md.includes("Total Changes**: 0"));
  });
});

describe("Edge: Single commit", function () {
  it("should group a single feature commit", function () {
    const commit = makeCommit({ description: "add login", labels: ["feat"] });
    const groups = groupByLabel([commit]);
    assert.equal(groups.size, 1);
    assert.ok(groups.has(FEATURES));
    assert.equal(groups.get(FEATURES).length, 1);
    assert.equal(groups.get(FEATURES)[0].description, "add login");
  });

  it("should render markdown for a single commit", function () {
    const commit = makeCommit({ description: "one thing" });
    const groups = groupByLabel([commit]);
    const md = generateMarkdown(groups, {});
    assert.ok(md.includes("one thing"));
  });

  it("should produce correct rationale for single commit", function () {
    const { category, rationale } = resolveCategoryWithRationale(["fix"]);
    assert.equal(category, BUG_FIXES);
    assert.ok(rationale.includes("LABEL_MAP"));
  });
});

describe("Edge: Uncategorized commits", function () {
  it("should handle commits with no labels", function () {
    const commit = makeCommit({ labels: [], description: "no label" });
    const groups = groupByLabel([commit]);
    assert.ok(groups.has(UNCATEGORIZED));
  });

  it("should handle commits with undefined labels", function () {
    const commit = makeCommit({ labels: undefined, description: "undef label" });
    const groups = groupByLabel([commit]);
    assert.ok(groups.has(UNCATEGORIZED));
  });

  it("should handle commits with unrecognized labels", function () {
    const commit = makeCommit({ labels: ["xyz-custom-unknown"], description: "weird" });
    const groups = groupByLabel([commit]);
    assert.ok(groups.has(UNCATEGORIZED));
  });
});

describe("Edge: Category rationale tracking", function () {
  it("should include rationale on each commit after grouping", function () {
    const commits = [
      makeCommit({ labels: ["feat"], description: "a" }),
      makeCommit({ labels: ["kind/feature"], description: "b" }),
      makeCommit({ labels: ["whatever-unknown"], description: "c" }),
    ];
    groupByLabel(commits);
    assert.ok(
      commits[0].categoryRationale.includes("prefix") ||
        commits[0].categoryRationale.includes("LABEL_MAP"),
    );
    assert.ok(
      commits[1].categoryRationale.includes("alias") ||
        commits[1].categoryRationale.includes("LABEL_MAP"),
    );
    assert.ok(
      commits[2].categoryRationale.includes("Uncategorized") ||
        commits[2].categoryRationale.includes("no match"),
    );
  });

  it("should produce rationale for breaking change commits", function () {
    const commit = makeCommit({ breakingChange: true, labels: ["feat"] });
    groupByLabel([commit]);
    assert.ok(commit.categoryRationale.includes("breaking"));
  });
});

describe("Edge: Combined prefix types", function () {
  it("should map security label to Security category", function () {
    const commit = makeCommit({ labels: ["security"] });
    const groups = groupByLabel([commit]);
    assert.ok(groups.has(SECURITY));
  });

  it("should map yanked label to Yanked category", function () {
    const commit = makeCommit({ labels: ["yanked"] });
    const groups = groupByLabel([commit]);
    assert.ok(groups.has(YANKED));
  });
});

describe("Edge: Keep a Changelog Security and Yanked sections", function () {
  it("should render Security section", function () {
    const groups = new Map([
      [SECURITY, [makeCommit({ description: "fix security issue", labels: ["security"] })]],
    ]);
    const md = generateKeepAChangelog(groups, {});
    assert.ok(md.includes("### Security"));
    assert.ok(md.includes("fix security issue"));
  });

  it("should render Yanked section", function () {
    const groups = new Map([
      [YANKED, [makeCommit({ description: "revert previous release", labels: ["yanked"] })]],
    ]);
    const md = generateKeepAChangelog(groups, {});
    assert.ok(md.includes("### Yanked"));
    assert.ok(md.includes("revert previous release"));
  });
});

describe("Edge: Plain text output edge cases", function () {
  it("should not include markdown bold markers", function () {
    const groups = new Map([[FEATURES, [makeCommit({ scope: "auth", description: "add login" })]]]);
    const text = generatePlainText(groups, {});
    assert.ok(!text.includes("**"));
    assert.ok(text.includes("[auth]"));
    assert.ok(text.includes("add login"));
  });
});

describe("Edge: render function switch", function () {
  it("should fall back to default for unknown template", function () {
    const groups = new Map([[FEATURES, [makeCommit({ description: "x" })]]]);
    const output = render(groups, { template: "nonexistent" });
    assert.ok(output.includes("## " + FEATURES));
  });
});

describe("Edge: Protocol breaking patterns", function () {
  it("should include patterns for API version bumps", function () {
    assert.ok(
      PROTOCOL_BREAKING_PATTERNS.some(function (p) {
        return p.test("v1 -> v2");
      }),
    );
    assert.ok(
      PROTOCOL_BREAKING_PATTERNS.some(function (p) {
        return p.test("Breaking change in API");
      }),
    );
    assert.ok(
      PROTOCOL_BREAKING_PATTERNS.some(function (p) {
        return p.test("remove public endpoint");
      }),
    );
  });
});

describe("Edge: Chinese prefix map completeness", function () {
  it("should include security and yanked chinese prefixes", function () {
    assert.equal(CHINESE_PREFIX_MAP["安全"], "security");
    assert.equal(CHINESE_PREFIX_MAP["撤回"], "yanked");
  });
});

describe("Edge: isGitRepo", function () {
  it("should return true for current working directory", function () {
    assert.equal(isGitRepo(process.cwd()), true);
  });

  it("should return false for a non-existent directory", function () {
    assert.equal(isGitRepo("/this/path/definitely/does/not/exist/xyz123"), false);
  });
});
