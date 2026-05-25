import { describe, expect, it } from "vitest";
import {
  bulkUploadReducer,
  type BulkUploadFile,
  type BulkUploadState,
} from "./state";

function makeFile(id: string, overrides: Partial<BulkUploadFile> = {}): BulkUploadFile {
  return {
    id,
    filename: `${id}.jpg`,
    mimeType: "image/jpeg",
    sizeBytes: 1024,
    storageKey: `co/social/bulk/${id}.jpg`,
    thumbnailKey: null,
    detectedType: "image",
    orderIndex: 0,
    caption: null,
    hashtags: [],
    platforms: [],
    aiSuggestedCaption: null,
    selected: false,
    uploadProgress: null,
    uploadError: null,
    ...overrides,
  };
}

function makeState(uploads: BulkUploadFile[] = []): BulkUploadState {
  return {
    companyId: "co-1",
    draftId: null,
    step: "upload",
    uploads,
    strategy: null,
  };
}

describe("bulkUploadReducer", () => {
  it("add-uploads re-indexes orderIndex from 0", () => {
    const state = makeState([makeFile("a", { orderIndex: 0 })]);
    const next = bulkUploadReducer(state, {
      type: "add-uploads",
      uploads: [makeFile("b"), makeFile("c")],
    });
    expect(next.uploads.map((u) => u.id)).toEqual(["a", "b", "c"]);
    expect(next.uploads.map((u) => u.orderIndex)).toEqual([0, 1, 2]);
  });

  it("remove-uploads filters out the requested ids and re-indexes the rest", () => {
    const state = makeState([
      makeFile("a", { orderIndex: 0 }),
      makeFile("b", { orderIndex: 1 }),
      makeFile("c", { orderIndex: 2 }),
    ]);
    const next = bulkUploadReducer(state, { type: "remove-uploads", ids: ["b"] });
    expect(next.uploads.map((u) => u.id)).toEqual(["a", "c"]);
    expect(next.uploads.map((u) => u.orderIndex)).toEqual([0, 1]);
  });

  it("reorder-uploads applies the requested order and re-indexes", () => {
    const state = makeState([
      makeFile("a"),
      makeFile("b"),
      makeFile("c"),
    ]);
    const next = bulkUploadReducer(state, {
      type: "reorder-uploads",
      ids: ["c", "a", "b"],
    });
    expect(next.uploads.map((u) => u.id)).toEqual(["c", "a", "b"]);
    expect(next.uploads.map((u) => u.orderIndex)).toEqual([0, 1, 2]);
  });

  it("reorder-uploads gracefully appends any uploads the caller forgot to mention", () => {
    const state = makeState([
      makeFile("a"),
      makeFile("b"),
      makeFile("c"),
    ]);
    const next = bulkUploadReducer(state, {
      type: "reorder-uploads",
      ids: ["b"], // forgot a and c
    });
    expect(next.uploads.map((u) => u.id)).toEqual(["b", "a", "c"]);
  });

  it("update-upload patches only the targeted file", () => {
    const state = makeState([makeFile("a"), makeFile("b")]);
    const next = bulkUploadReducer(state, {
      type: "update-upload",
      id: "b",
      patch: { caption: "Hi" },
    });
    expect(next.uploads.find((u) => u.id === "b")?.caption).toBe("Hi");
    expect(next.uploads.find((u) => u.id === "a")?.caption).toBeNull();
  });

  it("bulk-apply patches every targeted file", () => {
    const state = makeState([makeFile("a"), makeFile("b"), makeFile("c")]);
    const next = bulkUploadReducer(state, {
      type: "bulk-apply",
      ids: ["a", "c"],
      patch: { platforms: ["instagram", "threads"] },
    });
    expect(next.uploads.find((u) => u.id === "a")?.platforms).toEqual(["instagram", "threads"]);
    expect(next.uploads.find((u) => u.id === "b")?.platforms).toEqual([]);
    expect(next.uploads.find((u) => u.id === "c")?.platforms).toEqual(["instagram", "threads"]);
  });

  it("select-all toggles selection on every upload", () => {
    const state = makeState([makeFile("a"), makeFile("b")]);
    const next = bulkUploadReducer(state, { type: "select-all", selected: true });
    expect(next.uploads.every((u) => u.selected)).toBe(true);
    const back = bulkUploadReducer(next, { type: "select-all", selected: false });
    expect(back.uploads.every((u) => !u.selected)).toBe(true);
  });

  it("select-by-type only selects rows of that type", () => {
    const state = makeState([
      makeFile("a", { detectedType: "image" }),
      makeFile("b", { detectedType: "video" }),
      makeFile("c", { detectedType: "image" }),
    ]);
    const next = bulkUploadReducer(state, {
      type: "select-by-type",
      detectedType: "image",
    });
    expect(next.uploads.find((u) => u.id === "a")?.selected).toBe(true);
    expect(next.uploads.find((u) => u.id === "b")?.selected).toBe(false);
    expect(next.uploads.find((u) => u.id === "c")?.selected).toBe(true);
  });

  it("set-step changes the active wizard step", () => {
    const state = makeState();
    expect(state.step).toBe("upload");
    const next = bulkUploadReducer(state, { type: "set-step", step: "schedule" });
    expect(next.step).toBe("schedule");
  });
});
