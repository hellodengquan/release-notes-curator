import { LABEL_MAP, LABEL_ORDER, UNCATEGORIZED_LABEL, getAllAliases } from "./config.js";

export function groupByLabel(commits) {
  const groups = new Map();

  for (const label of LABEL_ORDER) {
    groups.set(label, []);
  }

  for (const commit of commits) {
    let targetLabel;

    if (commit.breakingChange) {
      targetLabel = "💥 Breaking Changes";
      if (!commit.categoryRationale) {
        commit.categoryRationale = "commit flagged as breaking change";
      }
    } else {
      const resolved = resolveCategory(commit.labels);
      targetLabel = resolved.category;
      if (
        !commit.categoryRationale ||
        commit.categoryRationale === "no prefix matched → Uncategorized"
      ) {
        commit.categoryRationale = resolved.rationale;
      }
    }

    if (!groups.has(targetLabel)) {
      groups.set(targetLabel, []);
    }
    groups.get(targetLabel).push(commit);
  }

  const result = new Map();
  for (const [label, items] of groups) {
    if (items.length > 0) {
      result.set(label, items);
    }
  }

  return result;
}

export function resolveCategoryWithRationale(labels) {
  const allAliases = getAllAliases();

  if (!labels || labels.length === 0) {
    return { category: UNCATEGORIZED_LABEL, rationale: "no labels provided" };
  }

  for (const label of labels) {
    const normalized = label.toLowerCase().trim();
    if (LABEL_MAP[normalized]) {
      return {
        category: LABEL_MAP[normalized],
        rationale: `label "${label}" directly matched LABEL_MAP → ${LABEL_MAP[normalized]}`,
      };
    }
  }

  for (const label of labels) {
    const trimmed = label.trim();
    const alias = allAliases[trimmed.toLowerCase()] || allAliases[trimmed];
    if (alias && LABEL_MAP[alias]) {
      return {
        category: LABEL_MAP[alias],
        rationale: `label "${label}" matched alias → ${alias} → ${LABEL_MAP[alias]}`,
      };
    }
  }

  for (const label of labels) {
    const normalized = label.toLowerCase().trim();
    for (const [aliasPattern, mappedKey] of Object.entries(allAliases)) {
      if (
        normalized.includes(aliasPattern.toLowerCase()) ||
        aliasPattern.toLowerCase().includes(normalized)
      ) {
        if (LABEL_MAP[mappedKey]) {
          return {
            category: LABEL_MAP[mappedKey],
            rationale: `label "${label}" fuzzy matched alias "${aliasPattern}" → ${mappedKey} → ${LABEL_MAP[mappedKey]}`,
          };
        }
      }
    }
  }

  for (const label of labels) {
    const normalized = label.toLowerCase().trim();
    for (const [key, category] of Object.entries(LABEL_MAP)) {
      if (normalized.includes(key) || key.includes(normalized)) {
        return {
          category,
          rationale: `label "${label}" fuzzy matched LABEL_MAP key "${key}" → ${category}`,
        };
      }
    }
  }

  return {
    category: UNCATEGORIZED_LABEL,
    rationale: `no match for labels [${labels.join(", ")}] → ${UNCATEGORIZED_LABEL}`,
  };
}

function resolveCategory(labels) {
  return resolveCategoryWithRationale(labels);
}

export function mergeLabels(commitLabels, prLabels) {
  const all = new Set([...commitLabels, ...prLabels]);
  return [...all];
}

export function normalizeLabel(label) {
  const allAliases = getAllAliases();
  const trimmed = label.trim();
  const alias = allAliases[trimmed] || allAliases[trimmed.toLowerCase()];
  if (alias) return alias;
  return trimmed.toLowerCase();
}
