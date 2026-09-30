import { afterEach, describe, expect, it, vi } from "vitest";
import { BotAPIError, listBots, withBotAuthorization } from "./bots";

afterEach(() => vi.unstubAllGlobals());

describe("bot session recovery", () => {
  it("renews an expired session and retries the rejected operation once", async () => {
    const authorize = vi
      .fn()
      .mockResolvedValueOnce("expired")
      .mockResolvedValueOnce("renewed");
    const operation = vi
      .fn()
      .mockRejectedValueOnce(
        new BotAPIError("wallet authorization required", 401),
      )
      .mockResolvedValueOnce("created");
    expect(await withBotAuthorization(authorize, operation)).toBe("created");
    expect(authorize.mock.calls).toEqual([[], [true]]);
    expect(operation.mock.calls).toEqual([["expired"], ["renewed"]]);
  });
  it("does not retry ambiguous failures or non-authentication errors", async () => {
    for (const error of [
      new Error("network error"),
      new BotAPIError("server failure", 500),
      new BotAPIError("invalid settings", 400),
    ]) {
      const authorize = vi.fn().mockResolvedValue("token");
      const operation = vi.fn().mockRejectedValue(error);
      await expect(withBotAuthorization(authorize, operation)).rejects.toBe(
        error,
      );
      expect(operation).toHaveBeenCalledTimes(1);
      expect(authorize).toHaveBeenCalledTimes(1);
    }
  });
  it("propagates signing refusal without sending a second request", async () => {
    const authorize = vi
      .fn()
      .mockResolvedValueOnce("expired")
      .mockRejectedValueOnce(new Error("signature rejected"));
    const operation = vi
      .fn()
      .mockRejectedValue(new BotAPIError("expired", 401));
    await expect(withBotAuthorization(authorize, operation)).rejects.toThrow(
      "signature rejected",
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });
  it("exposes the HTTP status for list authentication failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 401,
        ok: false,
        json: async () => ({ error: "wallet authorization required" }),
      }),
    );
    await expect(listBots("wallet", "expired")).rejects.toMatchObject({
      status: 401,
      message: "wallet authorization required",
    });
  });
});
