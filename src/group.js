import { LABEL_MAP, LABEL_ORDER, UNCATEGORIZED_LABEL } from "./config.js";

export function groupByLabel(commits) {
  const groups = new Map();

  for (const label of LABEL_ORDER) {
    groups.set(label, []);
  }

  for (const commit of commits) {
    const targetLabel = resolveCategory(commit.labels);

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

function resolveCategory(labels) {
  if (!labels || labels.length === 0) return UNCATEGORIZED_LABEL;

  for (const label of labels) {
    const normalized = label.toLowerCase().trim();
    if (LABEL_MAP[normalized]) {
      return LABEL_MAP[normalized];
    }
  }

  for (const label of labels) {
    const normalized = label.toLowerCase().trim();
    for (const [key, category] of Object.entries(LABEL_MAP)) {
      if (normalized.includes(key) || key.includes(normalized)) {
        return category;
      }
    }
  }

  return UNCATEGORIZED_LABEL;
}

export function mergeLabels(commitLabels, prLabels) {
  const all = new Set([...commitLabels, ...prLabels]);
  return [...all];
}
