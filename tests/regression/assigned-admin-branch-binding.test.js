import assert from "node:assert/strict";
import test from "node:test";

import {
  getSingleAssignedBranchId,
  normalizeSingleAssignedBranchIds,
} from "../../src/services/assignedAdminBranchBinding.js";

test("normalizeSingleAssignedBranchIds keeps only first unique branch id", () => {
  assert.deepEqual(
    normalizeSingleAssignedBranchIds(["branch_a", "branch_b", "branch_c"]),
    ["branch_a"]
  );
});

test("normalizeSingleAssignedBranchIds de-dupes case-insensitively", () => {
  assert.deepEqual(
    normalizeSingleAssignedBranchIds(["BRANCH_X", "branch_x", "Branch_X"]),
    ["BRANCH_X"]
  );
});

test("normalizeSingleAssignedBranchIds returns empty when no valid id exists", () => {
  assert.deepEqual(normalizeSingleAssignedBranchIds(["", "   ", null]), []);
});

test("getSingleAssignedBranchId returns first selected branch id", () => {
  assert.equal(getSingleAssignedBranchId(["branch_1", "branch_2"]), "branch_1");
  assert.equal(getSingleAssignedBranchId([]), "");
});

