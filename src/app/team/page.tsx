"use client";
import { useEffect, useState } from "react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db, ensureAnonAuth } from "@/lib/firebase";
import QRBadge from "@/components/QRBadge";

export default function TeamPage() {
  const [teamId, setTeamId] = useState("");
  const [teamName, setTeamName] = useState("");
  const [binId, setBinId] = useState("");

  useEffect(() => {
    // make sure anonymous auth is established
    ensureAnonAuth();

    // restore last created team/bin from localStorage for convenience
    const lastTeam = localStorage.getItem("dd:lastTeamId");
    const lastBin = localStorage.getItem("dd:lastBinId");
    if (lastTeam) setTeamId(lastTeam);
    if (lastBin) setBinId(lastBin);
  }, []);

  async function createTeam() {
    // create team
    const teamRef = await addDoc(collection(db, "teams"), {
      name: teamName || "My Team",
      createdAt: serverTimestamp(),
    });
    setTeamId(teamRef.id);
    localStorage.setItem("dd:lastTeamId", teamRef.id);

    // create default bin
    const binRef = await addDoc(collection(db, "bins"), {
      teamId: teamRef.id,
      label: "Main Bin",
      createdAt: serverTimestamp(),
    });
    setBinId(binRef.id);
    localStorage.setItem("dd:lastBinId", binRef.id);
  }

  async function createBin() {
    if (!teamId) return;
    const binRef = await addDoc(collection(db, "bins"), {
      teamId,
      label: `Bin ${Math.floor(Math.random() * 100)}`,
      createdAt: serverTimestamp(),
    });
    setBinId(binRef.id);
    localStorage.setItem("dd:lastBinId", binRef.id);
  }

  return (
    <section className="space-y-4">
      <div className="card p-4">
        <h2 className="text-lg font-semibold">Create / Join Team</h2>
        <div className="mt-3 flex gap-2">
          <input
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="Team name"
            className="flex-1 rounded-xl border px-3 py-2"
          />
          <button onClick={createTeam} className="btn-primary">
            Create
          </button>
        </div>
        {teamId && (
          <p className="mt-2 text-xs text-neutral-500">
            Team ID: <code>{teamId}</code>
          </p>
        )}
      </div>

      <div className="card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-medium">Your BinTag</h3>
          {teamId && (
            <button onClick={createBin} className="btn-outline">
              Add Bin
            </button>
          )}
        </div>

        {teamId && binId ? (
          <div className="space-y-2">
            <QRBadge payload={`BINTAG:${teamId}:${binId}`} />
            <p className="text-sm text-neutral-600">
              Print and tape this near your bin. Scans must include this QR to
              earn points.
            </p>
          </div>
        ) : (
          <p className="text-sm text-neutral-600">
            Create a team to generate a BinTag.
          </p>
        )}
      </div>
    </section>
  );
}
