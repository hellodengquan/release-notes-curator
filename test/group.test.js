import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groupByLabel, mergeLabels, normalizeLabel } from "../src/group.js";

describe("groupByLabel", () => {
  it("should group feat commits into Features", () => {
    const commits = [
      { labels: ["feat"], description: "add login", breakingChange: false },
    ];
    const groups = groupByLabel(commits);
    assert.ok(groups.has("🚀 Features"));
    assert.equal(groups.get("🚀 Features").length, 1);
  });

  it("should group fix commits into Bug Fixes", () => {
    const commits = [
      { labels: ["fix"], description: "fix crash", breakingChange: false },
    ];
    const groups = groupByLabel(commits);
    assert.ok(groups.has("🐛 Bug Fixes"));
  });

  it("should group Chinese prefix commits correctly", () => {
    const commits = [
      { labels: ["新增"], description: "添加用户模块", breakingChange: false },
      { labels: ["修复"], description: "修复登录问题", breakingChange: false },
      { labels: ["文档"], description: "更新 README", breakingChange: false },
    ];
    const groups = groupByLabel(commits);
    assert.ok(groups.has("🚀 Features"));
    assert.ok(groups.has("🐛 Bug Fixes"));
    assert.ok(groups.has("📝 Documentation"));
  });

  it("should prioritize breaking changes into Breaking Changes group", () => {
    const commits = [
      { labels: ["feat"], description: "new api", breakingChange: true, breakingChangeDescription: "old api removed" },
    ];
    const groups = groupByLabel(commits);
    assert.ok(groups.has("💥 Breaking Changes"));
    assert.equal(groups.get("💥 Breaking Changes").length, 1);
    assert.ok(!groups.has("🚀 Features"));
  });

  it("should handle empty labels as Uncategorized", () => {
    const commits = [
      { labels: [], description: "random change", breakingChange: false },
    ];
    const groups = groupByLabel(commits);
    assert.ok(groups.has("📦 Uncategorized"));
  });

  it("should handle null labels as Uncategorized", () => {
    const commits = [
      { labels: null, description: "random", breakingChange: false },
    ];
    const groups = groupByLabel(commits);
    assert.ok(groups.has("📦 Uncategorized"));
  });

  it("should handle empty commits array", () => {
    const groups = groupByLabel([]);
    assert.equal(groups.size, 0);
  });

  it("should skip empty groups in output", () => {
    const commits = [
      { labels: ["feat"], description: "add feature", breakingChange: false },
    ];
    const groups = groupByLabel(commits);
    assert.ok(!groups.has("🐛 Bug Fixes"));
    assert.ok(!groups.has("📦 Uncategorized"));
  });

  it("should resolve alias labels like kind/feature", () => {
    const commits = [
      { labels: ["kind/feature"], description: "new stuff", breakingChange: false },
    ];
    const groups = groupByLabel(commits);
    assert.ok(groups.has("🚀 Features"));
  });

  it("should resolve Chinese alias labels like 类型/新功能", () => {
    const commits = [
      { labels: ["类型/新功能"], description: "新东西", breakingChange: false },
    ];
    const groups = groupByLabel(commits);
    assert.ok(groups.has("🚀 Features"));
  });

  it("should resolve type: breaking alias to Breaking Changes", () => {
    const commits = [
      { labels: ["type: breaking"], description: "big change", breakingChange: false },
    ];
    const groups = groupByLabel(commits);
    assert.ok(groups.has("💥 Breaking Changes"));
  });

  it("should handle multiple labels on same commit", () => {
    const commits = [
      { labels: ["feat", "enhancement"], description: "add feature", breakingChange: false },
    ];
    const groups = groupByLabel(commits);
    assert.ok(groups.has("🚀 Features"));
    assert.equal(groups.get("🚀 Features").length, 1);
  });
});

describe("mergeLabels", () => {
  it("should merge two label arrays", () => {
    const result = mergeLabels(["feat"], ["bug"]);
    assert.deepEqual(result.sort(), ["feat", "bug"].sort());
  });

  it("should deduplicate labels", () => {
    const result = mergeLabels(["feat"], ["feat"]);
    assert.deepEqual(result, ["feat"]);
  });

  it("should handle empty arrays", () => {
    assert.deepEqual(mergeLabels([], []), []);
    assert.deepEqual(mergeLabels(["feat"], []), ["feat"]);
  });
});

describe("normalizeLabel", () => {
  it("should normalize alias labels", () => {
    assert.equal(normalizeLabel("kind/feature"), "feat");
    assert.equal(normalizeLabel("type: bug"), "fix");
  });

  it("should return lowercased label for non-alias", () => {
    assert.equal(normalizeLabel("Feature"), "feature");
    assert.equal(normalizeLabel("MyCustomLabel"), "mycustomlabel");
  });

  it("should handle Chinese alias", () => {
    assert.equal(normalizeLabel("类型/新功能"), "feat");
  });
});
