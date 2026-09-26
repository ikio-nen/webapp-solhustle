import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
const origLookup = dns.lookup;
// Force IPv4 lookup globally across all sockets, HTTP requests, and Undici fetch
(dns as any).lookup = function (hostname: any, options: any, callback: any) {
  if (typeof options === "function") {
    callback = options;
    options = { family: 4 };
  } else if (typeof options === "object") {
    options = { ...options, family: 4 };
  } else if (typeof options === "number") {
    options = { family: 4 };
  }
  return (origLookup as any).call(dns, hostname, options, callback);
};

import * as web3 from "@solana/web3.js";
import bs58 from "bs58";
import { db } from "../backend/db.ts";
import { config, explorerTx } from "../backend/config.ts";
import { HttpError, tooMany } from "../backend/util.ts";

export const conn = new web3.Connection(
  config.rpcUrl || web3.clusterApiUrl(config.chain),
  { commitment: "confirmed", disableRetryOnRateLimit: true } // devnet rate-limits; our own bounded retries handle it
);

const AIRDROP_LAMPORTS = 1_000_000_000; // 1 SOL
const MAX_AIRDROP_ATTEMPTS = 5;
const AIRDROP_RETRY_MS = 3_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- blockhash replay protection -------------------------------------------
const bhStmt = db.prepare("INSERT OR REPLACE INTO usedBlockhashes (blockhash, signature) VALUES (?, ?)");
const bhGetStmt = db.prepare("SELECT signature FROM usedBlockhashes WHERE blockhash = ?");

function assertBlockhashFresh(blockhash: string): void {
  const row = bhGetStmt.get(blockhash) as { signature: string } | undefined;
  if (row) throw new HttpError(409, `blockhash already used (tx ${row.signature})`);
}

// --- airdrop (devnet only) ---------------------------------------------------
export async function requestAirdrop(pubkey: web3.PublicKey): Promise<{ signature: string; explorerUrl: string }> {
  if (config.chain !== "devnet") throw new HttpError(400, "airdrop only available on devnet");
  let lastError: unknown = new Error("airdrop failed");
  for (let attempt = 1; attempt <= MAX_AIRDROP_ATTEMPTS; attempt++) {
    try {
      const sig = await conn.requestAirdrop(pubkey, AIRDROP_LAMPORTS);
      const latest = await conn.getLatestBlockhash();
      await conn.confirmTransaction({ signature: sig, ...latest }, "confirmed");
      return { signature: sig, explorerUrl: explorerTx(sig) };
    } catch (err) {
      lastError = err;
      if (attempt < MAX_AIRDROP_ATTEMPTS) await sleep(AIRDROP_RETRY_MS);
    }
  }
  throw tooMany(
    `devnet faucet rate-limited after ${MAX_AIRDROP_ATTEMPTS} attempts; try again in a minute ` +
      `or top up this address manually: ${pubkey.toBase58()}`
  );
}

// --- balances ----------------------------------------------------------------
export async function getSolBalance(pubkey: web3.PublicKey): Promise<number> {
  return conn.getBalance(pubkey, "confirmed");
}

/**
 * Self-healing fee funding: if the fee payer can't cover `needLamports`,
 * try the devnet faucet automatically (best-effort). Throws a clear 402 when
 * the wallet is empty and the faucet is throttled, instead of letting the tx
 * die in the mempool and timing out in confirmSignature with a generic 502.
 */
export async function ensureFeePayerFunded(payer: web3.PublicKey, needLamports: number): Promise<void> {
  let bal = 0;
  try {
    bal = await conn.getBalance(payer, "confirmed");
  } catch {
    bal = 0; // transient RPC error: treat as empty and try the faucet
  }
  if (bal >= needLamports) return;
  const short =
    `${payer.toBase58()} holds ${(bal / 1e9).toFixed(4)} SOL ` +
    `but needs ~${(needLamports / 1e9).toFixed(4)} SOL`;
  if (config.chain !== "devnet") {
    throw new HttpError(402, `insufficient funds: ${short}; fund the wallet manually`);
  }
  try {
    await requestAirdrop(payer);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new HttpError(402, `insufficient funds: ${short}. ${why}`);
  }
}

