import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

let _apiRetryCount = 3;
let _apiRetryDelayMs = 1000;
let _apiFallbackConfig = null;

let _cache = {
  aliases: null,
  fetchedAt: 0,
  ttlMs: 5 * 60 * 1000,
  staleWhileRevalidateMs: 60 * 60 * 1000,
};

export function setTeamAliasCacheConfig({ ttlMs, staleWhileRevalidateMs }) {
  if (typeof ttlMs === "number") _cache.ttlMs = ttlMs;
  if (typeof staleWhileRevalidateMs === "number") _cache.staleWhileRevalidateMs = staleWhileRevalidateMs;
}

export function getCachedTeamAliases() {
  const now = Date.now();
  if (!_cache.aliases) return { data: null, stale: false, expired: true };
  const age = now - _cache.fetchedAt;
  const expired = age > _cache.ttlMs;
  const stale = age > _cache.ttlMs + _cache.staleWhileRevalidateMs;
  return {
    data: _cache.aliases,
    fetchedAt: _cache.fetchedAt,
    age,
    ttlMs: _cache.ttlMs,
    expired,
    stale,
  };
}

export function clearTeamAliasCache() {
  _cache.aliases = null;
  _cache.fetchedAt = 0;
}

export function setApiRetryConfig({ maxRetries, retryDelayMs, fallbackConfig }) {
  if (typeof maxRetries === "number") _apiRetryCount = maxRetries;
  if (typeof retryDelayMs === "number") _apiRetryDelayMs = retryDelayMs;
  if (fallbackConfig) _apiFallbackConfig = fallbackConfig;
}

export async function loadTeamConfigFromApi(apiUrl, options = {}) {
  const { token, maxRetries, retryDelayMs, useCache = true } = options;
  const retries = typeof maxRetries === "number" ? maxRetries : _apiRetryCount;
  const delay = typeof retryDelayMs === "number" ? retryDelayMs : _apiRetryDelayMs;

  if (useCache) {
    const cached = getCachedTeamAliases();
    if (cached.data && !cached.expired) {
      registerTeamAliases(cached.data);
      return {
        success: true,
        source: "cache",
        aliases: cached.data,
        cached: true,
        age: cached.age,
      };
    }
  }

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const headers = {
        Accept: "application/json",
        "User-Agent": "release-notes-curator",
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(apiUrl, { headers, signal: AbortSignal.timeout(5000 + attempt * 2000) });

      if (res.status === 403 || res.status === 429) {
        const retryAfter = res.headers.get("Retry-After") || res.headers.get("retry-after");
        const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : delay * Math.pow(2, attempt);
        lastError = new Error(`Rate limited (${res.status}), retry after ${waitMs}ms`);
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, Math.min(waitMs, 30000)));
          continue;
        }
        break;
      }

      if (!res.ok) {
        lastError = new Error(`API returned ${res.status}`);
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, delay * Math.pow(2, attempt)));
          continue;
        }
        break;
      }

      const cfg = await res.json();
      const aliases = cfg.labelAliases || {};
      if (cfg.labelAliases) {
        registerTeamAliases(cfg.labelAliases);
      }

      _cache.aliases = aliases;
      _cache.fetchedAt = Date.now();

      return { success: true, source: "api", aliases, cached: false };
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, delay * Math.pow(2, attempt)));
        continue;
      }
    }
  }

  if (useCache) {
    const cached = getCachedTeamAliases();
    if (cached.data && !cached.stale) {
      registerTeamAliases(cached.data);
      return {
        success: true,
        source: "cache-stale",
        aliases: cached.data,
        cached: true,
        age: cached.age,
        warning: `API failed (${lastError ? lastError.message : "unknown"}), using stale cache`,
      };
    }
  }

  if (_apiFallbackConfig && _apiFallbackConfig.labelAliases) {
    registerTeamAliases(_apiFallbackConfig.labelAliases);
    return {
      success: true,
      source: "fallback",
      aliases: _apiFallbackConfig.labelAliases,
      warning: `API failed (${lastError ? lastError.message : "unknown"}), using fallback config`,
    };
  }

  return {
    success: false,
    source: "none",
    aliases: {},
    error: lastError ? lastError.message : "Max retries exceeded",
  };
}

