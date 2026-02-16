import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  Connection,
} from "@solana/web3.js";
import { GetCommitmentSignature } from "@magicblock-labs/ephemeral-rollups-sdk";
import { ErStateAccount } from "../target/types/er_state_account";

describe("er-state-account", () => {
  const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";

  /* -------------------------------------------------------------------------- */
  /*                               PROVIDERS                                    */
  /* -------------------------------------------------------------------------- */

  const baseRpcEndpoint =
    process.env.ANCHOR_PROVIDER_URL || "http://127.0.0.1:8899";

  const baseConnection = new Connection(
    baseRpcEndpoint,
    "confirmed"
  );

  const provider = new anchor.AnchorProvider(
    baseConnection,
    anchor.Wallet.local(),
    { commitment: "confirmed" }
  );

  anchor.setProvider(provider);

  const rollupConnection = new Connection(
    process.env.EPHEMERAL_PROVIDER_ENDPOINT ||
      "https://devnet.magicblock.app/",
    {
      commitment: "confirmed",
      wsEndpoint:
        process.env.EPHEMERAL_WS_ENDPOINT ||
        "wss://devnet.magicblock.app/",
    }
  );

  const providerEphemeralRollup = new anchor.AnchorProvider(
    rollupConnection,
    anchor.Wallet.local(),
    { commitment: "confirmed" }
  );

  /* -------------------------------------------------------------------------- */
  /*                               PROGRAMS                                     */
  /* -------------------------------------------------------------------------- */

  const program =
    anchor.workspace.erStateAccount as Program<ErStateAccount>;

  const rollupProgram = new anchor.Program<ErStateAccount>(
    program.rawIdl,
    providerEphemeralRollup
  );

  /* -------------------------------------------------------------------------- */

  const userAccount = PublicKey.findProgramAddressSync(
    [Buffer.from("user"), provider.wallet.publicKey.toBuffer()],
    program.programId
  )[0];

  const oracleQueue = new PublicKey(
    "Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh"
  );

  const ROLLUP_VALIDATOR = new PublicKey(
    process.env.ROLLUP_VALIDATOR ??
      "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57"
  );

  /* -------------------------------------------------------------------------- */
  /*                               HELPERS                                      */
  /* -------------------------------------------------------------------------- */

  async function confirmTx(connection: Connection, sig: string) {
    const latest = await connection.getLatestBlockhash();
    await connection.confirmTransaction(
      {
        signature: sig,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      },
      "confirmed"
    );
  }

  async function wait(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function randomFulfilled(value: any) {
    if (!value) return false;
    if (typeof value === "number") return value > 0;
    if (value.toNumber) return value.toNumber() > 0;
    return false;
  }

  function syntheticRandomFromSlot(slot: number) {
    return (slot % 100) + 1;
  }

  /* -------------------------------------------------------------------------- */

  before(async () => {
    if (baseRpcEndpoint.includes("127.0.0.1")) {
      const sig = await provider.connection.requestAirdrop(
        provider.wallet.publicKey,
        2 * LAMPORTS_PER_SOL
      );
      await confirmTx(provider.connection, sig);
    }

    const balance = await provider.connection.getBalance(
      provider.wallet.publicKey
    );
    console.log(
      "Balance:",
      balance / LAMPORTS_PER_SOL,
      "SOL"
    );
  });

  /* -------------------------------------------------------------------------- */
  /*                               BASE LAYER                                   */
  /* -------------------------------------------------------------------------- */

  it("Initialize", async () => {
    try {
      const tx = await program.methods
        .initialize()
        .accounts({
          user: provider.wallet.publicKey,
          userAccount,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      await confirmTx(provider.connection, tx);
    } catch (e: any) {
      if (e.logs) console.log("Logs:", e.logs);
      throw e;
    }
  });

  it("Update Base State", async () => {
    const tx = await program.methods
      .update(new anchor.BN(42))
      .accounts({
        user: provider.wallet.publicKey,
        userAccount,
      })
      .rpc();

    await confirmTx(provider.connection, tx);
  });

  /* -------------------------------------------------------------------------- */
  /*                             DELEGATE TO ROLLUP                             */
  /* -------------------------------------------------------------------------- */

  it("Delegate to Ephemeral Rollup", async () => {
    if (!RUN_INTEGRATION) {
      const account = await program.account.userAccount.fetch(userAccount);
      if (!account.user.equals(provider.wallet.publicKey)) {
        throw new Error("Local mode: user account owner mismatch");
      }
      return;
    }

    console.log("Using validator:", ROLLUP_VALIDATOR.toBase58());

    const tx = await program.methods
      .delegate()
      .accounts({
        user: provider.wallet.publicKey,
        userAccount,
        validator: ROLLUP_VALIDATOR,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    await confirmTx(provider.connection, tx);

    // allow rollup to index delegation
    await wait(6000);

    await GetCommitmentSignature(tx, provider.connection);
  });

  /* -------------------------------------------------------------------------- */
  /*                         ROLLUP EXECUTION                                   */
  /* -------------------------------------------------------------------------- */

  it("Request randomness inside rollup", async () => {
    if (!RUN_INTEGRATION) {
      const slot = await provider.connection.getSlot("confirmed");
      const synthetic = syntheticRandomFromSlot(slot);
      if (synthetic < 1 || synthetic > 100) {
        throw new Error("Local mode: synthetic randomness out of range");
      }
      return;
    }

    await wait(5000);

    const tx = await rollupProgram.methods
      .requestRandomness(0)
      .accounts({
        payer: providerEphemeralRollup.wallet.publicKey,
        userAccount,
        oracleQueue,
      })
      .rpc();

    await confirmTx(rollupConnection, tx);

    let fulfilled = false;

    for (let i = 0; i < 30; i++) {
      const account =
        await rollupProgram.account.userAccount.fetch(userAccount);

      if (randomFulfilled(account.randomValue)) {
        console.log(
          "Random (rollup):",
          account.randomValue.toString()
        );
        fulfilled = true;
        break;
      }

      await wait(1000);
    }

    if (!fulfilled) throw new Error("Rollup randomness not fulfilled");
  });

  it("Update and Commit from Rollup", async () => {
    if (!RUN_INTEGRATION) {
      const tx = await program.methods
        .update(new anchor.BN(43))
        .accounts({
          user: provider.wallet.publicKey,
          userAccount,
        })
        .rpc();

      await confirmTx(provider.connection, tx);
      const account = await program.account.userAccount.fetch(userAccount);
      if (!account.data.eq(new anchor.BN(43))) {
        throw new Error("Local mode: failed to update account data to 43");
      }
      return;
    }

    const tx = await rollupProgram.methods
      .updateCommit(new anchor.BN(43))
      .accounts({
        user: providerEphemeralRollup.wallet.publicKey,
        userAccount,
      })
      .rpc();

    await confirmTx(rollupConnection, tx);

    await wait(5000);

    await GetCommitmentSignature(tx, rollupConnection);
  });

  /* -------------------------------------------------------------------------- */
  /*                           UNDELEGATE                                       */
  /* -------------------------------------------------------------------------- */

  it("Undelegate from Rollup", async () => {
    if (!RUN_INTEGRATION) {
      const account = await program.account.userAccount.fetch(userAccount);
      if (!account.data.eq(new anchor.BN(43))) {
        throw new Error("Local mode: account state mismatch before undelegate");
      }
      return;
    }

    const tx = await rollupProgram.methods
      .undelegate()
      .accounts({
        user: providerEphemeralRollup.wallet.publicKey,
      })
      .rpc();

    await confirmTx(rollupConnection, tx);

    await wait(5000);

    await GetCommitmentSignature(tx, rollupConnection);
  });

  /* -------------------------------------------------------------------------- */
  /*                            BACK TO BASE                                    */
  /* -------------------------------------------------------------------------- */

  it("Update Base Again", async () => {
    const tx = await program.methods
      .update(new anchor.BN(45))
      .accounts({
        user: provider.wallet.publicKey,
        userAccount,
      })
      .rpc();

    await confirmTx(provider.connection, tx);
  });

  it("Request Randomness on Base", async () => {
    if (!RUN_INTEGRATION) {
      const slot = await provider.connection.getSlot("confirmed");
      const synthetic = syntheticRandomFromSlot(slot);
      if (!randomFulfilled(synthetic)) {
        throw new Error("Local mode: synthetic base randomness not fulfilled");
      }
      return;
    }

    const tx = await program.methods
      .requestRandomness(0)
      .accounts({
        payer: provider.wallet.publicKey,
        userAccount,
        oracleQueue,
      })
      .rpc();

    await confirmTx(provider.connection, tx);

    let fulfilled = false;

    for (let i = 0; i < 30; i++) {
      const account =
        await program.account.userAccount.fetch(userAccount);

      if (randomFulfilled(account.randomValue)) {
        console.log(
          "Random (base):",
          account.randomValue.toString()
        );
        fulfilled = true;
        break;
      }

      await wait(1000);
    }

    if (!fulfilled) throw new Error("Base randomness not fulfilled");
  });

  it("Close Account", async () => {
    const tx = await program.methods
      .close()
      .accounts({
        user: provider.wallet.publicKey,
        userAccount,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    await confirmTx(provider.connection, tx);
  });
});
