import { useEffect, useState } from "react";
import { ArrowLeft, ChevronDown, Save, ShieldOff } from "lucide-react";
import { useNavigate } from "react-router-dom";

import AppIcon from "../components/AppIcon";
import { ICON_MD, ICON_SM } from "../constants/iconSizes";
import {
  getNearbyCountySuggestions,
  normalizeCountyList,
} from "../constants/kenyaCounties";
import { getCurrentUserRoleContext } from "../services/adminroleservice";
import {
  normalizeSingleAssignedBranchIds,
} from "../services/assignedAdminBranchBinding";
import {
  listAssignedAdmins,
  setAssignedAdminByEmail,
} from "../services/assignedadminservice";
import {
  deriveOperationalBranchCoverage,
  listPartners,
} from "../services/partnershipService";
import { smartBack } from "../utils/navBack";

function safeStr(value) {
  return String(value || "").trim();
}

function toBoundedInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function normalizeCountryOptions(values = []) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => safeStr(value))
    .filter((value) => {
      const key = value.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.localeCompare(b));
}

function makeDraft(row) {
  const scope = row?.adminScope || {};
  const maxActiveRaw = Number(scope?.maxActiveRequests);
  const selectedBranchIds = normalizeSingleAssignedBranchIds(
    Array.isArray(scope?.assignedBranchIds)
      ? scope.assignedBranchIds.map((value) => safeStr(value)).filter(Boolean)
      : [safeStr(scope?.assignedBranchId)]
  );
  return {
    partnerId: safeStr(scope?.partnerId),
    selectedBranchIds,
    availability: safeStr(scope?.availability || "active").toLowerCase() || "active",
    stationedCountry: safeStr(scope?.stationedCountry || scope?.country),
    town: safeStr(scope?.town),
    primaryCounty: safeStr(scope?.primaryCounty || scope?.counties?.[0]),
    neighboringCounties: normalizeCountyList(
      scope?.neighboringCounties ||
        normalizeCountyList(scope?.counties || []).filter(
          (county) => county !== safeStr(scope?.primaryCounty || scope?.counties?.[0])
        )
    ),
    branchSearch: "",
    countySearch: "",
    maxActiveRequests:
      Number.isFinite(maxActiveRaw) && maxActiveRaw > 0
        ? toBoundedInt(maxActiveRaw, 0, 1, 120)
        : "",
  };
}

