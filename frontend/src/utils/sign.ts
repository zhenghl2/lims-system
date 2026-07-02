// Shared signature status utility for NIPT tabs

export interface SignStatus {
  signed: boolean;
  name: string;
  time: string;
  names?: string[];  // for multi-operator
}

export function getSignStatus(edata: any, role: "operator" | "reviewer"): SignStatus {
  const key = role === "operator" ? "operator_signature" : "reviewer_signature";
  const sig = edata?.[key];
  if (!sig) {
    return { signed: false, name: "", time: "" };
  }
  // Check if array format (multi-operator)
  if (Array.isArray(sig) && sig.length > 0) {
    const names = sig.map((s: any) => s.username);
    return { signed: true, name: names.join(", "), time: sig[0]?.signed_at || "", names };
  }
  // Single operator / reviewer (object format, backward compat)
  if (typeof sig === "object" && sig.username) {
    return { signed: true, name: sig.username, time: sig.signed_at || "" };
  }
  return { signed: false, name: "", time: "" };
}
