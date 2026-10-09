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
    <div className="rota-twap-execution-guard">
      <label className="rota-bots__check">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(event) =>
            onChange({ ...settings, enabled: event.target.checked })
          }
        />
        Liquidity & price protection
      </label>
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
            Checks Orderly spread, depth and estimated price impact, plus price
            deviation against Binance and Coinbase spot prices. Coverage counts
            liquidity inside the price impact limit.
            <span>
              USD quotes are converted to USDC. If prices diverge, liquidity is
              insufficient, or either source is unavailable, the slice waits and
              retries. Unsupported markets also wait. The schedule may extend,
              including for reduce-only orders. This check does not guarantee
              the final fill price.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