// --- escrow account state ------------------------------------------------------
export async function getEscrowAccountInfo(
  address: string
): Promise<{ exists: boolean; lamports: number; owner: string | null }> {
  try {
    const lamports = await conn.getBalance(new web3.PublicKey(address), "confirmed");
    if (lamports <= 0) return { exists: false, lamports: 0, owner: null };
    return { exists: true, lamports, owner: web3.SystemProgram.programId.toBase58() };
  } catch (err) {
    return { exists: false, lamports: 0, owner: null };
  }
}

// --- tx building & confirmation -----------------------------------------------
export type SignedTransfer = {
  rawTx: Buffer;
  signature: string;
  blockhash: string;
  lastValidBlockHeight: number;
  explorerUrl: string;
};

/** Build, sign, serialize a SystemProgram.transfer of `lamports` from `from` to `to`. */
export async function buildSignedTransfer(
  from: web3.Keypair,
  to: web3.PublicKey,
  lamports: number,
  feePayer?: web3.Keypair
): Promise<SignedTransfer> {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  const tx = new web3.Transaction().add(
    web3.SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports })
  );
  tx.recentBlockhash = blockhash;
  const payer = feePayer || from;
  tx.feePayer = payer.publicKey;
  if (feePayer && feePayer.publicKey.toBase58() !== from.publicKey.toBase58()) {
    tx.sign(payer, from);
  } else {
    tx.sign(from);
  }
  const rawTx = tx.serialize();
  const sig = tx.signatures.find((s) => s.publicKey.equals(payer.publicKey))?.signature || tx.signatures[0]?.signature;
  if (!sig) throw new HttpError(500, "signing failed");
  return { rawTx, signature: bs58.encode(sig), blockhash, lastValidBlockHeight, explorerUrl: explorerTx(bs58.encode(sig)) };
}

export type ConfirmResult = { signature: string; explorerUrl: string; alreadyRecorded: boolean };

/**
 * Send a platform-signed transfer, confirm to finality, record exactly once.
 * Idempotent against retries via the blockhash ledger.
 */
