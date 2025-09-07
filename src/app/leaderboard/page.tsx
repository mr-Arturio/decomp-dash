"use client";
import {
  collection,
  getDocs,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useEffect, useMemo, useState } from "react";

type Row = { teamId: string; points: number };

export default function Leaderboard() {
  const [daily, setDaily] = useState<Row[]>([]);
  const [all, setAll] = useState<Row[]>([]);
  const [tab, setTab] = useState<"today" | "all">("today");

  useEffect(() => {
    (async () => {
      const scansRef = collection(db, "scans");
      const since = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
      const dailyQ = query(scansRef, where("ts", ">=", since));
      const [allDocs, dailyDocs] = await Promise.all([
        getDocs(scansRef),
        getDocs(dailyQ),
      ]);
      const agg = (docs: any[]) => {
        const map = new Map<string, number>();
        for (const d of docs) {
          map.set(
            d.data().teamId,
            (map.get(d.data().teamId) || 0) + (d.data().points || 0)
          );
        }
        return [...map.entries()]
          .map(([teamId, points]) => ({ teamId, points }))
          .sort((a, b) => b.points - a.points)
          .slice(0, 20);
      };
      setDaily(agg(dailyDocs.docs));
      setAll(agg(allDocs.docs));
    })();
  }, []);

  const rows = tab === "today" ? daily : all;
  const maxPoints = useMemo(
    () => Math.max(1, ...rows.map((r) => r.points)),
    [rows]
  );

  return (
    <section className="space-y-4">
      <div className="flex gap-2">
        <button
          onClick={() => setTab("today")}
          className={`btn ${
            tab === "today" ? "bg-emerald-600 text-white" : "btn-outline"
          }`}
        >
          Today
        </button>
        <button
          onClick={() => setTab("all")}
          className={`btn ${
            tab === "all" ? "bg-emerald-600 text-white" : "btn-outline"
          }`}
        >
          All-time
        </button>
      </div>

      <div className="card divide-y">
        {rows.length === 0 && (
          <div className="p-4 text-sm text-neutral-500">No scans yet.</div>
        )}
        {rows.map((r, i) => (
          <div key={r.teamId} className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-6 text-center">
                  {i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}
                </span>
                <div className="font-medium">Team {r.teamId.slice(0, 6)}…</div>
              </div>
              <div className="font-semibold">{r.points}</div>
            </div>
            <div className="mt-2 h-2 w-full rounded-full bg-neutral-200">
              <div
                className="h-2 rounded-full bg-emerald-500"
                style={{ width: `${(r.points / maxPoints) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
