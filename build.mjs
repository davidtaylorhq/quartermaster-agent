// Every script is bundled with what it needs, so a run installs nothing.
import { build } from "esbuild";
import { readdirSync } from "node:fs";

const entries = readdirSync("src").filter((f) => f.endsWith(".ts"));

await build({
  entryPoints: entries.map((f) => `src/${f}`),
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "info",
});
