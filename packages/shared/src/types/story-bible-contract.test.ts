import { describe, expectTypeOf, it } from "vitest";
import type { StoryBibleOutlineCreateInput, StoryBibleOutlineUpdateInput } from "./story-bible.js";

describe("Story Bible outline type contract", () => {
  it("keeps revision authorization on updates only", () => {
    expectTypeOf<StoryBibleOutlineCreateInput>().not.toHaveProperty("expectedRevision");
    expectTypeOf<StoryBibleOutlineUpdateInput>().toHaveProperty("expectedRevision").toEqualTypeOf<number>();

    const create: StoryBibleOutlineCreateInput = { chapterNumber: 1, title: "Opening" };
    const update: StoryBibleOutlineUpdateInput = { title: "Revised", expectedRevision: 3 };
    expectTypeOf(create).toMatchTypeOf<StoryBibleOutlineCreateInput>();
    expectTypeOf(update).toMatchTypeOf<StoryBibleOutlineUpdateInput>();

    // @ts-expect-error update authorization is mandatory
    const missingRevision: StoryBibleOutlineUpdateInput = { title: "Unsafe" };
    void missingRevision;
  });
});
