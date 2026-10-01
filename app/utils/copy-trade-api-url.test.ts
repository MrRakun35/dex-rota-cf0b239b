import { afterEach, describe, expect, it, vi } from "vitest";
import { getCopyTradeAPIURL } from "./copy-trade-api-url";

afterEach(() => {
  vi.unstubAllEnvs();
  delete window.__RUNTIME_CONFIG__;
});

describe("copy-trade API routing", () => {
  it("uses the local proxy during development even with a production runtime URL", () => {
    vi.stubEnv("DEV", true);
    window.__RUNTIME_CONFIG__ = {
      VITE_COPYTRADE_API_URL: "https://rota.algobotapp.com",
    };
    expect(getCopyTradeAPIURL()).toBe("/copy-api");
  });

  it("uses the configured backend in production and trims its trailing slash", () => {
    vi.stubEnv("DEV", false);
    window.__RUNTIME_CONFIG__ = {
      VITE_COPYTRADE_API_URL: "https://api.example.com/",
    };
    expect(getCopyTradeAPIURL()).toBe("https://api.example.com");
  });
});
