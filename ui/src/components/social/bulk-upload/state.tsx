/**
 * Bulk-upload wizard state: a reducer-driven context shared across the
 * three step components. Persists to bulk_upload_drafts on the server via
 * the bulk-upload API; in this scaffold the persistence is wired in step 2.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import type { SocialAccountPublic, SocialPlatform } from "@paperclipai/shared";

/** Bulk Upload is constrained to these five platforms per Tyler's spec. */
export const BULK_UPLOAD_PLATFORMS = [
  "instagram",
  "twitter",
  "facebook",
  "threads",
  "reddit",
] as const satisfies readonly SocialPlatform[];

export type BulkUploadPlatform = (typeof BULK_UPLOAD_PLATFORMS)[number];

export type BulkUploadStep = "upload" | "review" | "schedule";

export type BulkUploadDetectedType = "image" | "video";

export interface BulkUploadFile {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  thumbnailKey: string | null;
  detectedType: BulkUploadDetectedType;
  orderIndex: number;
  caption: string | null;
  hashtags: string[];
  platforms: BulkUploadPlatform[];
  aiSuggestedCaption: string | null;
  /** UI-only: selected via checkbox for bulk operations. */
  selected: boolean;
  /** UI-only: 0-100, set while a local file is uploading. */
  uploadProgress: number | null;
  /** UI-only: surface upload errors per row. */
  uploadError: string | null;
}

export type ScheduleStrategyKind = "even" | "best-times" | "custom-queue";

export interface EvenSpreadConfig {
  kind: "even";
  /** YYYY-MM-DD */
  startDate: string;
  dayCount: number;
  postsPerDayPerPlatform: number;
}

export interface BestTimesConfig {
  kind: "best-times";
  /** YYYY-MM-DD */
  startDate: string;
}

export interface CustomQueueSlot {
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  hour: number;
  minute: number;
}

export interface CustomQueueConfig {
  kind: "custom-queue";
  /** YYYY-MM-DD */
  startDate: string;
  perPlatform: Partial<Record<BulkUploadPlatform, CustomQueueSlot[]>>;
}

export type ScheduleStrategy =
  | EvenSpreadConfig
  | BestTimesConfig
  | CustomQueueConfig;

export interface BulkUploadState {
  companyId: string;
  draftId: string | null;
  step: BulkUploadStep;
  uploads: BulkUploadFile[];
  strategy: ScheduleStrategy | null;
}

export type BulkUploadAction =
  | { type: "set-step"; step: BulkUploadStep }
  | { type: "set-draft-id"; draftId: string }
  | { type: "add-uploads"; uploads: BulkUploadFile[] }
  | { type: "remove-uploads"; ids: string[] }
  | { type: "reorder-uploads"; ids: string[] }
  | {
      type: "update-upload";
      id: string;
      patch: Partial<BulkUploadFile>;
    }
  | {
      type: "bulk-apply";
      ids: string[];
      patch: Pick<Partial<BulkUploadFile>, "caption" | "hashtags" | "platforms">;
    }
  | { type: "toggle-selected"; id: string; selected: boolean }
  | { type: "select-all"; selected: boolean }
  | { type: "select-by-type"; detectedType: BulkUploadDetectedType }
  | { type: "set-strategy"; strategy: ScheduleStrategy };

