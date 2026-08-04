import { PRODUCT_IDENTIFIERS } from "@paperclipai/shared/brand";

export type CliIdentity = keyof typeof PRODUCT_IDENTIFIERS;

let activeCliIdentity: CliIdentity = "compatibility";

export function selectCliIdentity(identity: CliIdentity): void {
  activeCliIdentity = identity;
}

export function getCliIdentity(): CliIdentity {
  return activeCliIdentity;
}

export function getCliProductIdentifiers() {
  return PRODUCT_IDENTIFIERS[activeCliIdentity];
}
