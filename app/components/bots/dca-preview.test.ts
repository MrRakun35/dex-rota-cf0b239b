import { describe, expect, it } from "vitest";
import { defaultDCASettings } from "./DCAForm";
import { dcaPreviewLevels } from "./dca-preview";

describe("DCA chart preview", () => {
  it("accumulates multiplied steps and weights average entry by leveraged order size", () => {
    const settings = {
      ...defaultDCASettings,
      price_step_percent: "1",
      price_deviation_multiplier: "2",
      max_dca_orders: "3",
      order_size_multiplier: "2",
      leverage: "3",
    };
    const levels = dcaPreviewLevels(settings, 100);
    expect(
      levels
        .filter((level) => /^DCA \d+$/.test(level.label))
        .map((level) => level.price),
    ).toEqual([99, 97, 93]);
    const quantity = 60 / 100 + 60 / 99 + 120 / 97 + 240 / 93;
    const average = 480 / quantity;
    expect(
      levels.find((level) => level.label === "DCA Average · all fills")?.price,
    ).toBeCloseTo(average);
    expect(
      levels.find((level) => level.label === "DCA TP all fills")?.price,
    ).toBeCloseTo(average * 1.01);
  });
  it("uses enabled trigger inputs and reverses short TP and stop loss", () => {
    const levels = dcaPreviewLevels(
      {
        ...defaultDCASettings,
        direction: "SHORT",
        start_enabled: true,
        start_price: "200",
        stop_enabled: true,
        stop_price: "250",
        stop_loss_enabled: true,
        stop_loss_percent: "5",
        max_dca_orders: "0",
      },
      190,
    );
    expect(levels.find((level) => level.label === "DCA Base")?.price).toBe(200);
    expect(levels.find((level) => level.label === "DCA TP base")?.price).toBe(
      198,
    );
    expect(levels.find((level) => level.label === "DCA SL base")?.price).toBe(
      210,
    );
    expect(levels.find((level) => level.label === "DCA Stop")?.price).toBe(250);
  });
});
