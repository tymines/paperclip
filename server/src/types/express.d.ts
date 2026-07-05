// ponytail: Express Request augmentation — fork is 407 commits behind upstream
declare namespace Express {
  interface Request {
    actor: {
      type: "board" | "agent" | "api" | "none";
      agentId?: string;
      keyId?: string;
      userId?: string;
      userName?: string | null;
      userEmail?: string | null;
      companyId?: string;
      companyIds?: string[];
      memberships?: Array<{ companyId: string; membershipRole: string | null; status: string }>;
      runId?: string;
      isInstanceAdmin?: boolean;
      source: string;
    };
  }
}
