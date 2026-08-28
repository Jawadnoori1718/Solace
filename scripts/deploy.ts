/**
 * Solace — deploy the SolacePound token.
 *
 *   npm run deploy:local     # a local Hardhat node, for demo mode
 *   npm run deploy:testnet   # Base Sepolia, for the public explorer link
 *
 * The deployment is recorded in the local database rather than pasted into a
 * constants file. The dashboard reads the address from there, so it can never
 * end up pointing at a contract that was redeployed an hour before the
 * demonstration.
 *
 * Set SOLACE_SMOKE=1 to follow the deployment with a funded pot and one
 * settlement. That exercises the whole on-chain path and, on Base Sepolia,
 * leaves a genuine AllocationSettled event anybody can read on Basescan.
 */

import { network } from "hardhat";
import { keccak256, toHex } from "viem";

import { CHAINS, explorerAddressUrl, explorerTxUrl } from "../src/lib/config.ts";
import { prisma } from "../src/lib/db.ts";
import { ChainName } from "../src/lib/domain.ts";
import { loadEnvFiles } from "../src/lib/env-file.ts";
import { formatKwh, formatPence } from "../src/lib/format.ts";

loadEnvFiles();

/** Map a chain id to the name the rest of the system uses. */
function chainNameFor(chainId: number): ChainName {
  switch (chainId) {
    case CHAINS[ChainName.BASE_SEPOLIA].id:
      return ChainName.BASE_SEPOLIA;
    case CHAINS[ChainName.HARDHAT_LOCAL].id:
      return ChainName.HARDHAT_LOCAL;
    default:
      throw new Error(
        `Refusing to deploy to unrecognised chain id ${chainId}. Solace targets Base Sepolia (84532) or a local Hardhat node (31337).`,
      );
  }
}

// Smoke test constants. A throwaway pot, deliberately unrelated to the demo one.
const SMOKE_POT_REFERENCE = keccak256(toHex("SMOKE-TEST"));
const SMOKE_RECIPIENT_HASH = keccak256(toHex("SMOKE-RECIPIENT"));
const SMOKE_FUNDING_PENCE = 1_000n; // £10.00
const SMOKE_MILLI_KWH = 14_710n; // 14.71 kWh
const SMOKE_AMOUNT_PENCE = 412n; // £4.12

async function main(): Promise<void> {
  const { viem } = await network.getOrCreate();

  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  const chain = chainNameFor(chainId);
  const chainMeta = CHAINS[chain];

  const [deployer] = await viem.getWalletClients();
  if (deployer === undefined) {
    throw new Error(
      "No wallet is configured for this network. Set DEPLOYER_PRIVATE_KEY in .env.local.",
    );
  }

  const deployerAddress = deployer.account.address;
  const balance = await publicClient.getBalance({ address: deployerAddress });

  console.log(`\nDeploying SolacePound to ${chainMeta.label}`);
  console.log(`  Deployer  ${deployerAddress}`);
  console.log(`  Balance   ${balance} wei`);

  if (balance === 0n) {
    throw new Error(
      `The deployer has no funds on ${chainMeta.label}. Fund ${deployerAddress} from a Base Sepolia faucet and try again.`,
    );
  }

  // sendDeploymentTransaction rather than deployContract, so the deployment
  // transaction hash is available to record and to link to.
  const { contract: token, deploymentTransaction } =
    await viem.sendDeploymentTransaction("SolacePound", [deployerAddress]);

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: deploymentTransaction.hash,
  });

  if (receipt.status !== "success") {
    throw new Error(
      `Deployment transaction ${deploymentTransaction.hash} did not succeed.`,
    );
  }

  const address = token.address;
  const deployTxHash = deploymentTransaction.hash;
  const blockNumber = Number(receipt.blockNumber);

  // Read the contract back rather than trusting the deployment did what it was
  // meant to. A deployment that succeeded but produced the wrong contract
  // should fail here, not on stage.
  const [name, symbol, decimals, ownerIsSettler] = await Promise.all([
    token.read.name(),
    token.read.symbol(),
    token.read.decimals(),
    token.read.isSettler([deployerAddress]),
  ]);

  if (name !== "SolacePound" || symbol !== "SLP" || decimals !== 2) {
    throw new Error(
      `Deployed contract does not look like SolacePound: name=${name} symbol=${symbol} decimals=${decimals}`,
    );
  }
  if (!ownerIsSettler) {
    throw new Error("Deployed contract did not authorise the deployer to settle.");
  }

  await prisma.contractDeployment.upsert({
    where: { chain_name: { chain, name: "SolacePound" } },
    create: {
      id: `deploy_${chain.toLowerCase()}_solacepound`,
      chain,
      name: "SolacePound",
      address,
      deployTxHash,
      blockNumber,
      explorerUrl: explorerAddressUrl(chain, address),
      deployedAt: new Date(),
    },
    update: {
      address,
      deployTxHash,
      blockNumber,
      explorerUrl: explorerAddressUrl(chain, address),
      deployedAt: new Date(),
    },
  });

  console.log(`\n  Deployed`);
  console.log(`  Address   ${address}`);
  console.log(`  Tx        ${deployTxHash}`);
  console.log(`  Block     ${blockNumber}`);
  console.log(`  Token     ${name} (${symbol}), ${decimals} decimals`);

  const addressUrl = explorerAddressUrl(chain, address);
  const deployTxUrl = explorerTxUrl(chain, deployTxHash);
  if (addressUrl !== null) console.log(`  Explorer  ${addressUrl}`);
  if (deployTxUrl !== null) console.log(`  Deploy tx ${deployTxUrl}`);

  if (process.env.SOLACE_SMOKE === "1") {
    console.log(`\n  Smoke test`);

    // Fund the pot into the deployer's own balance, so it has tokens to settle
    // from. In the real flow this is the council treasury.
    const fundHash = await token.write.fundPot([
      SMOKE_POT_REFERENCE,
      deployerAddress,
      SMOKE_FUNDING_PENCE,
      "SMOKE/TEST",
    ]);
    await publicClient.waitForTransactionReceipt({ hash: fundHash });
    console.log(`  Funded    ${formatPence(Number(SMOKE_FUNDING_PENCE))}`);

    const settleHash = await token.write.settle([
      SMOKE_POT_REFERENCE,
      SMOKE_RECIPIENT_HASH,
      SMOKE_MILLI_KWH,
      SMOKE_AMOUNT_PENCE,
    ]);
    await publicClient.waitForTransactionReceipt({ hash: settleHash });

    const remaining = await token.read.potBalancePence([SMOKE_POT_REFERENCE]);
    const marker = await token.read.markerAddress([SMOKE_RECIPIENT_HASH]);
    const markerBalance = await token.read.balanceOf([marker]);

    console.log(
      `  Settled   ${formatKwh(Number(SMOKE_MILLI_KWH) / 1000)} for ${formatPence(
        Number(SMOKE_AMOUNT_PENCE),
      )}`,
    );
    console.log(`  Recipient ${formatPence(Number(markerBalance))} credited`);
    console.log(`  Remaining ${formatPence(Number(remaining))} in pot`);

    const settleTxUrl = explorerTxUrl(chain, settleHash);
    console.log(`  Settle tx ${settleTxUrl ?? settleHash}`);
  }

  console.log("");
}

try {
  await main();
} catch (error) {
  // A deploy script that dies with a raw stack trace teaches nobody anything.
  console.error(
    `\nDeployment failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
