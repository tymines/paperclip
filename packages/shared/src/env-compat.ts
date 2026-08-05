import { PRODUCT_IDENTIFIERS } from "./brand.js";

export type BrandEnvironment = Readonly<Record<string, string | undefined>>;
export type BrandEnvParser<T> = (rawValue: string) => T | undefined;

export interface BrandEnvReadOptions<T> {
  suffix: string;
  parseOlympus: BrandEnvParser<T>;
  parsePaperclip: BrandEnvParser<T>;
}

export type BrandEnvReader = <T>(options: BrandEnvReadOptions<T>) => T | undefined;

export interface BrandEnvReaderFactoryOptions {
  getEnv: () => BrandEnvironment;
  warn?: (message: string) => void;
}

function readNonempty(env: BrandEnvironment, key: string): string | undefined {
  const value = env[key];
  return value !== undefined && value.trim().length > 0 ? value : undefined;
}

export function createBrandEnvReader({
  getEnv,
  warn = (message) => console.warn(message),
}: BrandEnvReaderFactoryOptions): BrandEnvReader {
  const warnedSuffixes = new Set<string>();

  return <T>({
    suffix,
    parseOlympus,
    parsePaperclip,
  }: BrandEnvReadOptions<T>): T | undefined => {
    const env = getEnv();
    const olympusKey = `${PRODUCT_IDENTIFIERS.canonical.environmentPrefix}${suffix}`;
    const paperclipKey = `${PRODUCT_IDENTIFIERS.compatibility.environmentPrefix}${suffix}`;
    const olympusRaw = readNonempty(env, olympusKey);
    const paperclipRaw = readNonempty(env, paperclipKey);
    const olympusValue = olympusRaw === undefined ? undefined : parseOlympus(olympusRaw);
    const paperclipValue = paperclipRaw === undefined ? undefined : parsePaperclip(paperclipRaw);

    if (
      olympusRaw !== undefined &&
      paperclipRaw !== undefined &&
      olympusRaw !== paperclipRaw &&
      !warnedSuffixes.has(suffix)
    ) {
      warnedSuffixes.add(suffix);
      const selection = olympusValue !== undefined
        ? "using the Olympus key"
        : paperclipValue !== undefined
          ? "using the Paperclip compatibility key because the Olympus value is invalid"
          : "ignoring both keys because neither value is valid";
      warn(`Environment conflict between ${olympusKey} and ${paperclipKey}; ${selection}.`);
    }

    return olympusValue !== undefined ? olympusValue : paperclipValue;
  };
}