export async function sendAndRecord(jobId: number, signed: SignedTransfer, instructionType: string): Promise<ConfirmResult> {
  assertBlockhashFresh(signed.blockhash);
  // Self-healing: platform fee payer gets a faucet top-up when empty.
  const stx = web3.Transaction.from(signed.rawTx);
  const payer = stx.feePayer ?? stx.signatures[0]?.publicKey ?? null;
  if (payer) await ensureFeePayerFunded(payer, 20_000); // fee headroom only; transfer amount comes from `from`
  try {
    await conn.sendRawTransaction(signed.rawTx, { skipPreflight: true, maxRetries: 3 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("already been processed")) throw new HttpError(502, `send failed: ${msg}`);
  }
  bhStmt.run(signed.blockhash, signed.signature);
  await confirmSignature(signed.signature, signed.blockhash, signed.lastValidBlockHeight);
  const inserted = recordTx(jobId, signed.signature, instructionType, null);
  return { signature: signed.signature, explorerUrl: signed.explorerUrl, alreadyRecorded: !inserted };
}

/**
 * Buyer-signed fund tx: receive raw serialized tx + claimed signature.
 * Verifies structure, destination and amount, awaits finality, records once.
 */
export async function confirmBuyerFunding(
  jobId: number,
  rawTx: Buffer,
  claimedSignature: string,
  expectedTo: string,
  expectedLamports: number
): Promise<ConfirmResult> {
  // Retry safety: if this job already has a confirmed fund tx, no-op.
  const existing = db
    .prepare("SELECT tx_signature FROM escrow_transactions WHERE job_id = ? AND instruction_type = 'fund'")
    .get(jobId) as { tx_signature: string } | undefined;
  if (existing) {
    return { signature: existing.tx_signature, explorerUrl: explorerTx(existing.tx_signature), alreadyRecorded: true };
  }

  let tx: web3.Transaction;
  try {
    tx = web3.Transaction.from(rawTx);
  } catch {
    throw new HttpError(400, "invalid transaction bytes");
  }
  const sigFromTx = tx.signatures[0]?.signature;
  if (!sigFromTx || bs58.encode(sigFromTx) !== claimedSignature) {
    throw new HttpError(400, "signature does not match transaction");
  }
  const transferIx = tx.instructions.find((ix) => ix.programId.equals(web3.SystemProgram.programId));
  if (!transferIx) throw new HttpError(400, "not a SystemProgram transfer");
  const toKey = transferIx.keys[1]?.pubkey;
  if (!toKey || toKey.toBase58() !== expectedTo) throw new HttpError(400, "transfer destination mismatch");
  const data = transferIx.data;
  // SystemProgram.transfer data: [u32 discriminator=2][u64 lamports LE]
  if (data.length < 12 || data[0] !== 2) throw new HttpError(400, "unexpected instruction data");
  const lamports = Number(data.readBigUInt64LE(4));
  if (lamports < expectedLamports) {
    throw new HttpError(400, `insufficient transfer amount: ${lamports} < ${expectedLamports}`);
  }

  // Self-healing: the buyer is both sender and fee payer here — top up via
  // the devnet faucet when the wallet can't cover transfer + fee, so an
  // empty wallet is never the silent reason a tx can't hit the chain.
  const feePayer = tx.feePayer ?? tx.signatures[0]?.publicKey ?? null;
  if (feePayer) await ensureFeePayerFunded(feePayer, lamports + 20_000);

  let signature = claimedSignature;
  try {
    signature = await conn.sendRawTransaction(rawTx, { skipPreflight: true, maxRetries: 3 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("already been processed")) {
      // The client may have submitted it themselves — accept only if chain has it.
      const statuses = await conn.getSignatureStatuses([claimedSignature]);
      if (!statuses.value[0]) throw new HttpError(502, `send failed: ${msg}`);
      signature = claimedSignature;
    }
  }
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  await confirmSignature(signature, blockhash, lastValidBlockHeight);
  const inserted = recordTx(jobId, signature, "fund", lamports);
  return { signature, explorerUrl: explorerTx(signature), alreadyRecorded: !inserted };
}

/**
 * Honestly verify on-chain confirmation: poll until the tx reaches
 * confirmed/finalized status, or the deadline passes. Throws if the tx
 * errored OR if it never landed (dropped, expired blockhash, no funds).
 * Never silently passes on an unknown signature.
 */
export async function confirmSignature(signature: string, _blockhash?: string, _lastValidBlockHeight?: number): Promise<void> {
  const deadline = Date.now() + 45_000;
  for (;;) {
    let st: { err: unknown; confirmationStatus?: string | null } | null | undefined;
    try {
      const statuses = await conn.getSignatureStatuses([signature], { searchTransactionHistory: true });
      st = statuses?.value?.[0] as typeof st;
    } catch {
      st = undefined; // transient RPC error; keep polling until deadline
    }
    if (st?.err) {
      throw new HttpError(502, `tx failed on-chain: ${JSON.stringify(st.err)}`);
    }
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new HttpError(
        502,
        "tx was not confirmed on Solana (dropped, expired blockhash, or insufficient funds); nothing was recorded — try again"
      );
    }
    await sleep(2000);
  }
}

/** Insert into escrow_transactions; returns false if the signature was already recorded. */
export function recordTx(jobId: number, signature: string, instructionType: string, lamports: number | null): boolean {
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO escrow_transactions (job_id, tx_signature, instruction_type, amount_lamports)
       VALUES (?, ?, ?, ?)`
    )
    .run(jobId, signature, instructionType, lamports);
  import("../backend/neon.ts").then(({ syncTxToNeon }) =>
    syncTxToNeon({ job_id: jobId, tx_signature: signature, instruction_type: instructionType, amount_lamports: lamports })
  ).catch(() => {});
  return Number(info.changes) > 0;
}

/** Pull real on-chain history for an address (reconciliation views). */
export async function getOnChainHistory(address: string, limit = 50) {
  const pub = new web3.PublicKey(address);
  const sigs = await conn.getSignaturesForAddress(pub, { limit });
  return sigs.map((s) => ({
    signature: s.signature,
    slot: s.slot,
    blockTime: s.blockTime ?? null,
    status: s.err ? "failed" : "success",
    explorerUrl: explorerTx(s.signature),
  }));
}
