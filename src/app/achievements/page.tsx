"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  query,
  where,
  Timestamp,
} from "firebase/firestore";
import { db, ensureAnonAuth } from "@/lib/firebase";
import { scoreFor } from "@/lib/scoring";
import ShareBadgeButton from "@/components/ShareBadgeButton";

// ---- Types ----
type ScanDoc = {
  ts?: Timestamp;
  label?: string;
  material?: string;
  binSuggested?: string;
  years?: number;
  points?: number;
};

type TotalsMap = Record<string, number>;

type Stats = {
  totalYears: number;
  totalPoints: number;
  byMaterialYears: TotalsMap;
  byBinYears: TotalsMap;
  byDayYears: TotalsMap; // key: YYYY-MM-DD
  byMonthYears: TotalsMap; // key: YYYY-MM
  mostScannedItem?: string; // by count of label/material
  uniqueMaterials: Set<string>;
  uniqueBins: Set<string>;
  streakCurrent: number;
  streakBest: number;
  bestDay: { key: string; years: number } | null;
  bestMonth: { key: string; years: number } | null;
};

// ---- Helpers ----
const fmtInt = (n: number) => Math.round(n).toLocaleString();
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
const monthKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

// compute streaks from a Set of YYYY-MM-DD keys (local time)
function computeStreaks(dayKeys: string[]): { current: number; best: number } {
  if (dayKeys.length === 0) return { current: 0, best: 0 };
  const all = [...dayKeys].sort((a, b) => (a < b ? 1 : -1));
  const toDate = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1);
  };

  let best = 1;
  let cur = 1;

  for (let i = 1; i < all.length; i++) {
    const prev = toDate(all[i - 1]);
    const curr = toDate(all[i]);
    const diffDays = (prev.getTime() - curr.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays === 1) {
      cur += 1;
      best = Math.max(best, cur);
    } else if (diffDays > 1) {
      cur = 1;
    }
  }

  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
  let current = 0;
  const set = new Set(all);
  if (set.has(today)) {
    let d = new Date();
    while (set.has(dayKey(d))) {
      current++;
      d = new Date(d.getTime() - 24 * 60 * 60 * 1000);
    }
  } else if (set.has(yesterday)) {
    let d = new Date(Date.now() - 24 * 60 * 60 * 1000);
    while (set.has(dayKey(d))) {
      current++;
      d = new Date(d.getTime() - 24 * 60 * 60 * 1000);
    }
  } else {
    current = 0;
  }

  return { current, best };
}

// ---- Achievements config ----
type Achievement = {
  id: string;
  name: string;
  desc: string;
  emoji: string;
  unlocked: (s: Stats) => boolean;
};

const ACHIEVEMENTS: Achievement[] = [
  { id: "first_scan", name: "First Scan!", desc: "Your journey starts here.", emoji: "🌱", unlocked: (s) => s.totalYears > 0 },
  { id: "1k_years", name: "1,000 Years", desc: "Saved a millennium of decay time.", emoji: "🧭", unlocked: (s) => s.totalYears >= 1_000 },
  { id: "10k_years", name: "10,000 Years", desc: "Carbon Crusader.", emoji: "⚡", unlocked: (s) => s.totalYears >= 10_000 },
  { id: "100k_years", name: "100,000 Years", desc: "Century Champion.", emoji: "🏆", unlocked: (s) => s.totalYears >= 100_000 },
  { id: "1m_years", name: "1,000,000 Years", desc: "Time Lord.", emoji: "🕰️", unlocked: (s) => s.totalYears >= 1_000_000 },
  { id: "compost_10k", name: "Compost Champ", desc: "10k years saved in organic.", emoji: "🍃", unlocked: (s) => (s.byMaterialYears["organic"] || 0) >= 10_000 },
  {
    id: "all_types",
    name: "All Sorted",
    desc: "Scanned all material types.",
    emoji: "🧩",
    unlocked: (s) => ["plastic", "metal", "glass", "paper", "organic"].every((k) => s.uniqueMaterials.has(k)),
  },
  { id: "streak_10", name: "Ten-Day Streak", desc: "Scanned 10 days in a row.", emoji: "🔥", unlocked: (s) => s.streakBest >= 10 },
  { id: "big_day", name: "Marathon Day", desc: "≥ 5,000 years saved in a day.", emoji: "🚀", unlocked: (s) => Math.max(0, ...Object.values(s.byDayYears)) >= 5_000 },
];

