import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const directory = new URL("../apps/worker/.wrangler/", import.meta.url);
const file = new URL("trial-secrets.json", directory);
await mkdir(directory, { recursive: true });
let secrets;
try { secrets = JSON.parse(await readFile(file, "utf8")); }
catch (error) {
  if (error.code !== "ENOENT") throw error;
  secrets = { TRIAL_CODE: randomBytes(18).toString("base64url") };
  await writeFile(file, JSON.stringify(secrets, null, 2) + "\n", { mode: 0o600, flag: "wx" });
}
if (typeof secrets.TRIAL_CODE !== "string" || secrets.TRIAL_CODE.length < 20) throw Error("Invalid trial secret file");
console.log("Trial secret is ready in apps/worker/.wrangler/trial-secrets.json (ignored by Git). Secret values are not printed.");
