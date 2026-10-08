import { describe, expect, it } from "vitest";
import type { Block } from "viem";
import { messagesFromBlock } from "../lib/ingest";
import { inputOf, parseTimestamp, parseWei } from "../scripts/import-backfill";

const hex = (s: string) => ("0x" + Buffer.from(s, "utf8").toString("hex")) as `0x${string}`;

describe("messagesFromBlock", () => {
  it("keeps text transactions and drops everything else", () => {
    const block = {
      number: 23_000_000n,
      timestamp: 1_760_000_000n,
      transactions: [
        { hash: "0x01", transactionIndex: 0, from: "0xAA", to: "0xBB", value: 0n, input: hex("hello friend") },
        { hash: "0x02", transactionIndex: 1, from: "0xAA", to: "0xCC", value: 5n, input: "0x" },
        { hash: "0x03", transactionIndex: 2, from: "0xAA", to: null, value: 0n, input: hex("deploy text") },
        { hash: "0x04", transactionIndex: 3, from: "0xAA", to: "0xDD", value: 0n, input: "0xd0e30db0" },
      ],
    } as unknown as Block<bigint, true>;

    const rows = messagesFromBlock(block);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tx_hash: "0x01",
      block_number: "23000000",
      tx_index: 0,
      from_addr: "0xaa",
      to_addr: "0xbb",
      body: "hello friend",
    });
    expect(rows[0].block_time.toISOString()).toBe("2025-10-09T08:53:20.000Z");
  });
});

describe("backfill parsing", () => {
  it("reads BigQuery and Dune timestamps", () => {
    expect(parseTimestamp("2023-03-13 08:50:23 UTC").toISOString()).toBe("2023-03-13T08:50:23.000Z");
    expect(parseTimestamp("2023-03-13 08:50:23.000 UTC").toISOString()).toBe("2023-03-13T08:50:23.000Z");
    expect(parseTimestamp("1678697423").toISOString()).toBe("2023-03-13T08:50:23.000Z");
  });

  it("accepts raw input or decoded body", () => {
    expect(inputOf({ input: "0x6869" })).toBe("0x6869");
    expect(inputOf({ body: "hi" })).toBe("0x6869");
    expect(inputOf({})).toBe("0x");
  });

  it("reads wei values", () => {
    expect(parseWei("1000000000000000000")).toBe("1000000000000000000");
    expect(parseWei("5.0")).toBe("5");
    expect(parseWei("")).toBe("0");
    expect(parseWei("1e18")).toBe("1000000000000000000");
  });
});
