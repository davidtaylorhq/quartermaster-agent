// Read the provider's credentials into an environment docker can pass on.
import { existsSync, readFileSync } from "node:fs";

export function load(file: string | undefined, into: NodeJS.ProcessEnv): string[] {
  if (!file || !existsSync(file)) return [];

  const names: string[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const at = line.indexOf("=");
    if (at <= 0) continue;
    const name = line.slice(0, at);
    into[name] = line.slice(at + 1);
    names.push(name);
  }
  return names;
}
