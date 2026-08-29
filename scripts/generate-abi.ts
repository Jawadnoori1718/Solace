/**
 * Solace — export the compiled contract ABI into committed source.
 *
 *   npm run contracts:abi
 *
 * The Hardhat artifacts directory is a build output and is not committed, but
 * the dashboard needs the ABI at runtime. Rather than have the application read
 * from a directory that may not exist on a fresh clone, the ABI is written into
 * `src/lib/chain/` as ordinary TypeScript and committed.
 *
 * A test checks the committed copy still matches the compiled contract, so the
 * two cannot drift apart silently.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const ARTIFACT = path.join(
  process.cwd(),
  "artifacts",
  "contracts",
  "SolacePound.sol",
  "SolacePound.json",
);

const OUTPUT = path.join(
  process.cwd(),
  "src",
  "lib",
  "chain",
  "solace-pound-abi.ts",
);

const artifact = JSON.parse(readFileSync(ARTIFACT, "utf8")) as {
  abi: unknown[];
};

const contents = `/**
 * Solace — the SolacePound ABI.
 *
 * GENERATED FILE. Do not edit by hand.
 * Regenerate with \`npm run contracts:abi\` after changing the contract.
 *
 * Committed rather than read from the Hardhat artifacts directory, which is a
 * build output and is not in the repository. The dashboard needs this at
 * runtime on a fresh clone.
 */

export const SOLACE_POUND_ABI = ${JSON.stringify(artifact.abi, null, 2)} as const;
`;

mkdirSync(path.dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, contents, "utf8");

console.log(
  `Wrote ${artifact.abi.length} ABI entries to src/lib/chain/solace-pound-abi.ts`,
);
