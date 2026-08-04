import { selectCliIdentity } from "./cli-identity.js";

selectCliIdentity("canonical");

await import("./index.js");
