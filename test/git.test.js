import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registerCustomPrefixes, CHINESE_PREFIX_MAP } from "../src/git.js";

describe("CHINESE_PREFIX_MAP", () => {
  it("should map common Chinese prefixes to conventional types", () => {
    assert.equal(CHINESE_PREFIX_MAP["新增"], "feat");
    assert.equal(CHINESE_PREFIX_MAP["新功能"], "feat");
    assert.equal(CHINESE_PREFIX_MAP["功能"], "feat");
    assert.equal(CHINESE_PREFIX_MAP["修复"], "fix");
    assert.equal(CHINESE_PREFIX_MAP["缺陷"], "fix");
    assert.equal(CHINESE_PREFIX_MAP["补丁"], "fix");
    assert.equal(CHINESE_PREFIX_MAP["文档"], "docs");
    assert.equal(CHINESE_PREFIX_MAP["重构"], "refactor");
    assert.equal(CHINESE_PREFIX_MAP["优化"], "perf");
    assert.equal(CHINESE_PREFIX_MAP["性能"], "perf");
    assert.equal(CHINESE_PREFIX_MAP["测试"], "test");
    assert.equal(CHINESE_PREFIX_MAP["样式"], "style");
    assert.equal(CHINESE_PREFIX_MAP["格式"], "style");
    assert.equal(CHINESE_PREFIX_MAP["构建"], "build");
    assert.equal(CHINESE_PREFIX_MAP["杂项"], "chore");
    assert.equal(CHINESE_PREFIX_MAP["持续集成"], "ci");
  });

  it("should have all entries map to valid conventional types", () => {
    const validTypes = new Set([
      "feat",
      "fix",
      "docs",
      "refactor",
      "perf",
      "test",
      "style",
      "build",
      "chore",
      "ci",
      "security",
      "yanked",
    ]);
    for (const [, type] of Object.entries(CHINESE_PREFIX_MAP)) {
      assert.ok(validTypes.has(type), `Unknown type: ${type}`);
    }
  });
});

describe("registerCustomPrefixes", () => {
  it("should not throw on valid input", () => {
    assert.doesNotThrow(() => {
      registerCustomPrefixes({ 修改: "feat", 改进: "feat" });
    });
  });

  it("should accept empty object", () => {
    assert.doesNotThrow(() => {
      registerCustomPrefixes({});
    });
  });

  it("should merge with existing custom prefixes", () => {
    registerCustomPrefixes({ 修改: "feat" });
    registerCustomPrefixes({ 新增: "fix" });
  });
});
