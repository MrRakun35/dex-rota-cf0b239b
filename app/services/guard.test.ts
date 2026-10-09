import { describe, expect, it } from "vitest";
import { validateGuardPolicy } from "./guard";

describe("Guard policy input validation", () => {
  it("rejects enabled empty policies, non-finite amounts and impossible distances", () => {
    const p = {
      enabled: true,
      max_loss_24h: 0,
      max_notional: 0,
      min_liquidation_distance_percent: 0,
    };
    expect(validateGuardPolicy(p)).not.toBe("");
    expect(validateGuardPolicy({ ...p, max_loss_24h: 100 })).toBe("");
    expect(validateGuardPolicy({ ...p, max_loss_24h: NaN })).not.toBe("");
    expect(validateGuardPolicy({ ...p, max_notional: -1 })).not.toBe("");
    expect(
      validateGuardPolicy({ ...p, min_liquidation_distance_percent: 51 }),
    ).not.toBe("");
    expect(validateGuardPolicy({ ...p, enabled: false })).toBe("");
  });
});
