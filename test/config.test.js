import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LABEL_MAP,
  LABEL_ALIASES,
  LABEL_ORDER,
  UNCATEGORIZED_LABEL,
  CATEGORY_DESCRIPTIONS,
  TEMPLATES,
} from "../src/config.js";

describe("LABEL_MAP", () => {
  it("should contain English conventional commit prefixes", () => {
    assert.equal(LABEL_MAP["feat"], "🚀 Features");
    assert.equal(LABEL_MAP["fix"], "🐛 Bug Fixes");
    assert.equal(LABEL_MAP["docs"], "📝 Documentation");
    assert.equal(LABEL_MAP["refactor"], "♻️ Refactoring");
    assert.equal(LABEL_MAP["perf"], "⚡ Performance");
    assert.equal(LABEL_MAP["test"], "✅ Tests");
    assert.equal(LABEL_MAP["chore"], "🔧 Chore");
    assert.equal(LABEL_MAP["style"], "🎨 Style");
  });

  it("should contain Chinese prefix mappings", () => {
    assert.equal(LABEL_MAP["新增"], "🚀 Features");
    assert.equal(LABEL_MAP["修复"], "🐛 Bug Fixes");
    assert.equal(LABEL_MAP["文档"], "📝 Documentation");
    assert.equal(LABEL_MAP["重构"], "♻️ Refactoring");
    assert.equal(LABEL_MAP["优化"], "⚡ Performance");
    assert.equal(LABEL_MAP["测试"], "✅ Tests");
    assert.equal(LABEL_MAP["杂项"], "🔧 Chore");
    assert.equal(LABEL_MAP["样式"], "🎨 Style");
  });

  it("should contain breaking change mappings", () => {
    assert.equal(LABEL_MAP["breaking"], "💥 Breaking Changes");
    assert.equal(LABEL_MAP["breaking-change"], "💥 Breaking Changes");
    assert.equal(LABEL_MAP["breaking change"], "💥 Breaking Changes");
  });

  it("should have all values be in LABEL_ORDER", () => {
    const categories = new Set(Object.values(LABEL_MAP));
    for (const cat of categories) {
      assert.ok(LABEL_ORDER.includes(cat), `Missing from LABEL_ORDER: ${cat}`);
    }
  });
});

describe("LABEL_ALIASES", () => {
  it("should contain common GitHub label formats", () => {
    assert.equal(LABEL_ALIASES["kind/feature"], "feat");
    assert.equal(LABEL_ALIASES["kind/bug"], "fix");
    assert.equal(LABEL_ALIASES["type: feature"], "feat");
    assert.equal(LABEL_ALIASES["type: bug"], "fix");
  });

  it("should contain Chinese alias labels", () => {
    assert.equal(LABEL_ALIASES["类型/新功能"], "feat");
    assert.equal(LABEL_ALIASES["类型/修复"], "fix");
    assert.equal(LABEL_ALIASES["类型/破坏性变更"], "breaking");
  });

  it("should map all aliases to valid LABEL_MAP keys", () => {
    for (const [, key] of Object.entries(LABEL_ALIASES)) {
      assert.ok(LABEL_MAP[key], `Alias maps to unknown key: ${key}`);
    }
  });
});

describe("LABEL_ORDER", () => {
  it("should have Breaking Changes first", () => {
    assert.equal(LABEL_ORDER[0], "💥 Breaking Changes");
  });

  it("should have Uncategorized last", () => {
    assert.equal(LABEL_ORDER[LABEL_ORDER.length - 1], "📦 Uncategorized");
  });

  it("should not have duplicates", () => {
    const set = new Set(LABEL_ORDER);
    assert.equal(set.size, LABEL_ORDER.length);
  });
});

describe("CATEGORY_DESCRIPTIONS", () => {
  it("should have description for every category in LABEL_ORDER", () => {
    for (const cat of LABEL_ORDER) {
      assert.ok(CATEGORY_DESCRIPTIONS[cat], `Missing description for: ${cat}`);
    }
  });
});

describe("TEMPLATES", () => {
  it("should have default template", () => {
    assert.ok(TEMPLATES["default"]);
  });

  it("should have keepachangelog template", () => {
    assert.ok(TEMPLATES["keepachangelog"]);
  });

  it("should have release-notes-yaml template", () => {
    assert.ok(TEMPLATES["release-notes-yaml"]);
  });
});
