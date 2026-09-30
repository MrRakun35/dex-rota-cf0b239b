import { dcaConfig, DCASettings } from "./DCAForm";

export type DCAPreviewLevel = {
  label: string;
  price: number;
  color: string;
  quantity?: number;
};
export function dcaPreviewLevels(
  settings: DCASettings,
  markPrice: number,
): DCAPreviewLevel[] {
  const c = dcaConfig(settings);
  const base = c.start_price || markPrice;
  const direction = c.direction === "LONG" ? -1 : 1;
  const levels: DCAPreviewLevel[] = [];
  let quantity = (c.base_order_margin * c.leverage) / base;
  let cost = quantity * base;
  levels.push({ label: "DCA Base", price: base, color: "#7798ff", quantity });
  const targets = (average: number, suffix: string) => {
    levels.push({
      label: `DCA TP ${suffix}`,
      price: average * (1 - (direction * c.take_profit_percent) / 100),
      color: "#28c59a",
    });
    if (c.stop_loss_percent > 0)
      levels.push({
        label: `DCA SL ${suffix}`,
        price: average * (1 + (direction * c.stop_loss_percent) / 100),
        color: "#ff6577",
      });
  };
  targets(base, "base");
  let deviation = 0,
    step = c.price_step_percent / 100;
  for (let i = 0; i < c.max_dca_orders; i++) {
    deviation += step;
    step *= c.price_deviation_multiplier;
    const price = base * (1 + direction * deviation);
    const size =
      (c.dca_order_margin * c.order_size_multiplier ** i * c.leverage) / price;
    quantity += size;
    cost += size * price;
    levels.push({
      label: `DCA ${i + 1}`,
      price,
      color: "#eab85e",
      quantity: size,
    });
  }
  if (c.max_dca_orders > 0) {
    levels.push({
      label: "DCA Average · all fills",
      price: cost / quantity,
      color: "#bd92ef",
    });
    targets(cost / quantity, "all fills");
  }
  if (c.start_price > 0)
    levels.push({ label: "DCA Start", price: c.start_price, color: "#7798ff" });
  if (c.stop_price > 0)
    levels.push({ label: "DCA Stop", price: c.stop_price, color: "#ff6577" });
  return levels;
}
