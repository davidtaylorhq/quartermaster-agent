// Everything a run leaves for its later steps sits in the runner's temp dir.
import { join } from "node:path";

export function scratch(name: string): string {
  return join(process.env.RUNNER_TEMP ?? "/tmp", name);
}
