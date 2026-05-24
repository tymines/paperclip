/**
 * Moonshot / Kimi provider adapter — STUB.
 *
 * Real impl: GET https://api.moonshot.cn/v1/users/me/balance with header
 *   Authorization: Bearer <api-key>
 * Returns:
 *   { code, data: { available_balance, voucher_balance, cash_balance },
 *     status: bool, scode }
 * Map data.available_balance → balance. Note: Moonshot's billing is in CNY
 * by default; the API documents this — surface currency:"CNY" honestly.
 *
 * Daily spending: there is a /v1/users/me/spending endpoint (paid plans
 * only). Real impl pulls from there when subscribed.
 */
import type { ProviderCreditAdapter } from "./types.js";
import { mockBalance, mockSpending } from "./stub-data.js";

export const moonshotAdapter: ProviderCreditAdapter = {
  meta: {
    key: "moonshot",
    name: "Moonshot / Kimi",
    currency: "CNY",
    balanceSupported: true,
    spendingSupported: true,
    dashboardUrl: "https://platform.moonshot.cn/console/account",
    brandColor: "#000000",
  },
  async fetchBalance() {
    return mockBalance(7, "CNY");
  },
  async fetchSpending(opts) {
    return mockSpending(7, opts.from, opts.to, "CNY");
  },
};
