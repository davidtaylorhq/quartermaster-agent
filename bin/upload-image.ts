#!/usr/bin/env -S node --experimental-strip-types --no-warnings=ExperimentalWarning
import { readFileSync } from "node:fs";
import { uploadImage } from "../lib/upload-image.ts";

console.log(
  JSON.stringify(await uploadImage(JSON.parse(readFileSync(0, "utf8"))))
);
