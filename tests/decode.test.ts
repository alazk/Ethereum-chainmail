import { describe, expect, it } from "vitest";
import { decodeMessage } from "../lib/decode";
import { classify } from "../lib/classify";
import { extractMessage, pairKey } from "../lib/extract";

const hex = (s: string) => "0x" + Buffer.from(s, "utf8").toString("hex");

describe("decodeMessage", () => {
  it("reads a plain English message", () => {
    expect(decodeMessage(hex("Please return the funds and keep 10% as a bounty."))).toBe(
      "Please return the funds and keep 10% as a bounty.",
    );
  });

  it("reads non-Latin text and emoji", () => {
    expect(decodeMessage(hex("请归还资金 🙏"))).toBe("请归还资金 🙏");
    expect(decodeMessage(hex("gm 👨‍👩‍👧"))).toBe("gm 👨‍👩‍👧");
  });

  it("strips NUL padding around a message", () => {
    const padded = "0x0000" + Buffer.from("hello world").toString("hex") + "000000";
    expect(decodeMessage(padded)).toBe("hello world");
  });

  it("rejects an ERC-20 transfer call", () => {
    const transfer =
      "0xa9059cbb000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045" +
      "0000000000000000000000000000000000000000000000000de0b6b3a7640000";
    expect(decodeMessage(transfer)).toBeNull();
  });

  it("rejects a bare function selector", () => {
    expect(decodeMessage("0x3ccfd60b")).toBeNull(); // withdraw()
    expect(decodeMessage("0xd0e30db0")).toBeNull(); // deposit()
  });

  it("rejects empty, odd-length and non-hex input", () => {
    expect(decodeMessage("0x")).toBeNull();
    expect(decodeMessage("")).toBeNull();
    expect(decodeMessage("0xabc")).toBeNull();
    expect(decodeMessage("0xzz")).toBeNull();
  });

  it("rejects text that is just a hash", () => {
    expect(
      decodeMessage(hex("0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060")),
    ).toBeNull();
  });

  it("rejects text that is mostly control characters", () => {
    expect(decodeMessage(hex("hi\u0001\u0002\u0003\u0004\u0005"))).toBeNull();
  });

  it("rejects single characters and numbers only", () => {
    expect(decodeMessage(hex("a"))).toBeNull();
    expect(decodeMessage(hex("123456"))).toBeNull();
  });
});

describe("classify", () => {
  it("keeps a normal negotiation message", () => {
    expect(classify("We are the Acme team. Contact security@acme.xyz to discuss a bounty.").status).toBe(
      "visible",
    );
  });

  it("flags phishing links", () => {
    expect(classify("Congratulations! Claim your airdrop at https://free-eth-drop.xyz")).toEqual({
      status: "spam",
      reason: "phishing link",
    });
    expect(classify("You are eligible for 5000 USDT reward, visit usdt-bonus.com").status).toBe("spam");
  });

  it("flags inscriptions", () => {
    expect(classify('data:,{"p":"erc-20","op":"mint","tick":"eths","amt":"1000"}').reason).toBe("inscription");
    expect(classify('{"p":"erc-20","op":"mint"}').reason).toBe("inscription");
  });

  it("flags long encoded payloads", () => {
    expect(classify("QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdGQmYwAPJz").reason).toBe("encoded data");
  });
});

describe("extractMessage", () => {
  const base = {
    hash: "0xABC0000000000000000000000000000000000000000000000000000000000001",
    blockNumber: 21000000n,
    blockTime: new Date("2026-01-01T00:00:00Z"),
    index: 7,
    from: "0xB66CD966670D962C227B3EABA30A872DBFB995DB",
    to: "0x098B716B8Aaf21512996dC57EB0615e2383E2f96",
    value: 0n,
  };

  it("builds a row with lowercase addresses and a sorted pair key", () => {
    const row = extractMessage({ ...base, input: hex("we can talk") })!;
    expect(row.from_addr).toBe(base.from.toLowerCase());
    expect(row.to_addr).toBe(base.to.toLowerCase());
    expect(row.pair_key).toBe(pairKey(base.to, base.from));
    expect(row.block_number).toBe("21000000");
    expect(row.status).toBe("visible");
  });

  it("skips contract deployments", () => {
    expect(extractMessage({ ...base, to: null, input: hex("hello there") })).toBeNull();
  });
});
