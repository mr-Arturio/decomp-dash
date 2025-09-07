"use client";
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  query,
  Timestamp,
  where,
  documentId,
} from "firebase/firestore";
import { db, ensureAnonAuth } from "@/lib/firebase";
import { scoreFor } from "@/lib/scoring";

// Local types for Firestore data
type Row = { teamId: string; points: number };
type MyScan = {
  id: string;
  ts: Date | null;
  label?: string; // actual item name (e.g., "plastic bottle"), if stored
  material: string; // normalized material
  bin: string;
  years: number;
  points: number;
};

type DocData = Record<string, unknown>;

export default function Leaderboard() {
  const [daily, setDaily] = useState<Row[]>([]);
  const [all, setAll] = useState<Row[]>([]);
  const [teamNames, setTeamNames] = useState<Record<string, string>>({});
  const [myScans, setMyScans] = useState<MyScan[]>([]);
  const [tab, setTab] = useState<"today" | "all">("today");

  // Load leaderboard data and hydrate team names
  useEffect(() => {
    (async () => {
      const scansRef = collection(db, "scans");
      const since = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
      const dailyQ = query(scansRef, where("ts", ">=", since));

      const [allSnap, dailySnap] = await Promise.all([
        getDocs(scansRef),
        getDocs(dailyQ),
      ]);

      const agg = (docs: { data(): DocData }[]) => {
        const map = new Map<string, number>();
        for (const d of docs) {
          const data = d.data();
          const teamId = typeof data.teamId === "string" ? data.teamId : "";
          const pts = typeof data.points === "number" ? data.points : 0;
          if (!teamId) continue;
          map.set(teamId, (map.get(teamId) || 0) + pts);
        }
        return [...map.entries()]
          .map(([teamId, points]) => ({ teamId, points }))
          .sort((a, b) => b.points - a.points)
          .slice(0, 20);
      };

      const dailyRows = agg(dailySnap.docs);
      const allRows = agg(allSnap.docs);
      setDaily(dailyRows);
      setAll(allRows);

      const ids = Array.from(
        new Set([...dailyRows, ...allRows].map((r) => r.teamId).filter(Boolean))
      );
      if (ids.length) {
        const teamsCol = collection(db, "teams");
        const chunks: string[][] = [];
        for (let i = 0; i < ids.length; i += 10)
          chunks.push(ids.slice(i, i + 10));

        const nameMap: Record<string, string> = {};
        for (const chunk of chunks) {
          const qTeams = query(teamsCol, where(documentId(), "in", chunk));
          const snap = await getDocs(qTeams);
          snap.forEach((doc) => {
            const data = doc.data() as DocData;
            nameMap[doc.id] =
              (typeof data.name === "string" && data.name) ||
              `Team ${doc.id.slice(0, 6)}…`;
          });
        }
        setTeamNames((prev) => ({ ...prev, ...nameMap }));
      }
    })();
  }, []);

  // Load "My Scans" (for the current anonymous user)
  useEffect(() => {
    (async () => {
      const uid = await ensureAnonAuth();
      const scansRef = collection(db, "scans");
      const myQ = query(scansRef, where("userId", "==", uid));
      const snap = await getDocs(myQ);

      const rows: MyScan[] = snap.docs.map((d) => {
        const data = d.data() as DocData;

        // Timestamp → Date
        const tsField = data.ts as Timestamp | undefined;
        const ts: Date | null = tsField?.toDate ? tsField.toDate() : null;

        // Material as a string (fallback to "unknown")
        const material: string =
          typeof data.material === "string" ? data.material : "unknown";

        // Derive years/bin without any-cast
        const { years, bin: ruleBin } = scoreFor(material);

        // Respect stored binSuggested if present
        const binSuggested: string =
          typeof data.binSuggested === "string" ? data.binSuggested : ruleBin;

        // Optional human label
        const label = typeof data.label === "string" ? data.label : undefined;

        // Points fallback
        const points: number =
          typeof data.points === "number" ? data.points : Math.round(years);

        return {
          id: d.id,
          ts,
          label,
          material,
          bin: binSuggested,
          years,
          points,
        };
      });

      rows.sort((a, b) => (b.ts?.getTime() || 0) - (a.ts?.getTime() || 0));
      setMyScans(rows.slice(0, 25));
    })();
  }, []);

  const rows = tab === "today" ? daily : all;
  const maxPoints = useMemo(
    () => Math.max(1, ...rows.map((r) => r.points)),
    [rows]
  );

  return (
    <section className="space-y-6">
      {/* Leaderboard tabs */}
      <div className="card p-4">
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

        <div className="mt-4 card divide-y">
          {rows.length === 0 && (
            <div className="p-4 text-sm text-neutral-500">No scans yet.</div>
          )}
          {rows.map((r, i) => (
            <div key={r.teamId} className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-6 text-center">
                    {i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}
                  </span>
                  <div
                    className="font-medium truncate"
                    title={teamNames[r.teamId] || `Team ${r.teamId}`}
                  >
                    {teamNames[r.teamId] ?? `Team ${r.teamId.slice(0, 6)}…`}
                  </div>
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
      </div>

      {/* My Scans list */}
      <div className="card">
        <div className="p-4 border-b">
          <h3 className="text-base font-semibold">My Scans</h3>
          <p className="text-xs text-neutral-500">
            Recent items you captured on this device.
          </p>
        </div>

        {myScans.length === 0 ? (
          <div className="p-4 text-sm text-neutral-500">No scans yet.</div>
        ) : (
          <ul className="divide-y">
            {myScans.map((s) => (
              <li key={s.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {s.label && <span className="chip">{s.label}</span>}
                      <span className="chip capitalize">{s.material}</span>
                      <span className="chip">
                        Bin: <b className="ml-1">{s.bin}</b>
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-neutral-500">
                      {s.ts ? s.ts.toLocaleString() : "pending…"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm">
                      Years: <b>{Math.round(s.years).toLocaleString()}</b>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
