import { BotNumberInput } from "./BotNumberInput";

export const defaultTWAPExecutionGuard = {
  enabled: false,
  maxSpreadPercent: "0.20",
  maxImpactPercent: "0.30",
  minDepthRatio: "2",
  maxDeviationPercent: "0.50",
};
export type TWAPExecutionGuardSettings = typeof defaultTWAPExecutionGuard;

export function twapExecutionGuardValidation(
  settings: TWAPExecutionGuardSettings,
) {
  if (!settings.enabled) return "";
  const limits = [
    ["spread", settings.maxSpreadPercent, 5],
    ["price impact", settings.maxImpactPercent, 5],
    ["price deviation", settings.maxDeviationPercent, 10],
  ] as const;
  for (const [name, value, max] of limits) {
    const n = Number(value);
    if (
      !Number.isFinite(n) ||
      n < 0.01 ||
      n > max ||
      Math.abs(n * 100 - Math.round(n * 100)) > 1e-8
    )
      return `TWAP maximum ${name} must be between 0.01% and ${max}% in steps of 0.01%.`;
  }
  const ratio = Number(settings.minDepthRatio);
  if (!Number.isFinite(ratio) || ratio < 1 || ratio > 20)
    return "TWAP liquidity coverage must be between 1× and 20×.";
  return "";
}

export function twapExecutionGuardConfig(settings: TWAPExecutionGuardSettings) {
  if (!settings.enabled) return undefined;
  return {
    enabled: true,
    max_spread_bps: Math.round(Number(settings.maxSpreadPercent) * 100),
    max_price_impact_bps: Math.round(Number(settings.maxImpactPercent) * 100),
    min_depth_ratio: Number(settings.minDepthRatio),
    max_deviation_bps: Math.round(Number(settings.maxDeviationPercent) * 100),
  };
}

export function TWAPExecutionGuard({
  settings,
  onChange,
}: {
  settings: TWAPExecutionGuardSettings;
  onChange: (settings: TWAPExecutionGuardSettings) => void;
}) {
  const fields = [
    {
      key: "maxSpreadPercent",
      label: "Maximum spread (%)",
      max: "5",
      step: "0.01",
      min: "0.01",
    },
    {
      key: "maxImpactPercent",
      label: "Maximum price impact (%)",
      max: "5",
      step: "0.01",
      min: "0.01",
    },
    {
      key: "minDepthRatio",
      label: "Liquidity coverage (× slice)",
      max: "20",
      step: "0.1",
      min: "1",
    },
    {
      key: "maxDeviationPercent",
      label: "Maximum price deviation (%)",
      max: "10",
      step: "0.01",
      min: "0.01",
    },
  ] as const;
  return (
    <section
      className="rota-twap-execution-guard"
      data-enabled={settings.enabled}
      aria-label="Liquidity & price protection"
    >
      <div className="rota-twap-execution-guard__header">
        <span className="rota-twap-execution-guard__badge">TWAP add-on</span>
        <button
          type="button"
          className="rota-twap-execution-guard__toggle"
          aria-label="Liquidity & price protection"
          aria-pressed={settings.enabled}
          onClick={() => onChange({ ...settings, enabled: !settings.enabled })}
        >
          {settings.enabled ? "Enabled" : "Enable"}
        </button>
      </div>
      <strong className="rota-twap-execution-guard__title">
        Liquidity & price protection
      </strong>
      <p className="rota-twap-execution-guard__description">
        Add market checks to every TWAP slice. Checks Orderly liquidity and
        compares prices with Binance and Coinbase before sending an order.
      </p>
      <p className="rota-twap-execution-guard__behavior">
        If liquidity is insufficient, prices diverge, or a source is
        unavailable, the slice waits and retries.
      </p>
      {settings.enabled && (
        <>
          <div className="rota-bots__grid">
            {fields.map((field) => (
              <label key={field.key} className="rota-bots__field">
                <span>{field.label}</span>
                <BotNumberInput
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={settings[field.key]}
                  onChange={(event) =>
                    onChange({ ...settings, [field.key]: event.target.value })
                  }
                />
              </label>
            ))}
          </div>
          <div className="rota-bots__flow-note">
            Coverage counts liquidity inside the price impact limit. Binance and
            Coinbase spot prices are compared in USDC.
            <span>
              Unsupported markets wait. The schedule may extend, including for
              reduce-only orders. This check does not guarantee the final fill
              price.
            </span>
          </div>
        </>
      )}
    </section>
  );
}
