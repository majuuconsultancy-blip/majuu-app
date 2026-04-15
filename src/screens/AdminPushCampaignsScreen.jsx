import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BellRing, Megaphone, Newspaper, RefreshCw, Wallet } from "lucide-react";
import { useNavigate } from "react-router-dom";
import AppIcon from "../components/AppIcon";
import { ICON_MD, ICON_SM } from "../constants/iconSizes";
import {
  activateOrUpdatePartnerPushSubscription,
  computeCampaignSendCount,
  createPushCampaignDraft,
  listNewsPushSuggestions,
  listPartnerPushSubscriptions,
  listPushCampaignPartners,
  listPushCampaigns,
  markPushCampaignAsSent,
} from "../services/pushCampaignService";
import { smartBack } from "../utils/navBack";

function safeStr(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function safeNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toDateInputValue(ms) {
  if (!ms) return "";
  try {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function statusPill(status = "") {
  const clean = safeStr(status).toLowerCase();
  if (clean === "active" || clean === "sent") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (clean === "scheduled") return "border-amber-200 bg-amber-50 text-amber-700";
  if (clean === "suspended") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-zinc-200 bg-zinc-100 text-zinc-600";
}

export default function AdminPushCampaignsScreen() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [partners, setPartners] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [newsRows, setNewsRows] = useState([]);

  const [subscriptionForm, setSubscriptionForm] = useState({
    partnerId: "",
    planName: "",
    monthlyPushQuota: 50,
    startDate: toDateInputValue(Date.now()),
    endDate: "",
    status: "active",
  });

  const [campaignForm, setCampaignForm] = useState({
    partnerId: "",
    title: "",
    body: "",
    imageUrl: "",
    ctaLabel: "Open",
    destinationType: "track_flow",
    externalUrl: "",
    internalScreen: "",
    targetingType: "general",
    track: "",
    country: "",
    scheduleType: "one_time",
    sendAt: "",
    sendDateTimesRaw: "",
    recurrencePattern: "",
    numberOfSends: 1,
    status: "draft",
  });

  const card =
    "rounded-3xl border border-zinc-200 bg-white/85 p-4 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/65";
  const input =
    "w-full rounded-2xl border border-zinc-200 bg-white/85 px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100";
  const label = "mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400";

  const refreshAll = async () => {
    setLoading(true);
    setErr("");
    try {
      const [partnerRows, subRows, campaignRows, suggestionRows] = await Promise.all([
        listPushCampaignPartners({ max: 300 }),
        listPartnerPushSubscriptions({ max: 400 }),
        listPushCampaigns({ max: 200 }),
        listNewsPushSuggestions({ max: 20 }),
      ]);
      const sortedPartners = (Array.isArray(partnerRows) ? partnerRows : []).sort((a, b) =>
        safeStr(a?.displayName).localeCompare(safeStr(b?.displayName))
      );
      setPartners(sortedPartners);
      setSubscriptions(Array.isArray(subRows) ? subRows : []);
      setCampaigns(Array.isArray(campaignRows) ? campaignRows : []);
      setNewsRows(Array.isArray(suggestionRows) ? suggestionRows : []);

      if (!subscriptionForm.partnerId && sortedPartners.length) {
        setSubscriptionForm((prev) => ({
          ...prev,
          partnerId: safeStr(sortedPartners[0]?.id || sortedPartners[0]?.partnerId),
        }));
      }
      if (!campaignForm.partnerId && sortedPartners.length) {
        setCampaignForm((prev) => ({
          ...prev,
          partnerId: safeStr(sortedPartners[0]?.id || sortedPartners[0]?.partnerId),
        }));
      }
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to load push campaigns module.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subscriptionByPartnerId = useMemo(() => {
    const map = new Map();
    (subscriptions || []).forEach((row) => {
      const partnerId = safeStr(row?.partnerId || row?.id);
      if (!partnerId) return;
      map.set(partnerId, row);
    });
    return map;
  }, [subscriptions]);

  const selectedSubscription = useMemo(
    () => subscriptionByPartnerId.get(safeStr(campaignForm.partnerId)) || null,
    [campaignForm.partnerId, subscriptionByPartnerId]
  );

  const campaignReservedPushes = useMemo(() => {
    const sendDateTimes = safeStr(campaignForm.sendDateTimesRaw)
      .split(/[\n,]+/)
      .map((value) => safeStr(value))
      .filter(Boolean);
    return computeCampaignSendCount({
      scheduleType: campaignForm.scheduleType,
      sendDateTimes,
      numberOfSends: campaignForm.numberOfSends,
    });
  }, [campaignForm.numberOfSends, campaignForm.scheduleType, campaignForm.sendDateTimesRaw]);
  const targetingLockedByDestination = campaignForm.destinationType === "external_link";

  const saveSubscription = async () => {
    setBusy("subscription");
    setErr("");
    setMsg("");
    try {
      const partner = partners.find(
        (row) => safeStr(row?.id || row?.partnerId) === safeStr(subscriptionForm.partnerId)
      );
      await activateOrUpdatePartnerPushSubscription({
        ...subscriptionForm,
        partnerName: safeStr(partner?.displayName || partner?.agentLabel || ""),
        monthlyPushQuota: Math.max(1, Math.floor(safeNum(subscriptionForm.monthlyPushQuota, 1))),
      });
      setMsg("Push subscription updated.");
      await refreshAll();
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to save subscription.");
    } finally {
      setBusy("");
    }
  };

  const saveCampaign = async () => {
    setBusy("campaign");
    setErr("");
    setMsg("");
    try {
      const partner = partners.find(
        (row) => safeStr(row?.id || row?.partnerId) === safeStr(campaignForm.partnerId)
      );
      const sendDateTimes = safeStr(campaignForm.sendDateTimesRaw)
        .split(/[\n,]+/)
        .map((value) => safeStr(value))
        .filter(Boolean);
      await createPushCampaignDraft({
        ...campaignForm,
        partnerName: safeStr(partner?.displayName || partner?.agentLabel || ""),
        numberOfSends: Math.max(1, Math.floor(safeNum(campaignForm.numberOfSends, 1))),
        sendDateTimes,
      });
      setMsg("Campaign saved and quota reserved.");
      setCampaignForm((prev) => ({
        ...prev,
        title: "",
        body: "",
        imageUrl: "",
        externalUrl: "",
        sendDateTimesRaw: "",
      }));
      await refreshAll();
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to save campaign.");
    } finally {
      setBusy("");
    }
  };

  const markCampaignSent = async (campaign = {}) => {
    const campaignId = safeStr(campaign?.id, 180);
    if (!campaignId) return;
    setBusy(`sent:${campaignId}`);
    setErr("");
    setMsg("");
    try {
      const reserved = Math.max(0, Math.floor(safeNum(campaign?.reservedPushes, 0)));
      await markPushCampaignAsSent(campaignId, {
        sentCount: reserved,
        deliveredCount: reserved,
      });
      setMsg("Campaign marked as sent and quota moved from reserved to used.");
      await refreshAll();
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to mark campaign as sent.");
    } finally {
      setBusy("");
    }
  };

  const remainingPushes = Math.max(0, Math.floor(safeNum(selectedSubscription?.pushesRemainingCycle, 0)));

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/50 via-white to-white pb-8 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
      <div className="mx-auto max-w-[1200px] px-5 py-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
              <AppIcon icon={Megaphone} size={ICON_SM} />
              Push Campaigns
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Partner Push Campaign Control
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Manual subscription activation with immediate quota reservation.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void refreshAll()}
              disabled={loading}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 bg-white/80 text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
              title="Refresh"
            >
              <AppIcon icon={RefreshCw} size={ICON_MD} />
            </button>
            <button
              type="button"
              onClick={() => smartBack(navigate, "/app/admin/sacc")}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 bg-white/80 text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
              title="Back"
            >
              <AppIcon icon={ArrowLeft} size={ICON_MD} />
            </button>
          </div>
        </div>

        {err ? (
          <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
            {err}
          </div>
        ) : null}

        {msg ? (
          <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
            {msg}
          </div>
        ) : null}

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <section className={card}>
            <div className="flex items-center gap-2">
              <AppIcon icon={Wallet} size={ICON_MD} className="text-emerald-700" />
              <div>
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Partner Push Subscription</h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Manual activation + quota config.</p>
              </div>
            </div>

            <div className="mt-4 grid gap-3">
              <div>
                <div className={label}>Partner</div>
                <select className={input} value={subscriptionForm.partnerId} onChange={(e) => setSubscriptionForm((prev) => ({ ...prev, partnerId: e.target.value }))}>
                  <option value="">Select partner</option>
                  {partners.map((row) => {
                    const id = safeStr(row?.id || row?.partnerId);
                    return (
                      <option key={id} value={id}>{safeStr(row?.displayName || row?.agentLabel || id)}</option>
                    );
                  })}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className={label}>Plan Name</div>
                  <input className={input} value={subscriptionForm.planName} onChange={(e) => setSubscriptionForm((prev) => ({ ...prev, planName: e.target.value }))} />
                </div>
                <div>
                  <div className={label}>Monthly Quota</div>
                  <input className={input} type="number" min={1} value={subscriptionForm.monthlyPushQuota} onChange={(e) => setSubscriptionForm((prev) => ({ ...prev, monthlyPushQuota: Math.max(1, Math.floor(safeNum(e.target.value, 1))) }))} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className={label}>Start Date</div>
                  <input className={input} type="date" value={subscriptionForm.startDate} onChange={(e) => setSubscriptionForm((prev) => ({ ...prev, startDate: e.target.value }))} />
                </div>
                <div>
                  <div className={label}>End Date</div>
                  <input className={input} type="date" value={subscriptionForm.endDate} onChange={(e) => setSubscriptionForm((prev) => ({ ...prev, endDate: e.target.value }))} />
                </div>
              </div>

              <div>
                <div className={label}>Status</div>
                <select className={input} value={subscriptionForm.status} onChange={(e) => setSubscriptionForm((prev) => ({ ...prev, status: e.target.value }))}>
                  <option value="active">Active</option>
                  <option value="expired">Expired</option>
                  <option value="suspended">Suspended</option>
                </select>
              </div>

              <button type="button" onClick={() => void saveSubscription()} disabled={busy === "subscription"} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60">
                <AppIcon icon={Wallet} size={ICON_SM} />
                {busy === "subscription" ? "Saving..." : "Save Subscription"}
              </button>
            </div>
          </section>

          <section className={card}>
            <div className="flex items-center gap-2">
              <AppIcon icon={BellRing} size={ICON_MD} className="text-emerald-700" />
              <div>
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Campaign Builder</h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Quota reserved immediately on save.</p>
              </div>
            </div>

            <div className="mt-4 grid gap-3">
              <div>
                <div className={label}>Partner</div>
                <select className={input} value={campaignForm.partnerId} onChange={(e) => setCampaignForm((prev) => ({ ...prev, partnerId: e.target.value }))}>
                  <option value="">Select partner</option>
                  {partners.map((row) => {
                    const id = safeStr(row?.id || row?.partnerId);
                    return (
                      <option key={id} value={id}>{safeStr(row?.displayName || row?.agentLabel || id)}</option>
                    );
                  })}
                </select>
                <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">Remaining: {remainingPushes} | This campaign reserves: {campaignReservedPushes}</div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className={label}>Title</div>
                  <input className={input} value={campaignForm.title} onChange={(e) => setCampaignForm((prev) => ({ ...prev, title: e.target.value }))} />
                </div>
                <div>
                  <div className={label}>CTA Label</div>
                  <input className={input} value={campaignForm.ctaLabel} onChange={(e) => setCampaignForm((prev) => ({ ...prev, ctaLabel: e.target.value }))} />
                </div>
              </div>

              <div>
                <div className={label}>Body</div>
                <textarea className={`${input} min-h-[74px]`} value={campaignForm.body} onChange={(e) => setCampaignForm((prev) => ({ ...prev, body: e.target.value }))} />
              </div>

              <div>
                <div className={label}>Campaign Image / Banner URL (optional)</div>
                <input
                  className={input}
                  value={campaignForm.imageUrl}
                  onChange={(e) => setCampaignForm((prev) => ({ ...prev, imageUrl: e.target.value }))}
                  placeholder="https://example.com/banner.jpg"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className={label}>Destination</div>
                  <select
                    className={input}
                    value={campaignForm.destinationType}
                    onChange={(e) => {
                      const nextDestination = e.target.value;
                      setCampaignForm((prev) => {
                        const next = { ...prev, destinationType: nextDestination };
                        if (nextDestination === "external_link") {
                          next.targetingType = "general";
                          next.track = "";
                          next.country = "";
                        } else {
                          next.externalUrl = "";
                        }
                        return next;
                      });
                    }}
                  >
                    <option value="track_flow">Track Request Flow</option>
                    <option value="external_link">External Link</option>
                    <option value="internal_screen">Internal Screen (future)</option>
                  </select>
                </div>
                <div>
                  <div className={label}>Targeting</div>
                  <select
                    className={`${input} ${targetingLockedByDestination ? "opacity-60" : ""}`}
                    value={campaignForm.targetingType}
                    disabled={targetingLockedByDestination}
                    onChange={(e) => setCampaignForm((prev) => ({ ...prev, targetingType: e.target.value }))}
                  >
                    <option value="general">General</option>
                    <option value="track_only">Track Only</option>
                    <option value="track_country">Track + Country</option>
                  </select>
                </div>
              </div>

              {campaignForm.destinationType === "external_link" ? (
                <div>
                  <div className={label}>External URL</div>
                  <input className={input} value={campaignForm.externalUrl} onChange={(e) => setCampaignForm((prev) => ({ ...prev, externalUrl: e.target.value }))} placeholder="https://example.com" />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className={label}>Track</div>
                    <input className={input} value={campaignForm.track} onChange={(e) => setCampaignForm((prev) => ({ ...prev, track: e.target.value }))} placeholder="study / work / travel" />
                  </div>
                  <div>
                    <div className={label}>Country</div>
                    <input className={input} value={campaignForm.country} onChange={(e) => setCampaignForm((prev) => ({ ...prev, country: e.target.value }))} />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className={label}>Schedule Type</div>
                  <select className={input} value={campaignForm.scheduleType} onChange={(e) => setCampaignForm((prev) => ({ ...prev, scheduleType: e.target.value }))}>
                    <option value="one_time">One-time</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="recurring">Recurring</option>
                  </select>
                </div>
                <div>
                  <div className={label}>Status</div>
                  <select className={input} value={campaignForm.status} onChange={(e) => setCampaignForm((prev) => ({ ...prev, status: e.target.value }))}>
                    <option value="draft">Draft</option>
                    <option value="scheduled">Scheduled</option>
                  </select>
                </div>
              </div>

              {(campaignForm.scheduleType === "scheduled" || campaignForm.scheduleType === "recurring") ? (
                <div className="grid gap-3">
                  <div>
                    <div className={label}>Primary Send Time (ISO)</div>
                    <input className={input} value={campaignForm.sendAt} onChange={(e) => setCampaignForm((prev) => ({ ...prev, sendAt: e.target.value }))} placeholder="2026-04-15T09:00:00Z" />
                  </div>
                  {campaignForm.scheduleType === "recurring" ? (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className={label}>Number Of Sends</div>
                          <input className={input} type="number" min={1} value={campaignForm.numberOfSends} onChange={(e) => setCampaignForm((prev) => ({ ...prev, numberOfSends: Math.max(1, Math.floor(safeNum(e.target.value, 1))) }))} />
                        </div>
                        <div>
                          <div className={label}>Recurrence Pattern</div>
                          <input className={input} value={campaignForm.recurrencePattern} onChange={(e) => setCampaignForm((prev) => ({ ...prev, recurrencePattern: e.target.value }))} placeholder="weekly / monthly" />
                        </div>
                      </div>
                      <div>
                        <div className={label}>Send Dates (one per line / comma)</div>
                        <textarea className={`${input} min-h-[70px]`} value={campaignForm.sendDateTimesRaw} onChange={(e) => setCampaignForm((prev) => ({ ...prev, sendDateTimesRaw: e.target.value }))} placeholder="2026-04-20T09:00:00Z" />
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}

              <button type="button" onClick={() => void saveCampaign()} disabled={busy === "campaign" || loading} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60">
                <AppIcon icon={Megaphone} size={ICON_SM} />
                {busy === "campaign" ? "Saving..." : "Save Campaign + Reserve Quota"}
              </button>
            </div>
          </section>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <section className={card}>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Campaigns</h2>
            {campaigns.length === 0 ? (
              <div className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">No campaigns yet.</div>
            ) : (
              <div className="mt-3 grid gap-2">
                {campaigns.map((row) => (
                  <div key={row.id} className="rounded-2xl border border-zinc-200 bg-white/85 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900/70">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{safeStr(row?.title, 140) || "Untitled campaign"}</div>
                        <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">{safeStr(row?.partnerName || row?.partnerId)} | Reserved: {safeNum(row?.reservedPushes, 0)}</div>
                        <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                          Sent: {safeNum(row?.analytics?.sentCount, 0)} | Delivered: {safeNum(row?.analytics?.deliveredCount, 0)} | Opens: {safeNum(row?.analytics?.openCount, 0)} | Clicks: {safeNum(row?.analytics?.clickCount, 0)} | CTR: {safeNum(row?.analytics?.clickThroughRate, 0)}%
                        </div>
                        <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                          Deep links: {safeNum(row?.analytics?.deepLinkOpenCount, 0)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {safeStr(row?.status).toLowerCase() !== "sent" ? (
                          <button
                            type="button"
                            onClick={() => void markCampaignSent(row)}
                            disabled={busy === `sent:${safeStr(row?.id, 180)}`}
                            className="rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200"
                          >
                            {busy === `sent:${safeStr(row?.id, 180)}` ? "Marking..." : "Mark Sent"}
                          </button>
                        ) : null}
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusPill(row?.status)}`}>{safeStr(row?.status || "draft")}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className={card}>
            <div className="inline-flex items-center gap-2">
              <AppIcon icon={Newspaper} size={ICON_SM} className="text-emerald-700" />
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">News Push Suggestions</h2>
            </div>
            {newsRows.length === 0 ? (
              <div className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">No news suggestions available.</div>
            ) : (
              <div className="mt-3 grid gap-2">
                {newsRows.map((row) => (
                  <div key={row.id} className="rounded-2xl border border-zinc-200 bg-white/85 p-3 dark:border-zinc-700 dark:bg-zinc-900/70">
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{safeStr(row?.title, 140)}</div>
                    <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">{safeStr(row?.summary, 180) || "No summary"}</div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">Priority: {safeNum(row?.priorityScore, 0)}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setCampaignForm((prev) => ({
                            ...prev,
                            title: safeStr(row?.title, 120),
                            body: safeStr(row?.summary || row?.content, 280),
                            track: safeStr(row?.trackType || row?.track, 40),
                            country: safeStr(row?.country, 120),
                            targetingType: safeStr(row?.country)
                              ? "track_country"
                              : safeStr(row?.trackType || row?.track)
                              ? "track_only"
                              : "general",
                          }))
                        }
                        className="rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200"
                      >
                        Use
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <section className={`${card} mt-4`}>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Subscriptions</h2>
          {subscriptions.length === 0 ? (
            <div className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">No subscriptions found.</div>
          ) : (
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {subscriptions.map((row) => (
                <div key={safeStr(row?.partnerId || row?.id)} className="rounded-2xl border border-zinc-200 bg-white/85 p-3 dark:border-zinc-700 dark:bg-zinc-900/70">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{safeStr(row?.partnerName || row?.partnerId)}</div>
                  <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">{safeStr(row?.planName)} | Quota: {safeNum(row?.monthlyPushQuota, 0)}</div>
                  <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">Used: {safeNum(row?.pushesUsedCycle, 0)} | Reserved: {safeNum(row?.pushesReservedCycle, 0)} | Remaining: {safeNum(row?.pushesRemainingCycle, 0)}</div>
                  <span className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusPill(row?.status)}`}>{safeStr(row?.status || "active")}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
