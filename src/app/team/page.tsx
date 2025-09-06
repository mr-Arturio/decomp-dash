"use client";
import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db, ensureAnonAuth } from "@/lib/firebase";
import QRBadge from "@/components/QRBadge";

export default function TeamPage() {
  const [teamId, setTeamId] = useState("");
  const [teamName, setTeamName] = useState("");
  const [binId, setBinId] = useState<string>("");

  useEffect(() => {
    ensureAnonAuth();
  }, []);

  async function createTeam() {
    const ref = await addDoc(collection(db, "teams"), {
      name: teamName || "My Team",
      createdAt: serverTimestamp(),
    });
    setTeamId(ref.id);
    const bin = await addDoc(collection(db, "bins"), {
      teamId: ref.id,
      label: "Main Bin",
      createdAt: serverTimestamp(),
    });
    setBinId(bin.id);
  }

  async function createBin() {
    if (!teamId) return;
    const bin = await addDoc(collection(db, "bins"), {
      teamId,
      label: `Bin ${Math.floor(Math.random() * 100)}`,
      createdAt: serverTimestamp(),
    });
    setBinId(bin.id);
  }

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Create / Join Team</h2>
      <div className="flex items-center gap-2">
        <input
          value={teamName}
          onChange={(e) => setTeamName(e.target.value)}
          placeholder="Team name"
          className="border rounded px-2 py-1"
        />
        <button
          onClick={createTeam}
          className="px-3 py-1.5 rounded bg-black text-white"
        >
          Create team
        </button>
      </div>

      <div className="border rounded p-3 bg-white">
        <div className="font-medium mb-2">Your BinTag</div>
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

      {teamId && (
        <button onClick={createBin} className="px-3 py-1.5 border rounded">
          Add another bin
        </button>
      )}
    </section>
  );
}