export const LABEL_MAP = {
  feat: "🚀 Features",
  feature: "🚀 Features",
  enhancement: "🚀 Features",
  "new feature": "🚀 Features",
  新增: "🚀 Features",
  新功能: "🚀 Features",
  功能: "🚀 Features",

  fix: "🐛 Bug Fixes",
  bugfix: "🐛 Bug Fixes",
  bug: "🐛 Bug Fixes",
  hotfix: "🐛 Bug Fixes",
  缺陷: "🐛 Bug Fixes",
  修复: "🐛 Bug Fixes",
  补丁: "🐛 Bug Fixes",

  docs: "📝 Documentation",
  documentation: "📝 Documentation",
  文档: "📝 Documentation",

  refactor: "♻️ Refactoring",
  "code cleanup": "♻️ Refactoring",
  重构: "♻️ Refactoring",

  perf: "⚡ Performance",
  performance: "⚡ Performance",
  优化: "⚡ Performance",
  性能: "⚡ Performance",

  test: "✅ Tests",
  tests: "✅ Tests",
  testing: "✅ Tests",
  测试: "✅ Tests",

  chore: "🔧 Chore",
  ci: "🔧 Chore",
  build: "🔧 Chore",
  dependencies: "🔧 Chore",
  "dependency upgrade": "🔧 Chore",
  杂项: "🔧 Chore",
  维护: "🔧 Chore",
  持续集成: "🔧 Chore",
  构建: "🔧 Chore",
  发布: "🔧 Chore",
  部署: "🔧 Chore",

  style: "🎨 Style",
  formatting: "🎨 Style",
  样式: "🎨 Style",
  格式: "🎨 Style",

  breaking: "💥 Breaking Changes",
  "breaking-change": "💥 Breaking Changes",
  "breaking change": "💥 Breaking Changes",

  security: "🔒 Security",
  安全修复: "🔒 Security",
  安全: "🔒 Security",
  cve: "🔒 Security",
  vulnerability: "🔒 Security",

  yanked: "📌 Yanked",
  撤回: "📌 Yanked",
  回退: "📌 Yanked",
  revert: "📌 Yanked",
  rollback: "📌 Yanked",
};

export const LABEL_ALIASES = {
  "kind/feature": "feat",
  "kind/bug": "fix",
  "kind/breaking": "breaking",
  "kind/enhancement": "feat",
  "kind/documentation": "docs",
  "kind/security": "security",
  "type: feature": "feat",
  "type: bug": "fix",
  "type: breaking": "breaking",
  "type: documentation": "docs",
  "type: enhancement": "feat",
  "type: security": "security",
  "优先级/高": "fix",
  "优先级/紧急": "fix",
  "类型/新功能": "feat",
  "类型/修复": "fix",
  "类型/文档": "docs",
  "类型/重构": "refactor",
  "类型/性能": "perf",
  "类型/测试": "test",
  "类型/破坏性变更": "breaking",
  "类型/安全": "security",
  "类型/撤回": "yanked",
};

let _teamAliases = {};

export function registerTeamAliases(aliases) {
  _teamAliases = { ..._teamAliases, ...aliases };
}

export function loadTeamConfig(configPath) {
  try {
    if (!existsSync(configPath)) return;
    const raw = readFileSync(configPath, "utf-8");
    const cfg = JSON.parse(raw);
    if (cfg.labelAliases) {
      registerTeamAliases(cfg.labelAliases);
    }
  } catch {
    /* ignore */
  }
}

export function getAllAliases() {
  return { ...LABEL_ALIASES, ..._teamAliases };
}

export const LABEL_ORDER = [
  "💥 Breaking Changes",
  "🚀 Features",
  "🐛 Bug Fixes",
  "🔒 Security",
  "♻️ Refactoring",
  "⚡ Performance",
  "📝 Documentation",
  "🎨 Style",
  "✅ Tests",
  "🔧 Chore",
  "📌 Yanked",
  "📦 Uncategorized",
];

export const UNCATEGORIZED_LABEL = "📦 Uncategorized";

export const DEFAULT_OUTPUT = "RELEASE_NOTES.md";

export const CATEGORY_DESCRIPTIONS = {
  "💥 Breaking Changes": "Breaking changes that may require user action",
  "🚀 Features": "New features and enhancements",
  "🐛 Bug Fixes": "Bug fixes and patches",
  "🔒 Security": "Security-related fixes and patches",
  "♻️ Refactoring": "Code refactoring and cleanup",
  "⚡ Performance": "Performance improvements",
  "📝 Documentation": "Documentation updates",
  "🎨 Style": "Code style and formatting",
  "✅ Tests": "Test additions and updates",
  "🔧 Chore": "Build, CI, and maintenance tasks",
  "📌 Yanked": "Reverted or withdrawn changes",
  "📦 Uncategorized": "Other changes",
};

export const TEMPLATES = {
  default: "default",
  "release-notes-yaml": "release-notes-yaml",
  keepachangelog: "keepachangelog",
};

