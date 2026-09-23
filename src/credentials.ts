// The provider's credentials, on their way into the sandbox.
//
// They are passed to docker by name rather than by value, so they have to be
// in the environment of whoever calls it. The shell that built the sandbox had
// them and has since exited, which is a quiet way to send an agent to a model
// it cannot log in to.
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
