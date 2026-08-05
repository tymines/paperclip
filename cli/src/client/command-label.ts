import { getCliProductIdentifiers } from "../cli-identity.js";

export function buildCliCommandLabel(): string {
  const cliName = getCliProductIdentifiers().cli;
  const args = process.argv.slice(2);
  return args.length > 0 ? `${cliName} ${args.join(" ")}` : cliName;
}
