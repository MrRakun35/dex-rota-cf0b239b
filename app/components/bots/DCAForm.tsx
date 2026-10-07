import { ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { BotNumberInput } from "./BotNumberInput";

export const defaultDCASettings = {
  direction: "LONG",
  price_step_percent: "0.5",
  take_profit_percent: "1",
  base_order_margin: "20",
  dca_order_margin: "20",
  max_dca_orders: "8",
  leverage: "1",
  price_deviation_multiplier: "1",
  order_size_multiplier: "1.1",
  start_enabled: false,
  start_price: "",
  stop_enabled: false,
  stop_price: "",
  stop_loss_enabled: false,
  stop_loss_percent: "",
};
export type DCASettings = typeof defaultDCASettings;
export type DCAMarketRules = {
  min_notional: number;
  base_tick: number;
  base_min: number;
};

export function dcaMinimumMargins(
  settings: DCASettings,
  markPrice: number,
  rules?: DCAMarketRules,
) {
  const c = dcaConfig(settings);
  if (
    !rules ||
    !Object.values(rules).every(Number.isFinite) ||
    rules.min_notional <= 0 ||
    rules.base_tick <= 0 ||
    rules.base_min < 0 ||
    markPrice <= 0 ||
    c.leverage <= 0
  )
    return null;
  const base =
    settings.start_enabled && c.start_price > 0 ? c.start_price : markPrice;
  const minimum = (price: number) => {
    const ticks = Math.ceil(
      Math.max(rules.base_min, rules.min_notional / price) / rules.base_tick -
        1e-10,
    );
    return (ticks * rules.base_tick * price) / c.leverage;
  };
  let dca = minimum(base);
  let deviation = 0;
  for (let i = 1; i <= Math.min(50, c.max_dca_orders); i++) {
    deviation +=
      (c.price_step_percent / 100) * c.price_deviation_multiplier ** (i - 1);
    const price = base * (1 + (c.direction === "LONG" ? -1 : 1) * deviation);
    if (price <= 0) return null;
    const required = minimum(price) / c.order_size_multiplier ** (i - 1);
    dca = i === 1 ? required : Math.max(dca, required);
  }
  const roundUp = (value: number) => Math.ceil(value * 1e8 - 1e-7) / 1e8;
  return { base: roundUp(minimum(base)), dca: roundUp(dca) };
}

export function dcaConfig(settings: DCASettings) {
  return {
    version: 1,
    direction: settings.direction,
    leverage: Number(settings.leverage),
    price_step_percent: Number(settings.price_step_percent),
    take_profit_percent: Number(settings.take_profit_percent),
    base_order_margin: Number(settings.base_order_margin),
    dca_order_margin: Number(settings.dca_order_margin),
    max_dca_orders: Number(settings.max_dca_orders),
    price_deviation_multiplier: Number(settings.price_deviation_multiplier),
    order_size_multiplier: Number(settings.order_size_multiplier),
    start_price: settings.start_enabled ? Number(settings.start_price) : 0,
    stop_price: settings.stop_enabled ? Number(settings.stop_price) : 0,
    stop_loss_percent: settings.stop_loss_enabled
      ? Number(settings.stop_loss_percent)
      : 0,
  };
}

export function dcaPlan(settings: DCASettings) {
  const c = dcaConfig(settings);
  let budget = c.base_order_margin,
    deviation = 0,
    step = c.price_step_percent;
  for (let i = 0; i < Math.min(50, c.max_dca_orders); i++) {
    budget += c.dca_order_margin * c.order_size_multiplier ** i;
    deviation += step;
    step *= c.price_deviation_multiplier;
  }
  return { budget, deviation };
}
export function dcaValidation(
  settings: DCASettings,
  markPrice: number,
  rules?: DCAMarketRules,
) {
  const c = dcaConfig(settings);
  if (
    !Object.values(c).every(
      (value) => typeof value !== "number" || Number.isFinite(value),
    )
  )
    return "Enter valid numeric DCA settings.";
  if (markPrice <= 0) return "Current market price is required to start DCA.";
  if (
    c.price_step_percent <= 0 ||
    c.price_step_percent >= 100 ||
    c.take_profit_percent <= 0 ||
    c.take_profit_percent >= 100
  )
    return "Price step and take profit must be greater than 0 and below 100%.";
  if (!Number.isInteger(c.leverage) || c.leverage < 1 || c.leverage > 100)
    return "Leverage must be a whole number from 1 to 100.";
  if (c.base_order_margin <= 0 || c.dca_order_margin <= 0)
    return "Enter positive base and DCA order margins.";
  if (
    !Number.isInteger(c.max_dca_orders) ||
    c.max_dca_orders < 0 ||
    c.max_dca_orders > 50
  )
    return "Max DCA orders must be a whole number from 0 to 50.";
  if (
    c.price_deviation_multiplier < 1 ||
    c.price_deviation_multiplier > 10 ||
    c.order_size_multiplier < 1 ||
    c.order_size_multiplier > 10
  )
    return "Multipliers must be between 1 and 10.";
  const plan = dcaPlan(settings);
  if (plan.deviation >= 100)
    return "The cumulative DCA price deviation must stay below 100%.";
  if (plan.budget > 1e9) return "The total DCA margin budget is too large.";
  if (settings.start_enabled && c.start_price <= 0)
    return "Enter a positive start trigger price.";
  if (settings.stop_enabled && c.stop_price <= 0)
    return "Enter a positive stop trigger price.";
  if (
    settings.stop_loss_enabled &&
    (c.stop_loss_percent < 0.01 || c.stop_loss_percent > 99.99)
  )
    return "Stop loss must be between 0.01% and 99.99%.";
  const minimums = dcaMinimumMargins(settings, markPrice, rules);
  if (!minimums) return "Loading exchange minimum order size.";
  if (c.base_order_margin < minimums.base)
    return `Base order margin must be at least ${minimums.base} to meet the exchange minimum notional and quantity.`;
  if (c.dca_order_margin < minimums.dca)
    return `DCA order margin must be at least ${minimums.dca} to meet the exchange minimum notional and quantity at every level.`;
  return "";
}

export function DCAForm({
  settings,
  onChange,
  quoteAsset,
  onPreview,
  onClearPreview,
  previewVisible = false,
  previewError = "",
  minimumMargins,
}: {
  settings: DCASettings;
  onChange: (settings: DCASettings) => void;
  quoteAsset: string;
  onPreview?: () => void;
  onClearPreview?: () => void;
  previewVisible?: boolean;
  previewError?: string;
  minimumMargins?: { base: number; dca: number } | null;
}) {
  const update = <K extends keyof DCASettings>(key: K, value: DCASettings[K]) =>
    onChange({ ...settings, [key]: value });
  const numberField = (
    key: keyof DCASettings,
    label: string,
    min: number,
    max?: number,
    step = "any",
    note?: string,
  ) => (
    <label className="rota-bots__field" key={key}>
      <span>{label}</span>
      <BotNumberInput
        required
        min={min}
        max={max}
        step={step}
        value={String(settings[key])}
        onChange={(event) => update(key, event.target.value)}
      />
      {note && <small>{note}</small>}
    </label>
  );
  const condition = (
    enabled: "start_enabled" | "stop_enabled" | "stop_loss_enabled",
    key: "start_price" | "stop_price" | "stop_loss_percent",
    title: string,
    label: string,
    note: string,
  ) => (
    <div className="rota-bots__dca-condition">
      <label>
        <input
          type="checkbox"
          checked={settings[enabled]}
          onChange={(event) => update(enabled, event.target.checked)}
        />{" "}
        {title}
      </label>
      {settings[enabled] &&
        numberField(
          key,
          label,
          key === "stop_loss_percent" ? 0.01 : 0.00000001,
          key === "stop_loss_percent" ? 99.99 : undefined,
          "any",
          note,
        )}
    </div>
  );
  const plan = dcaPlan(settings);
  return (
    <div className="rota-bots__dca">
      <div
        className="rota-bots__switch rota-bots__direction"
        aria-label="DCA direction"
      >
        {(["LONG", "SHORT"] as const).map((direction) => (
          <button
            key={direction}
            type="button"
            className={
              settings.direction === direction
                ? `active is-${direction.toLowerCase()}`
                : ""
            }
            aria-pressed={settings.direction === direction}
            onClick={() => update("direction", direction)}
          >
            {direction === "LONG" ? "Long" : "Short"}
          </button>
        ))}
      </div>
      <div className="rota-bots__dca-heading">
        <strong>Price Settings</strong>
        <button
          type="button"
          onClick={() => onChange({ ...defaultDCASettings })}
        >
          <Trash2 size={12} /> Reset settings
        </button>
      </div>
      <div className="rota-bots__grid">
        {numberField(
          "price_step_percent",
          settings.direction === "LONG"
            ? "Price drop steps (%)"
            : "Price rise steps (%)",
          0.01,
          99.99,
        )}
        {numberField(
          "take_profit_percent",
          "Take Profit Per Round (%)",
          0.01,
          99.99,
        )}
      </div>
      <Section title="Investment">
        {numberField(
          "base_order_margin",
          `Base Order Margin (${quoteAsset})`,
          minimumMargins?.base ?? 0.01,
          undefined,
          "any",
          minimumMargins
            ? `Minimum: ${minimumMargins.base} ${quoteAsset}`
            : "Loading exchange minimum…",
        )}
        {numberField(
          "dca_order_margin",
          `DCA Order Margin (${quoteAsset})`,
          minimumMargins?.dca ?? 0.01,
          undefined,
          "any",
          minimumMargins
            ? `Minimum: ${minimumMargins.dca} ${quoteAsset}`
            : "Loading exchange minimum…",
        )}
        {numberField(
          "max_dca_orders",
          "Max DCA Orders",
          0,
          50,
          "1",
          "Additional orders per round, excluding the base order.",
        )}
      </Section>
      <details className="rota-bots__dca-advanced">
        <summary>Advanced (Optional)</summary>
        <Section title="DCA Order Details">
          {numberField(
            "price_deviation_multiplier",
            "Price Deviation Multiplier",
            1,
            10,
          )}
          {numberField(
            "order_size_multiplier",
            "DCA Order Size Multiplier",
            1,
            10,
          )}
        </Section>
        {condition(
          "start_enabled",
          "start_price",
          "Start Condition",
          `Trigger Price (${quoteAsset})`,
          settings.direction === "LONG"
            ? "Each round places a buy limit order at this price."
            : "Each round places a sell limit order at this price.",
        )}
        {condition(
          "stop_enabled",
          "stop_price",
          "Stop Condition · Price",
          `Trigger Price (${quoteAsset})`,
          "Stops and closes the position when price reaches this level from the initial market price.",
        )}
        {condition(
          "stop_loss_enabled",
          "stop_loss_percent",
          "Stop Loss · Percent",
          "Stop Loss Target (%)",
          "Adverse price change from the position's average entry. Closes the position and ends the bot.",
        )}
      </details>
      {onPreview && (
        <div className="rota-bots__preview">
          <div className="rota-bots__preview-actions">
            <button type="button" onClick={onPreview}>
              Preview
            </button>
            {previewVisible && (
              <button type="button" onClick={onClearPreview}>
                Clear preview
              </button>
            )}
          </div>
          <small>
            {previewVisible
              ? "Levels are shown on the current chart. Changing settings clears the preview."
              : "Show these settings on the current chart."}{" "}
            TP/SL are shown for the base position and after all DCA fills.
            Preview assumes fills at planned prices.
          </small>
          {previewError && <span role="alert">{previewError}</span>}
        </div>
      )}
      <div className="rota-bots__flow-note">
        <strong>
          Margin budget:{" "}
          {Number.isFinite(plan.budget)
            ? plan.budget.toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })
            : "—"}{" "}
          {quoteAsset}
        </strong>
        <span>
          A base market order, or a start-price limit order, then up to{" "}
          {settings.max_dca_orders || 0} DCA limit orders at cumulative steps
          from the base fill. Only the next entry stays on the exchange. Order
          margins grow by the size multiplier. A reduce-only limit take profit
          covers the whole position at {settings.take_profit_percent || 0}% from
          average entry and starts a new round. The TP price and quantity update
          after fills. Targets use price change before fees; stop conditions are
          checked every second.
        </span>
      </div>
    </div>
  );
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rota-bots__dca-section">
      <strong>{title}</strong>
      <div className="rota-bots__grid">{children}</div>
    </section>
  );
}
