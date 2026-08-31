import assert from "node:assert/strict";
import test from "node:test";
import { toDecimal } from "../src/utils/decimal.js";
import { walletSummaryFromTotals } from "../src/services/withdrawalService.js";

test("pending withdrawal does not reduce the available wallet balance", () => {
  const wallet = walletSummaryFromTotals("2000.00", {
    reserved: toDecimal("1000.00"),
    withdrawn: toDecimal("0.00"),
  });

  assert.equal(wallet.availableBalance.toString(), "2000.00");
  assert.equal(wallet.reservedBalance.toString(), "1000.00");
  assert.equal(wallet.withdrawnAmount.toString(), "0.00");
});

test("approved withdrawal reduces the available wallet balance", () => {
  const wallet = walletSummaryFromTotals("2000.00", {
    reserved: toDecimal("0.00"),
    withdrawn: toDecimal("1000.00"),
  });

  assert.equal(wallet.availableBalance.toString(), "1000.00");
  assert.equal(wallet.reservedBalance.toString(), "0.00");
  assert.equal(wallet.withdrawnAmount.toString(), "1000.00");
});
