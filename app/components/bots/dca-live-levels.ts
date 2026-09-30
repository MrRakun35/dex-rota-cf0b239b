import type { TradingBot } from "../../services/bots";
import type { DCAPreviewLevel } from "./dca-preview";

export function dcaLiveLevels(bot: TradingBot): DCAPreviewLevel[] {
  if (bot.kind !== "DCA" || bot.status !== "active") return [];
  const config = bot.config;
  const cycle = bot.progress.dca as Record<string, unknown> | undefined;
  if (!cycle) return [];
  const number = (source: Record<string, unknown>, key: string) =>
    Number(source[key]) || 0;
  const orders = (bot.progress.working_orders ?? []) as Record<
    string,
    unknown
  >[];
  const lots = (bot.progress.lots ?? []) as Record<string, unknown>[];
  const label = `DCA ${bot.id.slice(0, 6)}`;
  const levels: DCAPreviewLevel[] = [];
  const direction = config.direction === "SHORT" ? 1 : -1;
  let quantity = lots.reduce((sum, lot) => sum + number(lot, "Quantity"), 0);
  let cost = lots.reduce(
    (sum, lot) => sum + number(lot, "Quantity") * number(lot, "Price"),
    0,
  );
  const stopLoss = number(config, "stop_loss_percent");
  for (const order of orders) {
    const purpose = String(order.Purpose);
    const price = number(order, "Price");
    const remaining = Math.max(
      0,
      number(order, "Quantity") - number(order, "Accounted"),
    );
    if (price <= 0 || remaining <= 0) continue;
    levels.push({
      label: `${label} · ${purpose === "dca_base" ? "Start limit" : purpose === "dca_entry" ? `Next DCA ${number(order, "Level") || number(cycle, "dca_orders") + 1} limit` : purpose === "dca_take_profit" ? "TP limit · entire position" : "Closing"}`,
      price,
      quantity: remaining,
      color: purpose === "dca_take_profit" ? "#28c59a" : "#7798ff",
    });
  }
  if (quantity > 0 && stopLoss > 0)
    levels.push({
      label: `${label} · SL current position`,
      price: (cost / quantity) * (1 + (direction * stopLoss) / 100),
      color: "#ff6577",
      quantity,
    });
  if (cycle.closing) return levels;
  const base = number(cycle, "base_price") || number(config, "start_price");
  if (base <= 0) return levels;
  if (quantity <= 0) {
    quantity =
      (number(config, "base_order_margin") * number(config, "leverage")) / base;
    cost = quantity * base;
  } else {
    const pendingBase = orders.find((order) => order.Purpose === "dca_base");
    if (pendingBase) {
      const remaining = Math.max(
        0,
        number(pendingBase, "Quantity") - number(pendingBase, "Accounted"),
      );
      quantity += remaining;
      cost += remaining * number(pendingBase, "Price");
    }
  }
  const max = Math.min(50, number(config, "max_dca_orders"));
  const filled = number(cycle, "dca_orders");
  const pending = orders.find((order) => order.Purpose === "dca_entry");
  let deviation = 0;
  for (let level = 1; level <= max; level++) {
    deviation +=
      (number(config, "price_step_percent") / 100) *
      number(config, "price_deviation_multiplier") ** (level - 1);
    const price = base * (1 + direction * deviation);
    const isPending =
      pending && level === (number(pending, "Level") || filled + 1);
    if (isPending) {
      const remaining = Math.max(
        0,
        number(pending, "Quantity") - number(pending, "Accounted"),
      );
      quantity += remaining;
      cost += remaining * number(pending, "Price");
      continue;
    }
    if (level <= filled || price <= 0) continue;
    const size =
      (number(config, "dca_order_margin") *
        number(config, "leverage") *
        number(config, "order_size_multiplier") ** (level - 1)) /
      price;
    quantity += size;
    cost += size * price;
    levels.push({
      label: `${label} · DCA ${level} planned · not submitted`,
      price,
      quantity: size,
      color: "#eab85e",
    });
  }
  if (stopLoss > 0 && quantity > 0)
    levels.push({
      label: `${label} · SL projected after remaining fills`,
      price: (cost / quantity) * (1 + (direction * stopLoss) / 100),
      color: "#ed91a0",
    });
  const stop = number(config, "stop_price");
  if (stop > 0)
    levels.push({
      label: `${label} · Stop condition`,
      price: stop,
      color: "#ff6577",
    });
  return levels.filter(
    (level) => Number.isFinite(level.price) && level.price > 0,
  );
}
