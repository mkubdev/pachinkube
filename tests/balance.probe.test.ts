import { mkdirSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { runBalance } from "../tools/balance";

// Not a pass/fail test: a tuning probe. Run with BALANCE=1; output lands in
// .cache/balance.txt because vitest buffers console output per worker.
describe.skipIf(!process.env.BALANCE)("balance probe", () => {
  it("writes per-round score distribution", async () => {
    const lines = await runBalance(Number(process.env.BALANCE_SEEDS ?? 40));
    mkdirSync(".cache", { recursive: true });
    writeFileSync(".cache/balance.txt", lines.join("\n") + "\n");
  }, 600_000);
});
