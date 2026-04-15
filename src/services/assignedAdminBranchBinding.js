function safeStr(value) {
  return String(value || "").trim();
}

export function normalizeSingleAssignedBranchIds(values) {
  const rows = Array.isArray(values) ? values : [values];
  const seen = new Set();
  const out = [];
  rows.forEach((value) => {
    const branchId = safeStr(value);
    const key = branchId.toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(branchId);
  });
  return out.length ? [out[0]] : [];
}

export function getSingleAssignedBranchId(values) {
  return normalizeSingleAssignedBranchIds(values)[0] || "";
}

