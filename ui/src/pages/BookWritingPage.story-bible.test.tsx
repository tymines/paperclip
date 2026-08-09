// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "co-1" }),
}));

import {
  CharacterCardComponent,
  LocationCardComponent,
  OverviewEditor,
  StyleCardComponent,
  type BookData,
  type CharacterEntity,
  type StyleEntity,
  type WorldLocationEntity,
} from "./BookWritingPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const timestamp = "2026-08-08T12:00:00.000Z";
const book: BookData = { id: "book-1", companyId: "co-1", slug: "book", title: "Book", metadata: {}, createdAt: timestamp, updatedAt: timestamp };
const character: CharacterEntity = { id: "char-1", bookId: book.id, name: "Hero", role: "lead", description: "", voiceCard: {}, locked: false, source: "authored", createdAt: timestamp, updatedAt: timestamp };
const location: WorldLocationEntity = { id: "loc-1", bookId: book.id, name: "Harbor", description: "", rules: {}, sensoryNotes: {}, locked: false, source: "authored", createdAt: timestamp, updatedAt: timestamp };
const style: StyleEntity = { id: "style-1", bookId: book.id, pov: "third", tense: "past", comps: "", sampleParagraph: "", bannedCliches: [], tropes: [], locked: false, source: "authored", createdAt: timestamp, updatedAt: timestamp };

describe("primary Story Bible edit actions", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("keeps labelled Edit actions visible for Overview, Characters, Locations, and Style", async () => {
    const onDelete = vi.fn();
    await act(async () => root.render(<div>
      <OverviewEditor book={book} loading={false} onUpdate={vi.fn(async () => book)} />
      <CharacterCardComponent char={character} bookId={book.id} companySlug="co-1" bookSlug="book" onUpdate={vi.fn(async () => character)} onDelete={onDelete} />
      <LocationCardComponent loc={location} bookId={book.id} companySlug="co-1" bookSlug="book" onUpdate={vi.fn(async () => location)} onDelete={onDelete} />
      <StyleCardComponent entry={style} bookId={book.id} companySlug="co-1" bookSlug="book" onUpdate={vi.fn(async () => style)} onDelete={onDelete} />
    </div>));

    const labels = [...host.querySelectorAll("button")].filter((button) => button.textContent?.trim() === "Edit");
    expect(labels).toHaveLength(4);
  });
});