function reducer(state: BulkUploadState, action: BulkUploadAction): BulkUploadState {
  switch (action.type) {
    case "set-step":
      return { ...state, step: action.step };
    case "set-draft-id":
      return { ...state, draftId: action.draftId };
    case "add-uploads": {
      const next = [...state.uploads, ...action.uploads];
      // re-index so the order is always 0..n-1
      next.forEach((u, i) => {
        u.orderIndex = i;
      });
      return { ...state, uploads: next };
    }
    case "remove-uploads": {
      const removed = new Set(action.ids);
      const next = state.uploads.filter((u) => !removed.has(u.id));
      next.forEach((u, i) => {
        u.orderIndex = i;
      });
      return { ...state, uploads: next };
    }
    case "reorder-uploads": {
      const byId = new Map(state.uploads.map((u) => [u.id, u] as const));
      const next = action.ids
        .map((id) => byId.get(id))
        .filter((u): u is BulkUploadFile => !!u)
        .map((u, i) => ({ ...u, orderIndex: i }));
      // any uploads not in the requested order get appended in their
      // original order to be safe
      const seen = new Set(next.map((u) => u.id));
      for (const u of state.uploads) {
        if (!seen.has(u.id)) {
          next.push({ ...u, orderIndex: next.length });
        }
      }
      return { ...state, uploads: next };
    }
    case "update-upload": {
      const next = state.uploads.map((u) =>
        u.id === action.id ? { ...u, ...action.patch } : u,
      );
      return { ...state, uploads: next };
    }
    case "bulk-apply": {
      const targets = new Set(action.ids);
      const next = state.uploads.map((u) =>
        targets.has(u.id) ? { ...u, ...action.patch } : u,
      );
      return { ...state, uploads: next };
    }
    case "toggle-selected": {
      const next = state.uploads.map((u) =>
        u.id === action.id ? { ...u, selected: action.selected } : u,
      );
      return { ...state, uploads: next };
    }
    case "select-all": {
      const next = state.uploads.map((u) => ({ ...u, selected: action.selected }));
      return { ...state, uploads: next };
    }
    case "select-by-type": {
      const next = state.uploads.map((u) => ({
        ...u,
        selected: u.detectedType === action.detectedType,
      }));
      return { ...state, uploads: next };
    }
    case "set-strategy":
      return { ...state, strategy: action.strategy };
    default:
      return state;
  }
}

interface BulkUploadContextValue extends BulkUploadState {
  accounts: SocialAccountPublic[];
  dispatch: (action: BulkUploadAction) => void;
  selectedIds: string[];
  imageOnly: boolean;
}

const BulkUploadContext = createContext<BulkUploadContextValue | null>(null);

interface ProviderProps {
  companyId: string;
  accounts: SocialAccountPublic[];
  initial?: Partial<BulkUploadState>;
  children: ReactNode;
}

const INITIAL_STRATEGY_NULL: ScheduleStrategy | null = null;

export function BulkUploadProvider({
  companyId,
  accounts,
  initial,
  children,
}: ProviderProps) {
  const [state, dispatch] = useReducer(reducer, {
    companyId,
    draftId: initial?.draftId ?? null,
    step: initial?.step ?? "upload",
    uploads: initial?.uploads ?? [],
    strategy: initial?.strategy ?? INITIAL_STRATEGY_NULL,
  });

  const selectedIds = useMemo(
    () => state.uploads.filter((u) => u.selected).map((u) => u.id),
    [state.uploads],
  );

  const imageOnly = useMemo(
    () => state.uploads.length > 0 && state.uploads.every((u) => u.detectedType === "image"),
    [state.uploads],
  );

  const stableDispatch = useCallback((action: BulkUploadAction) => dispatch(action), []);

  const value = useMemo<BulkUploadContextValue>(
    () => ({
      ...state,
      accounts,
      dispatch: stableDispatch,
      selectedIds,
      imageOnly,
    }),
    [state, accounts, stableDispatch, selectedIds, imageOnly],
  );

  return (
    <BulkUploadContext.Provider value={value}>
      {children}
    </BulkUploadContext.Provider>
  );
}

export function useBulkUploadState(): BulkUploadContextValue {
  const ctx = useContext(BulkUploadContext);
  if (!ctx) {
    throw new Error("useBulkUploadState must be used inside <BulkUploadProvider>");
  }
  return ctx;
}

/** Exposed for tests: pure reducer, no React. */
export { reducer as bulkUploadReducer };
