declare module "troika-three-text" {
  import { Mesh } from "three";

  export class Text extends Mesh {
    text: string;
    font?: string;
    fontSize?: number;
    fontWeight?: number | string;
    fontStyle?: "normal" | "italic";
    color?: number | string;
    anchorX?: string | number;
    anchorY?: string | number;
    outlineWidth?: number | string;
    outlineColor?: number | string;
    outlineOpacity?: number;
    outlineBlur?: number | string;
    depthOffset?: number;
    maxWidth?: number;
    overflowWrap?: "normal" | "break-word";
    whiteSpace?: "normal" | "nowrap";
    textAlign?: "left" | "right" | "center" | "justify";
    sync(callback?: () => void): void;
    dispose(): void;
  }

  export function preloadFont(
    opts: { font?: string; characters?: string },
    callback: () => void,
  ): void;
}
