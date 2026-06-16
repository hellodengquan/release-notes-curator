import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generateMarkdown,
  generateKeepAChangelog,
  generateReleaseNotesYaml,
  generatePlainText,
  render,
} from "../src/markdown.js";

function makeCommit(overrides = {}) {
  return {
    hash: "abc1234",
    author: "testuser",
    date: "2026-06-16",
    subject: "test subject",
    body: "",
    prNumber: null,
    labels: ["feat"],
    description: "test description",
    scope: "",
    breakingChange: false,
    breakingChangeDescription: "",
    affectedPackages: [],
    ...overrides,
  };
}

describe("generateMarkdown", () => {
  it("should generate markdown with version", () => {
    const groups = new Map([["🚀 Features", [makeCommit()]]]);
    const md = generateMarkdown(groups, { version: "v2.0.0" });
    assert.ok(md.includes("Release Notes - v2.0.0"));
  });

  it("should include PR link when repoUrl is provided", () => {
    const groups = new Map([["🚀 Features", [makeCommit({ prNumber: 42 })]]]);
    const md = generateMarkdown(groups, { repoUrl: "https://github.com/org/repo" });
    assert.ok(md.includes("[#42](https://github.com/org/repo/pull/42)"));
  });

  it("should highlight breaking changes with warning", () => {
    const groups = new Map([
      ["💥 Breaking Changes", [makeCommit({ breakingChange: true, breakingChangeDescription: "old api removed" })]],
    ]);
    const md = generateMarkdown(groups, {});
    assert.ok(md.includes("⚠️ **BREAKING**"));
    assert.ok(md.includes("old api removed"));
  });

  it("should show affected packages", () => {
    const groups = new Map([
      ["🚀 Features", [makeCommit({ affectedPackages: ["core", "utils"] })]],
    ]);
    const md = generateMarkdown(groups, {});
    assert.ok(md.includes("[core, utils]"));
  });

  it("should include scope in bold", () => {
    const groups = new Map([
      ["🚀 Features", [makeCommit({ scope: "auth" })]],
    ]);
    const md = generateMarkdown(groups, {});
    assert.ok(md.includes("**auth**:"));
  });

  it("should handle empty groups", () => {
    const groups = new Map();
    const md = generateMarkdown(groups, {});
    assert.ok(md.includes("Release Notes"));
  });
});

describe("generateKeepAChangelog", () => {
  it("should use Keep a Changelog section names", () => {
    const groups = new Map([
      ["🚀 Features", [makeCommit()]],
      ["🐛 Bug Fixes", [makeCommit({ labels: ["fix"], description: "fix bug" })]],
    ]);
    const md = generateKeepAChangelog(groups, { version: "v1.0.0", date: "2026-06-16" });
    assert.ok(md.includes("[v1.0.0] - 2026-06-16"));
    assert.ok(md.includes("### Added"));
    assert.ok(md.includes("### Fixed"));
  });

  it("should map Breaking Changes to its own section", () => {
    const groups = new Map([
      ["💥 Breaking Changes", [makeCommit({ breakingChange: true, breakingChangeDescription: "api changed" })]],
    ]);
    const md = generateKeepAChangelog(groups, {});
    assert.ok(md.includes("### Breaking Changes"));
    assert.ok(md.includes("**BREAKING**"));
  });

  it("should use Unreleased when no version", () => {
    const groups = new Map([["🚀 Features", [makeCommit()]]]);
    const md = generateKeepAChangelog(groups, {});
    assert.ok(md.includes("[Unreleased]"));
  });

  it("should collapse multiple categories into Changed section", () => {
    const groups = new Map([
      ["♻️ Refactoring", [makeCommit({ description: "refactor code" })]],
      ["📝 Documentation", [makeCommit({ description: "update docs" })]],
    ]);
    const md = generateKeepAChangelog(groups, {});
    assert.ok(md.includes("### Changed"));
  });
});

describe("generateReleaseNotesYaml", () => {
  it("should generate valid YAML structure", () => {
    const groups = new Map([["🚀 Features", [makeCommit()]]]);
    const yaml = generateReleaseNotesYaml(groups, { version: "v1.0.0", date: "2026-06-16" });
    assert.ok(yaml.includes('title: "v1.0.0"'));
    assert.ok(yaml.includes('date: "2026-06-16"'));
    assert.ok(yaml.includes("total_commits:"));
    assert.ok(yaml.includes('description: "test description"'));
    assert.ok(yaml.includes('author: "testuser"'));
    assert.ok(yaml.includes('hash: "abc1234"'));
  });

  it("should include breaking flag for breaking changes", () => {
    const groups = new Map([
      ["💥 Breaking Changes", [makeCommit({ breakingChange: true })]],
    ]);
    const yaml = generateReleaseNotesYaml(groups, {});
    assert.ok(yaml.includes("breaking: true"));
  });

  it("should include packages list when affected", () => {
    const groups = new Map([
      ["🚀 Features", [makeCommit({ affectedPackages: ["core"] })]],
    ]);
    const yaml = generateReleaseNotesYaml(groups, {});
    assert.ok(yaml.includes("packages:"));
    assert.ok(yaml.includes('"core"'));
  });

  it("should include PR URL when repoUrl provided", () => {
    const groups = new Map([
      ["🚀 Features", [makeCommit({ prNumber: 10 })]],
    ]);
    const yaml = generateReleaseNotesYaml(groups, { repoUrl: "https://github.com/org/repo" });
    assert.ok(yaml.includes("url:"));
    assert.ok(yaml.includes("/pull/10"));
  });

  it("should escape double quotes in YAML", () => {
    const groups = new Map([
      ["🚀 Features", [makeCommit({ description: 'fix "quotes" issue' })]],
    ]);
    const yaml = generateReleaseNotesYaml(groups, {});
    assert.ok(yaml.includes('\\"quotes\\"'));
  });
});

describe("generatePlainText", () => {
  it("should generate plain text output", () => {
    const groups = new Map([["🚀 Features", [makeCommit()]]]);
    const text = generatePlainText(groups, { version: "v1.0.0" });
    assert.ok(text.includes("Release Notes - v1.0.0"));
    assert.ok(text.includes("test description"));
    assert.ok(!text.includes("**"));
  });

  it("should mark breaking changes with [BREAKING]", () => {
    const groups = new Map([
      ["💥 Breaking Changes", [makeCommit({ breakingChange: true })]],
    ]);
    const text = generatePlainText(groups, {});
    assert.ok(text.includes("[BREAKING]"));
  });
});

describe("render", () => {
  it("should delegate to default template", () => {
    const groups = new Map([["🚀 Features", [makeCommit()]]]);
    const output = render(groups, { template: "default" });
    assert.ok(output.includes("## 🚀 Features"));
  });

  it("should delegate to keepachangelog template", () => {
    const groups = new Map([["🚀 Features", [makeCommit()]]]);
    const output = render(groups, { template: "keepachangelog" });
    assert.ok(output.includes("### Added"));
  });

  it("should delegate to release-notes-yaml template", () => {
    const groups = new Map([["🚀 Features", [makeCommit()]]]);
    const output = render(groups, { template: "release-notes-yaml" });
    assert.ok(output.includes("description:"));
  });
});
