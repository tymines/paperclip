// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { usePersistedModel } from "./usePersistedModel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ personaId }: { personaId: string }) {
  const [model, setModel] = usePersistedModel(personaId, "persona_generate");
  return (
    <button type="button" data-model={model} onClick={() => setModel("changed") }>
      {model}
    </button>
  );
}

describe("usePersistedModel", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("loads the active persona/tool storage key when the persona changes", async () => {
    localStorage.setItem("image-studio:model:persona-a:persona_generate", "atlas-seedream");
    localStorage.setItem("image-studio:model:persona-b:persona_generate", "wave-flux");
    const root = createRoot(container);

    await act(async () => {
      root.render(<Harness personaId="persona-a" />);
    });
    expect(container.textContent).toBe("atlas-seedream");

    await act(async () => {
      root.render(<Harness personaId="persona-b" />);
    });
    expect(container.textContent).toBe("wave-flux");

    await act(async () => {
      container.querySelector("button")?.click();
    });
    expect(localStorage.getItem("image-studio:model:persona-b:persona_generate"))
      .toBe("changed");
    expect(localStorage.getItem("image-studio:model:persona-a:persona_generate"))
      .toBe("atlas-seedream");

    await act(async () => root.unmount());
  });
});
