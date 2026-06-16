export const LABEL_MAP = {
  feat: "🚀 Features",
  feature: "🚀 Features",
  enhancement: "🚀 Features",
  "new feature": "🚀 Features",
  "新增": "🚀 Features",
  "新功能": "🚀 Features",
  "功能": "🚀 Features",

  fix: "🐛 Bug Fixes",
  bugfix: "🐛 Bug Fixes",
  bug: "🐛 Bug Fixes",
  hotfix: "🐛 Bug Fixes",
  "缺陷": "🐛 Bug Fixes",
  "修复": "🐛 Bug Fixes",
  "补丁": "🐛 Bug Fixes",

  docs: "📝 Documentation",
  documentation: "📝 Documentation",
  "文档": "📝 Documentation",

  refactor: "♻️ Refactoring",
  "code cleanup": "♻️ Refactoring",
  "重构": "♻️ Refactoring",

  perf: "⚡ Performance",
  performance: "⚡ Performance",
  "优化": "⚡ Performance",
  "性能": "⚡ Performance",

  test: "✅ Tests",
  tests: "✅ Tests",
  testing: "✅ Tests",
  "测试": "✅ Tests",

  chore: "🔧 Chore",
  ci: "🔧 Chore",
  build: "🔧 Chore",
  dependencies: "🔧 Chore",
  "dependency upgrade": "🔧 Chore",
  "杂项": "🔧 Chore",
  "维护": "🔧 Chore",
  "持续集成": "🔧 Chore",
  "构建": "🔧 Chore",
  "发布": "🔧 Chore",
  "部署": "🔧 Chore",

  style: "🎨 Style",
  formatting: "🎨 Style",
  "样式": "🎨 Style",
  "格式": "🎨 Style",

  breaking: "💥 Breaking Changes",
  "breaking-change": "💥 Breaking Changes",
  "breaking change": "💥 Breaking Changes",
};

export const LABEL_ALIASES = {
  "kind/feature": "feat",
  "kind/bug": "fix",
  "kind/breaking": "breaking",
  "kind/enhancement": "feat",
  "kind/documentation": "docs",
  "type: feature": "feat",
  "type: bug": "fix",
  "type: breaking": "breaking",
  "type: documentation": "docs",
  "type: enhancement": "feat",
  "优先级/高": "fix",
  "优先级/紧急": "fix",
  "类型/新功能": "feat",
  "类型/修复": "fix",
  "类型/文档": "docs",
  "类型/重构": "refactor",
  "类型/性能": "perf",
  "类型/测试": "test",
  "类型/破坏性变更": "breaking",
};

export const LABEL_ORDER = [
  "💥 Breaking Changes",
  "🚀 Features",
  "🐛 Bug Fixes",
  "♻️ Refactoring",
  "⚡ Performance",
  "📝 Documentation",
  "🎨 Style",
  "✅ Tests",
  "🔧 Chore",
  "📦 Uncategorized",
];

export const UNCATEGORIZED_LABEL = "📦 Uncategorized";

export const DEFAULT_OUTPUT = "RELEASE_NOTES.md";

export const CATEGORY_DESCRIPTIONS = {
  "💥 Breaking Changes": "Breaking changes that may require user action",
  "🚀 Features": "New features and enhancements",
  "🐛 Bug Fixes": "Bug fixes and patches",
  "♻️ Refactoring": "Code refactoring and cleanup",
  "⚡ Performance": "Performance improvements",
  "📝 Documentation": "Documentation updates",
  "🎨 Style": "Code style and formatting",
  "✅ Tests": "Test additions and updates",
  "🔧 Chore": "Build, CI, and maintenance tasks",
  "📦 Uncategorized": "Other changes",
};

export const TEMPLATES = {
  default: "default",
  "release-notes-yaml": "release-notes-yaml",
  keepachangelog: "keepachangelog",
};