// ---- UI bits ----
function StatCard({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="text-sm text-neutral-500">{title}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-neutral-500 mt-1">{sub}</div>}
    </div>
  );
}

function BarRow({ label, value, max }: { label: string; value: number; max: number }) {
  const width = max > 0 ? `${(value / max) * 100}%` : "0%";
  return (
    <div className="py-2">
      <div className="flex justify-between text-sm">
        <span className="capitalize">{label}</span>
        <span>{fmtInt(value)} yrs</span>
      </div>
      <div className="mt-1 h-2 w-full rounded-full bg-neutral-200">
        <div className="h-2 rounded-full bg-emerald-500" style={{ width }} />
      </div>
    </div>
  );
}

function Badge({ a, done }: { a: Achievement; done: boolean }) {
  return (
    <div className={`border rounded-2xl p-3 flex items-start gap-3 ${done ? "bg-white" : "bg-neutral-50 opacity-70"}`}>
      <div className="text-2xl">{a.emoji}</div>
      <div className="min-w-0">
        <div className="font-medium">{a.name}</div>
        <div className="text-xs text-neutral-600">{a.desc}</div>
        {!done && <div className="mt-1 text-[11px] text-neutral-500 italic">Locked</div>}
      </div>
    </div>
  );
}

// ---- Page ----
export default function AchievementsPage() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    (async () => {
      const uid = await ensureAnonAuth();
      const scansCol = collection(db, "scans");
      const snap = await getDocs(query(scansCol, where("userId", "==", uid)));

      // Aggregate
      const byMaterialYears: TotalsMap = {};
      const byBinYears: TotalsMap = {};
      const byDayYears: TotalsMap = {};
      const byMonthYears: TotalsMap = {};
      const labelCounts: Record<string, number> = {};
      const matSet = new Set<string>();
      const binSet = new Set<string>();

      let totalYears = 0;
      let totalPoints = 0;

      const dayPresence = new Set<string>();

      snap.docs.forEach((doc) => {
        const d = doc.data() as ScanDoc;
        const when: Date | null = d.ts?.toDate ? d.ts.toDate() : null;

        const material = (d.material || "unknown").toLowerCase();
        const computed = scoreFor(material);

        // Stored years or computed
        const storedYears = d.years ?? Math.round(computed.years);

        // Normalize bin names and collapse synonyms
        const rawBin = (d.binSuggested || computed.bin || "other").toLowerCase();
        const bin =
          rawBin === "recycle" ? "recycling" :
          rawBin === "trash" ? "landfill" :
          rawBin;

        const label = (d.label || material).toLowerCase();

        // Landfill does NOT count towards "years saved"
        const effectiveYears = bin === "landfill" ? 0 : storedYears;
        const pts = bin === "landfill" ? 0 : (d.points ?? Math.round(storedYears));

        totalYears += effectiveYears;
        totalPoints += pts;

        byMaterialYears[material] = (byMaterialYears[material] || 0) + effectiveYears;

        // Exclude landfill from By Bin breakdown
        if (bin !== "landfill") {
          byBinYears[bin] = (byBinYears[bin] || 0) + effectiveYears;
          binSet.add(bin);
        }

        if (when) {
          const dk = dayKey(when);
          const mk = monthKey(when);
          byDayYears[dk] = (byDayYears[dk] || 0) + effectiveYears;
          byMonthYears[mk] = (byMonthYears[mk] || 0) + effectiveYears;
          dayPresence.add(dk);
        }

        matSet.add(material);
        labelCounts[label] = (labelCounts[label] || 0) + 1;
      });

      const bestDayKey = Object.entries(byDayYears).sort((a, b) => b[1] - a[1])[0] || null;
      const bestMonthKey = Object.entries(byMonthYears).sort((a, b) => b[1] - a[1])[0] || null;

      const mostScannedItem = Object.entries(labelCounts).sort((a, b) => b[1] - a[1])[0]?.[0];

      const { current: streakCurrent, best: streakBest } = computeStreaks([...dayPresence]);

      const s: Stats = {
        totalYears,
        totalPoints,
        byMaterialYears,
        byBinYears,
        byDayYears,
        byMonthYears,
        mostScannedItem,
        uniqueMaterials: matSet,
        uniqueBins: binSet,
        streakCurrent,
        streakBest,
        bestDay: bestDayKey ? { key: bestDayKey[0], years: bestDayKey[1] } : null,
        bestMonth: bestMonthKey ? { key: bestMonthKey[0], years: bestMonthKey[1] } : null,
      };

      setStats(s);
      setLoading(false);
    })();
  }, []);

  const unlocked = useMemo(() => {
    if (!stats) return new Set<string>();
    const set = new Set<string>();
    for (const a of ACHIEVEMENTS) {
      if (a.unlocked(stats)) set.add(a.id);
    }
    return set;
  }, [stats]);

  if (loading || !stats) {
    return (
      <section className="space-y-4">
        <div className="card p-4">Loading achievements…</div>
      </section>
    );
  }

  const topMat = Object.entries(stats.byMaterialYears).sort((a, b) => b[1] - a[1])[0];
  const topBin = Object.entries(stats.byBinYears).sort((a, b) => b[1] - a[1])[0];

  // No landfill here
  const binOrder = ["recycling", "compost", "special", "ewaste", "other"];
  const matOrder = ["plastic", "paper", "glass", "metal", "organic", "other"];

  const binMax = Math.max(0, ...Object.values(stats.byBinYears));
  const matMax = Math.max(0, ...Object.values(stats.byMaterialYears));

  return (
    <section className="space-y-6">
      {/* Top stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard title="Total Years Saved" value={`${fmtInt(stats.totalYears)} yrs`} />
        <StatCard title="Total Points" value={`${fmtInt(stats.totalPoints)}`} />
        <StatCard title="Best Day" value={stats.bestDay ? `${fmtInt(stats.bestDay.years)} yrs` : "—"} sub={stats.bestDay?.key} />
        <StatCard title="Best Month" value={stats.bestMonth ? `${fmtInt(stats.bestMonth.years)} yrs` : "—"} sub={stats.bestMonth?.key} />
      </div>

      {/* Breakdown by material */}
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">By Material</h3>
          {topMat && (
            <span className="chip">
              Top: <b className="ml-1 capitalize">{topMat[0]}</b>
            </span>
          )}
        </div>
        <div className="mt-2">
          {matOrder
            .filter((k) => stats.byMaterialYears[k])
            .map((k) => (
              <BarRow key={k} label={k} value={stats.byMaterialYears[k]} max={matMax} />
            ))}
        </div>
      </div>

      {/* Breakdown by bin (landfill excluded) */}
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">By Bin</h3>
          {topBin && (
            <span className="chip">
              Top: <b className="ml-1 capitalize">{topBin[0]}</b>
            </span>
          )}
        </div>
        <div className="mt-2">
          {binOrder
            .filter((k) => stats.byBinYears[k])
            .map((k) => (
              <BarRow key={k} label={k} value={stats.byBinYears[k]} max={binMax} />
            ))}
        </div>
      </div>

      {/* Most scanned item */}
      <div className="card p-4">
        <div className="text-sm text-neutral-500">Most Scanned Item</div>
        <div className="mt-1 text-lg font-semibold capitalize">
          {stats.mostScannedItem ?? "—"}
        </div>
      </div>

      {/* Achievements grid */}
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Achievements</h3>
          <span className="chip">
            Streak: <b className="ml-1">{stats.streakCurrent}</b> (best {stats.streakBest})
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {ACHIEVEMENTS.map((a) => {
            const done = unlocked.has(a.id);
            return (
              <div key={a.id} className="space-y-2">
                <Badge a={a} done={done} />
                {done && (
                  <div className="flex justify-center">
                    <ShareBadgeButton
                      emoji={a.emoji}
                      title={a.name}
                      subtitle={`Total saved: ${stats.totalYears.toLocaleString()} yrs`}
                      fileName={`decomp-${a.id}.png`}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
