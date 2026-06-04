/**
 * StructuredControlPanel — renders one attribute control using the right UI
 * primitive for its control_type (toggle | slider | swatch | card_grid). The
 * GeneratePanel maps the catalog into a stack of these.
 *
 * Visual language (nicer-than-ZC): selected cards get an indigo glow ring + a
 * subtle scale pop (200ms ease); hover lifts + brightens the preview.
 */
import { useMemo } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { uploadUrl, type AttributeControl, type AttributeOption } from "@/api/imageStudio";

export interface ControlProps {
  control: AttributeControl;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  showExplicit: boolean;
  search?: string;
  /** Marks the value as coming from the persona default (not an explicit pick). */
  isDefault?: boolean;
}

/** Stable pastel gradient per option value, for cards without a preview image. */
function gradientFor(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) % 360;
  const h2 = (h + 40) % 360;
  return `linear-gradient(135deg, oklch(0.62 0.13 ${h}) 0%, oklch(0.55 0.14 ${h2}) 100%)`;
}

function visibleOptions(
  control: AttributeControl,
  showExplicit: boolean,
  search?: string,
): AttributeOption[] {
  const q = search?.trim().toLowerCase();
  return control.options.filter((o) => {
    if (!o.enabled) return false;
    if (!showExplicit && o.contentRating === "explicit") return false;
    if (q && !(`${o.label} ${o.value} ${control.label}`.toLowerCase().includes(q))) return false;
    return true;
  });
}

function ControlHeader({ control, isDefault }: { control: AttributeControl; isDefault?: boolean }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {control.label}
      </span>
      {isDefault && (
        <span className="rounded-full bg-muted px-1.5 py-px text-[9px] font-medium text-muted-foreground">
          default
        </span>
      )}
      {control.helperText && (
        <span className="text-[10px] text-muted-foreground/70">{control.helperText}</span>
      )}
    </div>
  );
}

/** card_grid — photo-preview cards. */
function CardGridControl({ control, value, onChange, showExplicit, search, isDefault }: ControlProps) {
  const opts = visibleOptions(control, showExplicit, search);
  if (opts.length === 0) return null;
  return (
    <div>
      <ControlHeader control={control} isDefault={isDefault} />
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {opts.map((o) => {
          const selected = o.value === value;
          return (
            <button
              key={o.id}
              type="button"
              data-testid={`opt-${control.key}-${o.value}`}
              aria-pressed={selected}
              onClick={() => onChange(selected ? undefined : o.value)}
              className={cn(
                "group relative aspect-[3/4] overflow-hidden rounded-lg border text-left transition-all duration-200",
                "hover:-translate-y-0.5 hover:shadow-md focus:outline-none",
                selected
                  ? "scale-[1.03] border-indigo-400 shadow-[0_0_0_3px_rgba(99,102,241,0.35)] dark:border-indigo-400"
                  : "border-border hover:border-indigo-300",
              )}
            >
              {o.previewImagePath ? (
                <img
                  src={uploadUrl(o.previewImagePath)}
                  alt={o.label}
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-105 group-hover:brightness-105"
                />
              ) : (
                <div
                  className="absolute inset-0 opacity-90 transition-transform duration-200 group-hover:scale-105"
                  style={{ background: gradientFor(o.value) }}
                />
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-4">
                <span className="text-[11px] font-medium leading-tight text-white drop-shadow">
                  {o.label}
                </span>
              </div>
              {o.contentRating === "explicit" && (
                <span className="absolute left-1 top-1 rounded bg-red-600/90 px-1 text-[8px] font-semibold text-white">
                  18+
                </span>
              )}
              {selected && (
                <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500 text-white shadow">
                  <Check className="h-2.5 w-2.5" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** swatch — compact chip row (lighting, colors). */
function SwatchControl({ control, value, onChange, showExplicit, search, isDefault }: ControlProps) {
  const opts = visibleOptions(control, showExplicit, search);
  if (opts.length === 0) return null;
  return (
    <div>
      <ControlHeader control={control} isDefault={isDefault} />
      <div className="flex flex-wrap gap-1.5">
        {opts.map((o) => {
          const selected = o.value === value;
          return (
            <button
              key={o.id}
              type="button"
              data-testid={`opt-${control.key}-${o.value}`}
              aria-pressed={selected}
              onClick={() => onChange(selected ? undefined : o.value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all duration-200",
                selected
                  ? "scale-[1.04] border-indigo-400 bg-indigo-500/10 text-indigo-700 shadow-[0_0_0_2px_rgba(99,102,241,0.3)] dark:text-indigo-300"
                  : "border-border bg-muted/40 text-muted-foreground hover:border-indigo-300 hover:bg-muted",
              )}
            >
              {o.previewImagePath ? (
                <img
                  src={uploadUrl(o.previewImagePath)}
                  alt=""
                  loading="lazy"
                  className="h-4 w-4 rounded-full object-cover ring-1 ring-black/10"
                />
              ) : (
                <span
                  className="h-2.5 w-2.5 rounded-full ring-1 ring-black/10"
                  style={{ background: gradientFor(o.value) }}
                />
              )}
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** toggle — 2-3 option segmented control. */
function ToggleControl({ control, value, onChange, showExplicit, search, isDefault }: ControlProps) {
  const opts = visibleOptions(control, showExplicit, search);
  if (opts.length === 0) return null;
  return (
    <div>
      <ControlHeader control={control} isDefault={isDefault} />
      <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
        {opts.map((o) => {
          const selected = o.value === value;
          return (
            <button
              key={o.id}
              type="button"
              data-testid={`opt-${control.key}-${o.value}`}
              aria-pressed={selected}
              onClick={() => onChange(o.value)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-all duration-200",
                selected
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** slider — option stops along a track (ordinal attributes). */
function SliderControl({ control, value, onChange, showExplicit, search, isDefault }: ControlProps) {
  const opts = visibleOptions(control, showExplicit, search);
  const idx = useMemo(() => Math.max(0, opts.findIndex((o) => o.value === value)), [opts, value]);
  if (opts.length === 0) return null;
  return (
    <div>
      <ControlHeader control={control} isDefault={isDefault} />
      <input
        type="range"
        min={0}
        max={opts.length - 1}
        step={1}
        value={idx === -1 ? 0 : idx}
        onChange={(e) => onChange(opts[Number(e.target.value)]?.value)}
        className="w-full accent-indigo-500"
        data-testid={`slider-${control.key}`}
      />
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        {opts.map((o) => (
          <span key={o.id} className={cn(o.value === value && "font-semibold text-indigo-600")}>
            {o.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function StructuredControlPanel(props: ControlProps) {
  switch (props.control.controlType) {
    case "swatch":
      return <SwatchControl {...props} />;
    case "toggle":
      return <ToggleControl {...props} />;
    case "slider":
      return <SliderControl {...props} />;
    case "card_grid":
    default:
      return <CardGridControl {...props} />;
  }
}
