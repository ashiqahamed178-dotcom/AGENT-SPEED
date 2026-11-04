// The escrow rules in one place: which action is allowed, in which status, and
// by whom. There is no database or HTTP here, so the rules are simple to test,
// and later the AI agent must go through these same rules.

export type EscrowStatus =
  | "created"
  | "funded"
  | "delivered"
  | "under_review"
  | "released"
  | "refunded"
  | "disputed";

export type EscrowRole = "buyer" | "seller" | "arbiter";

export type EscrowAction =
  | "fund"
  | "submit_evidence"
  | "start_review"
  | "dispute"
  | "release"
  | "refund";

type Rule = {
  from: Partial<Record<EscrowStatus, EscrowRole[]>>;
  to: EscrowStatus;
  event: string;
};

const RULES: Record<EscrowAction, Rule> = {
  fund: {
    from: { created: ["buyer"] },
    to: "funded",
    event: "funded_simulated"
  },
  submit_evidence: {
    from: { funded: ["seller"] },
    to: "delivered",
    event: "evidence_submitted"
  },
  start_review: {
    from: { delivered: ["buyer"] },
    to: "under_review",
    event: "review_started"
  },
  dispute: {
    from: {
      funded: ["buyer", "seller"],
      delivered: ["buyer", "seller"],
      under_review: ["buyer", "seller"]
    },
    to: "disputed",
    event: "dispute_raised"
  },
  // The party giving up the money decides. In a dispute only the neutral
  // arbiter does, so neither side can pay itself.
  release: {
    from: { under_review: ["buyer"], disputed: ["arbiter"] },
    to: "released",
    event: "release_simulated"
  },
  refund: {
    from: { under_review: ["seller"], disputed: ["arbiter"] },
    to: "refunded",
    event: "refund_simulated"
  }
};

export type TransitionResult =
  | { ok: true; to: EscrowStatus; event: string }
  | { ok: false; reason: "invalid_status" | "forbidden"; message: string };

export function checkTransition(
  action: EscrowAction,
  status: EscrowStatus,
  roles: EscrowRole[]
): TransitionResult {
  const rule = RULES[action];
  const allowedRoles = rule.from[status];

  if (!allowedRoles) {
    return {
      ok: false,
      reason: "invalid_status",
      message: `Cannot ${action.replace("_", " ")} an escrow with status '${status}'.`
    };
  }

  if (!roles.some((role) => allowedRoles.includes(role))) {
    return {
      ok: false,
      reason: "forbidden",
      message: `Only the ${allowedRoles.join(" or ")} can ${action.replace("_", " ")} at this stage.`
    };
  }

  return { ok: true, to: rule.to, event: rule.event };
}

export function availableActions(status: EscrowStatus, roles: EscrowRole[]): EscrowAction[] {
  return (Object.keys(RULES) as EscrowAction[]).filter(
    (action) => checkTransition(action, status, roles).ok
  );
}

// A buyer or seller never counts as arbiter on their own escrow, even if their
// account has the arbiter role. Otherwise they could decide their own dispute.
export function rolesFor(
  user: { id: string; role: "user" | "arbiter" },
  escrow: { buyerId: string; sellerId: string }
): EscrowRole[] {
  if (user.id === escrow.buyerId) return ["buyer"];
  if (user.id === escrow.sellerId) return ["seller"];
  if (user.role === "arbiter") return ["arbiter"];
  return [];
}
