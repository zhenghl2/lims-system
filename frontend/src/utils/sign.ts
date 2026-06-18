// Shared signature status utility for NIPT tabs

export interface SignStatus {
  signed: boolean;
  name: string;
  time: string;
}

export function getSignStatus(edata: any, role: "operator" | "reviewer"): SignStatus {
  const key = role === "operator" ? "operator_signature" : "reviewer_signature";
  const sig = edata?.[key];
  if (!sig || typeof sig !== "object" || !sig.username) {
    return { signed: false, name: "", time: "" };
  }
  return { signed: true, name: sig.username, time: sig.signed_at || "" };
}