export function loadSubpackageEslintConfigs(workspacePaths, repoRoot) {
  const root = repoRoot || process.cwd();
  const configs = {};

  const rootEslintPaths = [
    join(root, ".eslintrc.js"),
    join(root, ".eslintrc.cjs"),
    join(root, ".eslintrc.json"),
    join(root, ".eslintrc.yaml"),
    join(root, ".eslintrc.yml"),
    join(root, "package.json"),
  ];

  let rootEslintConfig = null;
  let rootHasTypeAwareRules = false;

  for (const cfgPath of rootEslintPaths) {
    if (existsSync(cfgPath)) {
      try {
        if (cfgPath.endsWith("package.json")) {
          const pkg = JSON.parse(readFileSync(cfgPath, "utf-8"));
          if (pkg.eslintConfig || pkg.eslint) {
            rootEslintConfig = pkg.eslintConfig || pkg.eslint;
          }
        } else {
          const raw = readFileSync(cfgPath, "utf-8");
          if (cfgPath.endsWith(".json")) {
            rootEslintConfig = JSON.parse(raw);
          } else {
            rootEslintConfig = { raw, format: cfgPath.split(".").pop() };
          }
        }
        if (rootEslintConfig) {
          rootHasTypeAwareRules = detectTypeAwareRules(rootEslintConfig);
          break;
        }
      } catch {
        /* ignore */
      }
    }
  }

  for (const wsPath of workspacePaths) {
    const fullPath = join(root, wsPath);
    const eslintPaths = [
      join(fullPath, ".eslintrc.js"),
      join(fullPath, ".eslintrc.cjs"),
      join(fullPath, ".eslintrc.json"),
      join(fullPath, ".eslintrc.yaml"),
      join(fullPath, ".eslintrc.yml"),
      join(fullPath, "package.json"),
    ];
    for (const cfgPath of eslintPaths) {
      if (existsSync(cfgPath)) {
        try {
          let parsed = null;
          let source = "";
          if (cfgPath.endsWith("package.json")) {
            const pkg = JSON.parse(readFileSync(cfgPath, "utf-8"));
            if (pkg.eslintConfig || pkg.eslint) {
              parsed = pkg.eslintConfig || pkg.eslint;
              source = "package.json";
            }
          } else {
            const raw = readFileSync(cfgPath, "utf-8");
            source = cfgPath.replace(root, "").replace(/^\//, "");
            if (cfgPath.endsWith(".json")) {
              parsed = JSON.parse(raw);
            } else {
              parsed = { raw, format: cfgPath.split(".").pop() };
            }
          }
          if (parsed) {
            const hasTypeAware = detectTypeAwareRules(parsed);
            configs[wsPath] = {
              source,
              config: parsed,
              hasTypeAwareRules: hasTypeAware,
              inheritsRootTypeAware: !hasTypeAware && rootHasTypeAwareRules,
              rootTypeAwareRules: rootHasTypeAwareRules ? extractTypeAwareRules(rootEslintConfig) : null,
            };
            break;
          }
        } catch {
          /* ignore parse errors */
        }
      }
    }
    if (!configs[wsPath] && rootEslintConfig) {
      configs[wsPath] = {
        source: "root",
        config: rootEslintConfig,
        hasTypeAwareRules: rootHasTypeAwareRules,
        inheritsRootTypeAware: true,
        rootTypeAwareRules: rootHasTypeAwareRules ? extractTypeAwareRules(rootEslintConfig) : null,
      };
    }
  }
  return configs;
}

function detectTypeAwareRules(config) {
  if (!config) return false;
  if (config.parser && config.parser.includes("@typescript-eslint/parser")) {
    if (config.parserOptions && config.parserOptions.project) {
      return true;
    }
  }
  if (config.rules) {
    for (const rule of Object.keys(config.rules)) {
      if (rule.startsWith("@typescript-eslint/")) {
        const typeAwareRulePatterns = [
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
        if (typeAwareRulePatterns.some((p) => rule.endsWith(p))) {
          return true;
        }
      }
    }
  }
  if (config.extends) {
    const extendsArr = Array.isArray(config.extends) ? config.extends : [config.extends];
    for (const ext of extendsArr) {
      if (ext.includes("recommended-requiring-type-checking") || ext.includes("strict-type-checked")) {
        return true;
      }
    }
  }
  return false;
}

function extractTypeAwareRules(config) {
  if (!config || !config.rules) return null;
  const typeAwareRules = {};
  for (const [rule, value] of Object.entries(config.rules)) {
    if (rule.startsWith("@typescript-eslint/")) {
      const typeAwareRulePatterns = [
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
      if (typeAwareRulePatterns.some((p) => rule.endsWith(p))) {
        typeAwareRules[rule] = value;
      }
    }
  }
  return Object.keys(typeAwareRules).length > 0 ? typeAwareRules : null;
}

export function getEslintConfigForPackage(packageName, workspaceEslintConfigs) {
  const exact = Object.entries(workspaceEslintConfigs).find(([p]) =>
    p.endsWith(packageName) || p === packageName || p.includes(`/${packageName}/`),
  );
  return exact ? exact[1] : null;
}