export default function AdminManageAdminsScreen() {
  const navigate = useNavigate();

  const [checkingRole, setCheckingRole] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const [rows, setRows] = useState([]);
  const [partners, setPartners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const [expandedUid, setExpandedUid] = useState("");
  const [draftByUid, setDraftByUid] = useState({});
  const [countyOpenByUid, setCountyOpenByUid] = useState({});
  const [actionBusy, setActionBusy] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ctx = await getCurrentUserRoleContext();
        if (cancelled) return;
        setIsSuperAdmin(Boolean(ctx?.isSuperAdmin));
      } catch (error) {
        if (cancelled) return;
        console.error(error);
        setIsSuperAdmin(false);
      } finally {
        if (!cancelled) setCheckingRole(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadRows = async () => {
    setLoading(true);
    setErr("");
    try {
      const list = await listAssignedAdmins({ max: 250 });
      const clean = Array.isArray(list) ? list : [];
      setRows(clean);
      setDraftByUid((prev) => {
        const next = { ...(prev || {}) };
        clean.forEach((row) => {
          const uid = safeStr(row?.uid);
          if (!uid || next[uid]) return;
          next[uid] = makeDraft(row);
        });
        return next;
      });
    } catch (error) {
      console.error(error);
      setRows([]);
      setErr(error?.message || "Failed to load assigned admins.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isSuperAdmin) return;
    void loadRows();
  }, [isSuperAdmin]);

  useEffect(() => {
    if (!isSuperAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await listPartners({ max: 250 });
        if (!cancelled) setPartners(Array.isArray(list) ? list : []);
      } catch (error) {
        if (!cancelled) {
          console.error(error);
          setPartners([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin]);

  const setDraft = (uid, patch) => {
    setDraftByUid((prev) => ({
      ...(prev || {}),
      [uid]: {
        ...(prev?.[uid] || {}),
        ...(patch || {}),
      },
    }));
  };

  const toggleCounty = (uid, countyName) => {
    const draft = draftByUid?.[uid] || {};
    const selected = normalizeCountyList(draft?.neighboringCounties || []).filter(
      (county) => county !== safeStr(draft?.primaryCounty)
    );
    if (selected.includes(countyName)) {
      setDraft(uid, {
        neighboringCounties: selected.filter((county) => county !== countyName),
      });
      return;
    }
    setDraft(uid, {
      neighboringCounties: normalizeCountyList([...selected, countyName]).filter(
        (county) => county !== safeStr(draft?.primaryCounty)
      ),
    });
  };

  const toggleExpand = (row) => {
    const uid = safeStr(row?.uid);
    if (!uid) return;
    if (expandedUid === uid) {
      setExpandedUid("");
      setCountyOpenByUid((prev) => ({ ...(prev || {}), [uid]: false }));
      return;
    }
    setExpandedUid(uid);
    if (!draftByUid?.[uid]) {
      setDraft(uid, makeDraft(row));
    }
  };

  const toggleCountyDropdown = (uid) => {
    setCountyOpenByUid((prev) => ({
      ...(prev || {}),
      [uid]: !prev?.[uid],
    }));
  };

  const runRevoke = async () => {
    const target = confirmRevoke;
    if (!target) return;
    const uid = safeStr(target?.uid);
    const email = safeStr(target?.email).toLowerCase();
    if (!email) {
      setConfirmRevoke(null);
      setErr("Missing admin email. Cannot revoke.");
      return;
    }

    setActionBusy(`revoke:${uid}`);
    setErr("");
    setMsg("");
    try {
      await setAssignedAdminByEmail({
        email,
        action: "remove",
      });
      setMsg(`Revoked admin: ${email}`);
      setConfirmRevoke(null);
      if (expandedUid === uid) setExpandedUid("");
      await loadRows();
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to revoke admin.");
    } finally {
      setActionBusy("");
    }
  };

  const runUpdate = async (row) => {
    const uid = safeStr(row?.uid);
    const email = safeStr(row?.email).toLowerCase();
    const draft = draftByUid?.[uid] || makeDraft(row);
    const stationedCountry = safeStr(draft?.stationedCountry || draft?.country);
    const isKenyaScope = stationedCountry.toLowerCase() === "kenya";
    const selectedPartner =
      partners.find((partner) => safeStr(partner?.id) === safeStr(draft?.partnerId)) || null;
    const partnerBranchOptions = (Array.isArray(selectedPartner?.branches) ? selectedPartner.branches : [])
      .filter((branch) => branch?.active !== false && branch?.isActive !== false)
      .map((branch) => ({
        branchId: safeStr(branch?.branchId || branch?.id),
        primaryCounty: safeStr(branch?.primaryCounty || branch?.county),
      }))
      .filter((branch) => branch.branchId);
    const requestedBranchIds = normalizeSingleAssignedBranchIds(
      Array.isArray(draft?.selectedBranchIds)
        ? draft.selectedBranchIds.map((value) => safeStr(value)).filter(Boolean)
        : draft?.selectedBranchIds
    );
    const selectedBranchRows = partnerBranchOptions.filter((branch) =>
      requestedBranchIds.some(
        (value) => safeStr(value).toLowerCase() === safeStr(branch.branchId).toLowerCase()
      )
    );
    const branchCoverage = deriveOperationalBranchCoverage(selectedBranchRows, { activeOnly: true });
    const hasBranchSelection = selectedBranchRows.length > 0;
    if (!hasBranchSelection) {
      setErr("Select one branch. Assigned admins are bound to a single branch.");
      return;
    }
    const branchPrimaryCounty = safeStr(
      selectedBranchRows.find((branch) => safeStr(branch?.primaryCounty))?.primaryCounty ||
      normalizeCountyList(branchCoverage?.coverageCounties || [])[0] ||
      ""
    );
    const primaryCounty = branchPrimaryCounty;
    if (!email) {
      setErr("Missing admin email.");
      return;
    }
    if (!safeStr(draft?.partnerId)) {
      setErr("Select a partner.");
      return;
    }
    if (!stationedCountry) {
      setErr("Select a stationed country.");
      return;
    }
    if (isKenyaScope && !primaryCounty) {
      setErr("Selected branches do not provide county coverage.");
      return;
    }
    const maxActive = toBoundedInt(draft?.maxActiveRequests, 0, 1, 120);
    if (maxActive <= 0) {
      setErr("Enter max requests.");
      return;
    }

    setActionBusy(`update:${uid}`);
    setErr("");
    setMsg("");
    try {
      await setAssignedAdminByEmail({
        email,
        action: "upsert",
        partnerId: safeStr(draft?.partnerId),
        stationedCountry,
        selectedBranchIds: requestedBranchIds,
        town: safeStr(draft?.town),
        availability: safeStr(draft?.availability || "active").toLowerCase() || "active",
        maxActiveRequests: maxActive,
      });
      setMsg(`Updated admin: ${email}`);
      await loadRows();
      setExpandedUid("");
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to update admin.");
    } finally {
      setActionBusy("");
    }
  };

  const pageBg =
    "min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";
  const card =
    "rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 shadow-sm backdrop-blur";
  const label = "text-[11px] font-semibold text-zinc-600 dark:text-zinc-300";
  const input =
    "w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/60 dark:border-zinc-700 dark:bg-zinc-900/50 dark:focus:ring-emerald-500/10";

  return (
    <div className={pageBg}>
      <div className="max-w-xl mx-auto px-5 py-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Manage Admins
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Review assigned admins and update their coverage settings.
            </p>
          </div>

          <button
            type="button"
            onClick={() => smartBack(navigate, "/app/admin")}
            className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3.5 py-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99]"
          >
            <AppIcon icon={ArrowLeft} size={ICON_MD} />
            Back
          </button>
        </div>

        {checkingRole ? (
          <div className={`mt-5 ${card} p-4 text-sm text-zinc-600 dark:text-zinc-300`}>
            Checking access...
          </div>
        ) : !isSuperAdmin ? (
          <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
            Only Super Admin can manage assigned admins.
          </div>
        ) : (
          <>
            {err ? (
              <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
                {err}
              </div>
            ) : null}

            {msg ? (
              <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                {msg}
              </div>
            ) : null}

            {loading ? (
              <div className={`mt-5 ${card} p-4 text-sm text-zinc-600 dark:text-zinc-300`}>
                Loading admins...
              </div>
            ) : rows.length === 0 ? (
              <div className={`mt-5 ${card} p-4 text-sm text-zinc-600 dark:text-zinc-300`}>
                No assigned admins found.
              </div>
            ) : (
              <div className="mt-5 grid gap-3">
                {rows.map((row) => {
                  const uid = safeStr(row?.uid);
                  const email = safeStr(row?.email || uid).toLowerCase();
                  const isExpanded = expandedUid === uid;
                  const draft = draftByUid?.[uid] || makeDraft(row);
                  const scope = row?.adminScope || {};
                  const partnerName =
                    partners.find((partner) => partner.id === safeStr(scope?.partnerId))?.displayName ||
                    safeStr(scope?.partnerName) ||
                    "No partner";
                  const selectedPartner =
                    partners.find((partner) => partner.id === safeStr(draft?.partnerId)) || null;
                  const stationedCountry = safeStr(draft?.stationedCountry || draft?.country);
                  const isKenyaScope = stationedCountry.toLowerCase() === "kenya";
                  const partnerBranchOptions = (Array.isArray(selectedPartner?.branches)
                    ? selectedPartner.branches
                    : []
                  )
                    .filter((branch) => branch?.active !== false && branch?.isActive !== false)
                    .map((branch) => ({
                      branchId: safeStr(branch?.branchId || branch?.id),
                      branchName: safeStr(branch?.branchName || branch?.name),
                      primaryCounty: safeStr(branch?.primaryCounty || branch?.county),
                      neighboringCounties: normalizeCountyList(branch?.neighboringCounties || []),
                      coverageCounties: normalizeCountyList(branch?.coverageCounties || []),
                    }))
                    .filter((branch) => branch.branchId && branch.branchName);
                  const filteredBranchOptions = partnerBranchOptions.filter((branch) =>
                    [
                      branch.branchName,
                      branch.primaryCounty,
                      ...(branch.neighboringCounties || []),
                    ]
                      .filter(Boolean)
                      .join(" ")
                      .toLowerCase()
                      .includes(safeStr(draft?.branchSearch).toLowerCase())
                  );
                  const selectedBranchRows = partnerBranchOptions.filter((branch) =>
                    (draft?.selectedBranchIds || []).some(
                      (value) => safeStr(value).toLowerCase() === safeStr(branch.branchId).toLowerCase()
                    )
                  );
                  const branchCoverage = deriveOperationalBranchCoverage(selectedBranchRows, { activeOnly: true });
                  const hasBranchSelection = selectedBranchRows.length > 0;
                  const autoPrimaryCounty = safeStr(
                    selectedBranchRows.find((branch) => safeStr(branch?.primaryCounty))?.primaryCounty ||
                    normalizeCountyList(branchCoverage?.coverageCounties || [])[0] ||
                    ""
                  );
                  const autoNeighboringCounties = normalizeCountyList(branchCoverage?.coverageCounties || []).filter(
                    (county) => county !== autoPrimaryCounty
                  );
                  const partnerStationedCountryOptions = selectedPartner?.isActive === false
                    ? []
                    : normalizeCountryOptions(selectedPartner?.homeCountries || []);
                  const partnerCountyOptions =
                    selectedPartner?.isActive === false
                      ? []
                      : normalizeCountyList(selectedPartner?.supportedCounties || []);
                  const countyFieldsEnabled =
                    Boolean(selectedPartner?.id) && isKenyaScope && partnerCountyOptions.length > 0;
                  const manualCountyFieldsEnabled = countyFieldsEnabled && !hasBranchSelection;
                  const neighboringFieldsEnabled =
                    manualCountyFieldsEnabled &&
                    Boolean(safeStr(draft?.primaryCounty)) &&
                    partnerCountyOptions.length > 1;
                  const filteredCounties = partnerCountyOptions.filter((county) =>
                    county !== safeStr(draft?.primaryCounty) &&
                    county.toLowerCase().includes(safeStr(draft?.countySearch).toLowerCase())
                  );
                  const recommendations = getNearbyCountySuggestions(
                    draft?.primaryCounty,
                    draft?.neighboringCounties
                  )
                    .filter((county) => partnerCountyOptions.includes(county))
                    .slice(0, 8);
                  const countyOpen = Boolean(countyOpenByUid?.[uid]);
                  const revokeBusy = actionBusy === `revoke:${uid}`;
                  const updateBusy = actionBusy === `update:${uid}`;

                  return (
                    <div key={uid} className={card}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleExpand(row)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          toggleExpand(row);
                        }}
                        className="w-full cursor-pointer px-4 py-3 text-left transition active:scale-[0.99]"
                      >
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                              {email}
                            </div>
                            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                              {partnerName}
                              {stationedCountry ? ` • ${stationedCountry}` : ""}
                              {safeStr(scope?.primaryCounty) ? ` • ${safeStr(scope?.primaryCounty)}` : ""}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setConfirmRevoke(row);
                            }}
                            disabled={revokeBusy}
                            className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50/80 px-2.5 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 active:scale-[0.99] disabled:opacity-60 dark:border-rose-900/40 dark:bg-rose-950/25 dark:text-rose-200 dark:hover:bg-rose-950/35"
                          >
                            <AppIcon icon={ShieldOff} size={ICON_SM} />
                            {revokeBusy ? "Revoking..." : "Revoke"}
                          </button>

                          <span className={`text-zinc-500 transition ${isExpanded ? "rotate-180" : ""}`}>
                            <AppIcon icon={ChevronDown} size={ICON_SM} />
                          </span>
                        </div>
                      </div>

                      {isExpanded ? (
                        <div className="border-t border-zinc-200 dark:border-zinc-800 px-4 pb-4 pt-3">
                          <div className="grid gap-3">
                            <div className="grid gap-1.5">
                              <div className={label}>Partner</div>
                              <select
                                className={input}
                                value={draft?.partnerId || ""}
                                onChange={(event) => {
                                  setDraft(uid, {
                                    partnerId: event.target.value,
                                    selectedBranchIds: [],
                                    branchSearch: "",
                                    stationedCountry: "",
                                    primaryCounty: "",
                                    neighboringCounties: [],
                                    countySearch: "",
                                  });
                                  setCountyOpenByUid((prev) => ({ ...(prev || {}), [uid]: false }));
                                }}
                              >
                                <option value="">Select partner</option>
                                {partners.map((partner) => (
                                  <option key={partner.id} value={partner.id}>
                                    {partner.displayName}
                                    {partner.isActive === false ? " (Inactive)" : ""}
                                  </option>
                                ))}
                              </select>
                              {!draft?.partnerId ? (
                                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                  Select a partner first. Stationed country and county fields unlock from that partner.
                                </div>
                              ) : !selectedPartner ? (
                                <div className="text-xs text-amber-700 dark:text-amber-200">
                                  Choose an active partner before editing counties.
                                </div>
                              ) : partnerStationedCountryOptions.length === 0 ? (
                                <div className="text-xs text-amber-700 dark:text-amber-200">
                                  This partner has no home-country coverage yet. Add home countries in SACC Partnerships first.
                                </div>
                              ) : isKenyaScope && partnerCountyOptions.length === 0 ? (
                                <div className="text-xs text-amber-700 dark:text-amber-200">
                                  This partner has no county coverage yet. Add counties in SACC Partnerships first.
                                </div>
                              ) : null}
                            </div>

                            <div className="grid gap-1.5">
                              <div className={label}>Assigned Branch (Routing + Finance)</div>
                              <input
                                className={input}
                                value={draft?.branchSearch || ""}
                                onChange={(event) => setDraft(uid, { branchSearch: event.target.value })}
                                placeholder={!selectedPartner ? "Select partner first" : "Search branches"}
                                disabled={!selectedPartner}
                              />
                              <div className="max-h-48 overflow-y-auto rounded-2xl border border-zinc-200 bg-white/80 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900/70">
                                {!selectedPartner ? (
                                  <div className="text-sm text-zinc-500 dark:text-zinc-400">
                                    Select a partner to choose branch coverage.
                                  </div>
                                ) : partnerBranchOptions.length === 0 ? (
                                  <div className="text-sm text-amber-700 dark:text-amber-200">
                                    This partner has no operational branches yet. Configure branches in SACC Partnerships.
                                  </div>
                                ) : filteredBranchOptions.length === 0 ? (
                                  <div className="text-sm text-zinc-500 dark:text-zinc-400">
                                    No branches match your search.
                                  </div>
                                ) : (
                                  <div className="grid gap-2">
                                    {filteredBranchOptions.map((branch) => {
                                      const selected = (draft?.selectedBranchIds || []).some(
                                        (value) => safeStr(value).toLowerCase() === safeStr(branch.branchId).toLowerCase()
                                      );
                                      const coverage = normalizeCountyList([
                                        branch.primaryCounty,
                                        ...(branch.neighboringCounties || []),
                                      ]);
                                      return (
                                        <button
                                          key={`${uid}-branch-${branch.branchId}`}
                                          type="button"
                                          onClick={() => {
                                            const nextSelected = selected
                                              ? []
                                              : normalizeSingleAssignedBranchIds([branch.branchId]);
                                            setDraft(uid, {
                                              selectedBranchIds: nextSelected,
                                              countySearch: "",
                                            });
                                            setCountyOpenByUid((prev) => ({ ...(prev || {}), [uid]: false }));
                                          }}
                                          className={[
                                            "rounded-xl border px-3 py-2 text-left transition",
                                            selected
                                              ? "border-emerald-200 bg-emerald-50/80 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200"
                                              : "border-zinc-200 bg-white/80 text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900/75 dark:text-zinc-100",
                                          ].join(" ")}
                                        >
                                          <div className="text-sm font-semibold">{branch.branchName}</div>
                                          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                                            {coverage.length ? coverage.join(", ") : "No county coverage configured"}
                                          </div>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                              {hasBranchSelection ? (
                                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                                  Auto coverage attached from branch:
                                  {" "}
                                  {autoPrimaryCounty || "No primary county"}.
                                  {autoNeighboringCounties.length
                                    ? ` Nearby: ${autoNeighboringCounties.join(", ")}`
                                    : " No neighboring counties configured."}
                                </div>
                              ) : (
                                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                  Select one branch. Assigned admins remain bound to this branch for routing and payouts.
                                </div>
                              )}
                            </div>

                            <div className="grid gap-1.5">
                              <div className={label}>Availability</div>
                              <select
                                className={input}
                                value={draft?.availability || "active"}
                                onChange={(event) => setDraft(uid, { availability: event.target.value })}
                              >
                                <option value="active">Active</option>
                                <option value="busy">Busy</option>
                                <option value="offline">Offline</option>
                              </select>
                            </div>

                            <div className="grid gap-1.5">
                              <div className={label}>Stationed Country</div>
                              <select
                                className={input}
                                value={stationedCountry}
                                disabled={!selectedPartner}
                                onChange={(event) =>
                                  setDraft(uid, {
                                    stationedCountry: event.target.value,
                                    primaryCounty: "",
                                    neighboringCounties: [],
                                    countySearch: "",
                                  })
                                }
                              >
                                <option value="">
                                  {selectedPartner ? "Select stationed country" : "Select partner first"}
                                </option>
                                {partnerStationedCountryOptions.map((countryName) => (
                                  <option key={`${uid}-stationed-${countryName}`} value={countryName}>
                                    {countryName}
                                  </option>
                                ))}
                              </select>
                              {!selectedPartner ? (
                                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                  Select a partner first to choose a stationed country.
                                </div>
                              ) : partnerStationedCountryOptions.length === 0 ? (
                                <div className="text-xs text-amber-700 dark:text-amber-200">
                                  This partner has no home-country coverage configured yet.
                                </div>
                              ) : (
                                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                  Assigned admins can be stationed in one partner home country at a time.
                                </div>
                              )}
                            </div>

                            {isKenyaScope ? (
                              <>
                                <div className="grid gap-1.5">
                                  <div className={label}>Primary County</div>
                                  <select
                                    className={input}
                                    value={draft?.primaryCounty || ""}
                                    disabled={!manualCountyFieldsEnabled}
                                    onChange={(event) =>
                                      setDraft(uid, {
                                        primaryCounty: event.target.value,
                                        neighboringCounties: normalizeCountyList(
                                          draft?.neighboringCounties || []
                                        ).filter((county) => county !== event.target.value),
                                      })
                                    }
                                  >
                                    <option value="">
                                      {!countyFieldsEnabled
                                        ? "Select partner first"
                                        : hasBranchSelection
                                        ? "Auto from branches"
                                        : "Select primary county"}
                                    </option>
                                    {partnerCountyOptions.map((countyName) => (
                                      <option key={`${uid}-primary-${countyName}`} value={countyName}>
                                        {countyName}
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                <div className="grid gap-1.5">
                                  <div className={label}>Neighboring Counties</div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (!manualCountyFieldsEnabled || !neighboringFieldsEnabled) return;
                                      toggleCountyDropdown(uid);
                                    }}
                                    disabled={!manualCountyFieldsEnabled || !neighboringFieldsEnabled}
                                    className={`${input} inline-flex items-center justify-between text-left`}
                                  >
                                    <span className="truncate">
                                      {!manualCountyFieldsEnabled
                                        ? hasBranchSelection
                                          ? "Auto from selected branches"
                                          : "Select partner first"
                                        : !countyFieldsEnabled
                                        ? "Select partner first"
                                        : !safeStr(draft?.primaryCounty)
                                        ? "Select primary county first"
                                        : (draft?.neighboringCounties || []).length
                                        ? `${(draft?.neighboringCounties || []).length} neighboring counties selected`
                                        : "Select neighboring counties"}
                                    </span>
                                    <AppIcon
                                      icon={ChevronDown}
                                      size={ICON_SM}
                                      className={countyOpen ? "rotate-180 transition" : "transition"}
                                    />
                                  </button>

                                  {countyOpen ? (
                                    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-3">
                                      <input
                                        className={input}
                                        placeholder="Search counties..."
                                        value={draft?.countySearch || ""}
                                        onChange={(event) =>
                                          setDraft(uid, { countySearch: event.target.value })
                                        }
                                      />

                                      {recommendations.length ? (
                                        <div className="mt-3 flex flex-wrap gap-1.5">
                                          {recommendations.map((countyName) => (
                                            <button
                                              key={`rec-${uid}-${countyName}`}
                                              type="button"
                                              onClick={() => toggleCounty(uid, countyName)}
                                              className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 transition hover:bg-emerald-100 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200"
                                            >
                                              + {countyName}
                                            </button>
                                          ))}
                                        </div>
                                      ) : null}

                                      <div className="mt-3 grid max-h-44 overflow-y-auto gap-1 sm:grid-cols-2">
                                        {filteredCounties.map((countyName) => {
                                          const selected = (draft?.neighboringCounties || []).includes(
                                            countyName
                                          );
                                          return (
                                            <button
                                              key={`${uid}-${countyName}`}
                                              type="button"
                                              onClick={() => toggleCounty(uid, countyName)}
                                              className={[
                                                "rounded-xl border px-3 py-2 text-left text-sm font-medium transition",
                                                selected
                                                  ? "border-emerald-200 bg-emerald-50/80 text-emerald-800 shadow-[0_0_0_1px_rgba(16,185,129,0.15)] dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200"
                                                  : "border-zinc-200 bg-white/80 text-zinc-800 hover:border-emerald-200 dark:border-zinc-700 dark:bg-zinc-900/75 dark:text-zinc-100",
                                              ].join(" ")}
                                            >
                                              {countyName}
                                            </button>
                                          );
                                        })}
                                        {!filteredCounties.length ? (
                                          <div className="rounded-xl border border-dashed border-zinc-200 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                                            No more counties available for this partner.
                                          </div>
                                        ) : null}
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              </>
                            ) : stationedCountry ? (
                              <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/70 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/45 dark:text-zinc-300">
                                County subdivision routing remains Kenya-only. This admin will route by stationed country and the existing partner filters.
                              </div>
                            ) : null}

                            <div className="grid gap-1.5">
                              <div className={label}>Max Requests</div>
                              <input
                                type="number"
                                min={1}
                                max={120}
                                className={input}
                                value={draft?.maxActiveRequests ?? ""}
                                onChange={(event) => setDraft(uid, { maxActiveRequests: event.target.value })}
                              />
                            </div>

                            <button
                              type="button"
                              onClick={() => void runUpdate(row)}
                              disabled={updateBusy}
                              className="mt-1 inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                            >
                              <AppIcon icon={Save} size={ICON_SM} />
                              {updateBusy ? "Updating..." : "Update Admin"}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {confirmRevoke ? (
        <div className="fixed inset-0 z-[10060]">
          <button
            type="button"
            onClick={() => setConfirmRevoke(null)}
            className="absolute inset-0 bg-black/40"
            aria-label="Close revoke confirmation"
          />
          <div className="absolute inset-0 flex items-center justify-center app-overlay-safe">
            <div className="w-full max-w-sm rounded-3xl border border-rose-200 bg-white p-4 shadow-xl dark:border-rose-900/40 dark:bg-zinc-900">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
                <AppIcon icon={ShieldOff} size={ICON_SM} />
              </div>
              <div className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Are you sure you want to revoke this admin?
              </div>
              <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300 break-all">
                {safeStr(confirmRevoke?.email || confirmRevoke?.uid)}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmRevoke(null)}
                  className="rounded-2xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void runRevoke()}
                  disabled={Boolean(actionBusy)}
                  className="rounded-2xl border border-rose-200 bg-rose-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
