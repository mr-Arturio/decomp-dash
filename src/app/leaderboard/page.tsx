"use client";
import {
  collection,
  getDocs,
  orderBy,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useEffect, useState } from "react";

type Row = { teamId: string; points: number };

export default function Leaderboard() {
  const [daily, setDaily] = useState<Row[]>([]);
  const [all, setAll] = useState<Row[]>([]);

  useEffect(() => {
    (async () => {
      const scansRef = collection(db, "scans");
      const since = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
      const dailyQ = query(scansRef, where("ts", ">=", since));
      const allDocs = await getDocs(scansRef);
      const dailyDocs = await getDocs(dailyQ);

      const agg = (docs: any[]) => {
        const map = new Map<string, number>();
        for (const d of docs) {
          const teamId = d.data().teamId as string;
          const pts = d.data().points as number;
          map.set(teamId, (map.get(teamId) || 0) + pts);
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

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Today</h2>
        <Board rows={daily} />
      </div>
      <div>
        <h2 className="text-xl font-semibold">All‑time</h2>
        <Board rows={all} />
      </div>
    </section>
  );
}

function Board({ rows }: { rows: Row[] }) {
  return (
    <div className="border rounded divide-y bg-white">
      <div className="grid grid-cols-2 p-2 text-sm font-medium bg-neutral-50">
        <div>Team</div>
        <div className="text-right">Points</div>
      </div>
      {rows.map((r, i) => (
        <div key={r.teamId} className="grid grid-cols-2 p-2">
          <div>
            #{i + 1} — {r.teamId.slice(0, 6)}…
          </div>
          <div className="text-right font-semibold">{r.points}</div>
        </div>
      ))}
      {rows.length === 0 && (
        <div className="p-3 text-sm text-neutral-500">No scans yet.</div>
      )}
    </div>
  );
}
