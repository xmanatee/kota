import { checkRepoHygiene } from "#modules/autonomy/hygiene-check.js";

try {
  console.log(checkRepoHygiene(process.cwd()));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
