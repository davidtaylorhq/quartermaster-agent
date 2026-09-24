import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";

export function readOutput(name: string): string | undefined {
  let fd: number;
  try {
    // The container can create links and special files in its writable mount.
    fd = openSync(
      join(process.env.RUNNER_TEMP!, "output", name),
      // eslint-disable-next-line no-bitwise -- combine open flags
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  try {
    if (!fstatSync(fd).isFile()) {
      throw new Error(`${name} must be a regular file`);
    }
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}
