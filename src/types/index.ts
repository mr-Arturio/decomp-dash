export type Team = { id: string; name: string; createdAt: number };
export type Bin = {
  id: string;
  teamId: string;
  label: string;
  qrCode: string;
  createdAt: number;
};
export type Scan = {
  id: string;
  userId: string;
  teamId: string;
  binId: string;
  ts: number;
  material: string; // plastic | metal | glass | paper | cardboard | compost | landfill | e-waste
  confidence: number;
  binSuggested: string; // recycling | compost | landfill | special
  ahash: string; // 16-hex
  points: number;
};
