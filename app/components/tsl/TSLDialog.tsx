import React, { useEffect, useMemo, useRef, useState } from "react";
import { API, MarginMode } from "@orderly.network/types";
import {
  SimpleDialog,
  Button,
  Input,
  Flex,
  Grid,
  Divider,
  cn,
} from "@orderly.network/ui";
import {
  activationPriceError,
  floorToTick,
  normalizeCallbackPercent,
  roundToTick,
} from "./tsl-utils";
import { usePositionTSL } from "./usePositionTSL";

export interface TSLDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position?: API.PositionTPSLExt | API.PositionExt | null;
  onSuccess?: () => void;
  initialCallbackRate?: string;
}

const QUICK_CALLBACK_RATES = ["0.2", "0.5", "1.0", "1.5", "2.0", "3.0", "5.0"];
const QUICK_QTY_PERCENTS = [25, 50, 75, 100];

export const TSLDialog: React.FC<TSLDialogProps> = ({
  open,
  onOpenChange,
  position,
  onSuccess,
  initialCallbackRate,
}) => {
  const {
    symbolInfo,
    markPrice,
    activeTSLOrder,
    isMutating,
    submitTSL,
    cancelTSL,
  } = usePositionTSL(position ?? undefined);

  const baseDp = symbolInfo?.base_dp ?? 4;
  const quoteDp = symbolInfo?.quote_dp ?? 2;
  const baseTick = symbolInfo?.base_tick ?? 0.0001;
  const baseToken = symbolInfo?.base ?? "";
  const quoteToken = symbolInfo?.quote ?? "USDC";

  const isLong = (position?.position_qty ?? 0) > 0;
  const totalQty = Math.abs(Number(position?.position_qty ?? 0));
  const entryPrice = Number(position?.average_open_price ?? 0);
  const currentMarkPrice = markPrice ?? entryPrice;

  // Form states
  const [callbackRate, setCallbackRate] = useState<string>("1.0");
  const [selectedPercent, setSelectedPercent] = useState<number>(100);
  const [quantity, setQuantity] = useState<string>(totalQty.toString());
  const [activatedPrice, setActivatedPrice] = useState<string>("");
  const initializedDialogRef = useRef<string | null>(null);

  // Sync existing active order values or default
  useEffect(() => {
    if (!open) {
      initializedDialogRef.current = null;
      return;
    }
    const initializationKey = `${position?.symbol}:${activeTSLOrder?.algo_order_id ?? "new"}`;
    if (initializedDialogRef.current === initializationKey) return;
    initializedDialogRef.current = initializationKey;

    if (activeTSLOrder) {
      let activeRatePercent = initialCallbackRate || "1.0";
      if (activeTSLOrder.callback_rate) {
        activeRatePercent = (
          Number(activeTSLOrder.callback_rate) * 100
        ).toFixed(1);
      } else if (activeTSLOrder.callback_value) {
        const referencePrice = Number(
          activeTSLOrder.extreme_price ||
            activeTSLOrder.activated_price ||
            entryPrice,
        );
        const calculatedRate =
          referencePrice > 0
            ? (Number(activeTSLOrder.callback_value) / referencePrice) * 100
            : 1;
        activeRatePercent = Math.max(0.1, Math.min(5, calculatedRate)).toFixed(
          1,
        );
      }
      setCallbackRate(activeRatePercent);

      const orderQty = Number(activeTSLOrder.quantity ?? totalQty);
      setQuantity(orderQty.toFixed(baseDp));
      if (totalQty > 0) {
        const percent = Math.round((orderQty / totalQty) * 100);
        setSelectedPercent(percent);
      }

      setActivatedPrice(
        activeTSLOrder.activated_price
          ? activeTSLOrder.activated_price.toString()
          : "",
      );
    } else {
      setCallbackRate(initialCallbackRate || "1.0");
      setSelectedPercent(100);
      setQuantity(totalQty ? totalQty.toFixed(baseDp) : "0");
      setActivatedPrice("");
    }
  }, [
    open,
    position?.symbol,
    activeTSLOrder,
    totalQty,
    baseDp,
    initialCallbackRate,
    entryPrice,
  ]);

  // Handle quantity percentage click
  const handlePercentClick = (percent: number) => {
    setSelectedPercent(percent);
    const calculatedQty = totalQty * (percent / 100);
    // Align with baseTick / baseDp
    const stepped = Math.floor(calculatedQty / baseTick) * baseTick;
    setQuantity(Number(stepped.toFixed(baseDp)).toString());
  };

  // Handle manual quantity change
  const handleQuantityChange = (val: string) => {
    setQuantity(val);
    const num = Number(val);
    if (!isNaN(num) && totalQty > 0) {
      setSelectedPercent(Math.min(100, Math.round((num / totalQty) * 100)));
    } else {
      setSelectedPercent(0);
    }
  };

  // Validation
  const rateNum = Number(callbackRate);
  const normalizedRate = normalizeCallbackPercent(rateNum);
  const isRateValid = normalizedRate !== undefined;

  const qtyNum = Number(quantity);
  const normalizedQty = floorToTick(qtyNum, baseTick, baseDp);
  const isQtyValid =
    Number.isFinite(normalizedQty) &&
    normalizedQty > 0 &&
    normalizedQty <= totalQty;

  const activationError = activationPriceError(
    activeTSLOrder?.is_activated ? "" : activatedPrice,
    activeTSLOrder?.is_activated ? undefined : position,
    activeTSLOrder?.is_activated ? undefined : currentMarkPrice,
  );
  const pendingActivationRequired = Boolean(
    activeTSLOrder?.activated_price &&
    !activeTSLOrder.is_activated &&
    !activatedPrice,
  );

  const canSubmit =
    isRateValid &&
    isQtyValid &&
    !activationError &&
    !pendingActivationRequired &&
    !isMutating;

  // Live trigger & estimated PnL calculation
  const estInitialTriggerPrice = useMemo(() => {
    if (!currentMarkPrice || !isRateValid) return null;
    const rateRatio = (normalizedRate ?? 0) / 100;
    const activationReference = activatedPrice
      ? roundToTick(
          Number(activatedPrice),
          symbolInfo?.quote_tick || 0.01,
          quoteDp,
        )
      : currentMarkPrice;
    if (!activationReference || !Number.isFinite(activationReference)) {
      return null;
    }
    if (isLong) {
      return activationReference * (1 - rateRatio);
    } else {
      return activationReference * (1 + rateRatio);
    }
  }, [
    activatedPrice,
    currentMarkPrice,
    isLong,
    isRateValid,
    normalizedRate,
    quoteDp,
    symbolInfo?.quote_tick,
  ]);

  const estPnL = useMemo(() => {
    if (!estInitialTriggerPrice || !entryPrice || !qtyNum) return null;
    if (isLong) {
      return (estInitialTriggerPrice - entryPrice) * qtyNum;
    } else {
      return (entryPrice - estInitialTriggerPrice) * qtyNum;
    }
  }, [estInitialTriggerPrice, entryPrice, qtyNum, isLong]);

  // Submit action
  const handleSubmit = async () => {
    if (!canSubmit) return;
    const success = await submitTSL({
      callbackRate: Number(rateNum.toFixed(1)),
      quantity: normalizedQty,
      activatedPrice: activatedPrice ? Number(activatedPrice) : undefined,
    });
    if (success) {
      onSuccess?.();
      onOpenChange(false);
    }
  };

  // Cancel action
  const handleCancelOrder = async () => {
    if (!activeTSLOrder?.algo_order_id) return;
    const success = await cancelTSL(activeTSLOrder.algo_order_id);
    if (success) {
      onSuccess?.();
      onOpenChange(false);
    }
  };

  if (!position) return null;

  return (
    <SimpleDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Full Trailing Stop Loss (TSL)"
      classNames={{
        content:
          "oui-w-[440px] oui-max-w-[95vw] oui-p-5 oui-bg-base-8 oui-rounded-xl [font-family:var(--oui-font-family)]",
      }}
    >
      <div className="oui-flex oui-flex-col oui-gap-4 oui-text-xs [font-family:var(--oui-font-family)]">
        {/* Position Summary Card */}
        <div className="oui-p-3 oui-rounded-lg oui-bg-base-7 oui-border oui-border-line-6">
          <Flex justify="between" itemAlign="center" className="oui-mb-2">
            <Flex gap={2} itemAlign="center">
              <span className="oui-font-bold oui-text-sm oui-text-base-contrast">
                {position.symbol.replace("PERP_", "").replace("_USDC", "-PERP")}
              </span>
              <span
                className={cn(
                  "oui-px-1.5 oui-py-0.5 oui-rounded oui-text-2xs oui-font-bold",
                  isLong
                    ? "oui-bg-trade-profit/10 oui-text-trade-profit"
                    : "oui-bg-trade-loss/10 oui-text-trade-loss",
                )}
              >
                {isLong ? "LONG" : "SHORT"}{" "}
                {position.leverage ? `${position.leverage}x` : ""}
              </span>
              <span className="oui-text-2xs oui-text-base-contrast-36 oui-bg-base-6 oui-px-1.5 oui-py-0.5 oui-rounded">
                {position.margin_mode === MarginMode.ISOLATED
                  ? "Isolated"
                  : "Cross"}
              </span>
            </Flex>
            <span className="oui-text-2xs oui-text-base-contrast-54">
              Size: {totalQty} {baseToken}
            </span>
          </Flex>

          <Grid cols={3} gap={2} className="oui-text-2xs oui-pt-1">
            <div>
              <span className="oui-text-base-contrast-36 oui-block">
                Entry Price
              </span>
              <span className="oui-font-semibold oui-text-base-contrast">
                ${entryPrice ? entryPrice.toFixed(quoteDp) : "--"}
              </span>
            </div>
            <div>
              <span className="oui-text-base-contrast-36 oui-block">
                Mark Price
              </span>
              <span className="oui-font-semibold oui-text-base-contrast">
                ${currentMarkPrice ? currentMarkPrice.toFixed(quoteDp) : "--"}
              </span>
            </div>
            <div>
              <span className="oui-text-base-contrast-36 oui-block">
                Est. Liq Price
              </span>
              <span className="oui-font-semibold oui-text-trade-loss">
                {position.est_liq_price
                  ? `$${Number(position.est_liq_price).toFixed(quoteDp)}`
                  : "--"}
              </span>
            </div>
          </Grid>
        </div>

        {/* Trailing Distance (Callback Rate %) */}
        <div className="oui-flex oui-flex-col oui-gap-1.5">
          <Flex justify="between" itemAlign="center">
            <span className="oui-font-semibold oui-text-base-contrast-80">
              Trailing Distance (Callback Rate)
            </span>
            <span className="oui-text-2xs oui-text-base-contrast-36">
              Range: 0.1% - 5.0% (Step: 0.1%)
            </span>
          </Flex>

          {/* Stepper Input with -0.1% and +0.1% buttons */}
          <Flex itemAlign="center" gap={1} className="oui-w-full">
            <Button
              type="button"
              variant="outlined"
              size="sm"
              disabled={isMutating || rateNum <= 0.1}
              onClick={() => {
                const next = Math.max(0.1, Number((rateNum - 0.1).toFixed(1)));
                setCallbackRate(next.toFixed(1));
              }}
              className="oui-h-9 oui-px-2.5 oui-bg-base-7 hover:oui-bg-base-6 oui-border oui-border-line-12 oui-text-xs oui-font-bold [font-family:var(--oui-font-family)]"
            >
              -0.1%
            </Button>

            <div className="oui-flex-1">
              <Input
                type="number"
                step="0.1"
                min="0.1"
                max="5.0"
                value={callbackRate}
                onValueChange={(val) => {
                  setCallbackRate(val);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    const next = Math.min(
                      5.0,
                      Number((rateNum + 0.1).toFixed(1)),
                    );
                    setCallbackRate(next.toFixed(1));
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    const next = Math.max(
                      0.1,
                      Number((rateNum - 0.1).toFixed(1)),
                    );
                    setCallbackRate(next.toFixed(1));
                  }
                }}
                placeholder="1.0"
                suffix={
                  <span className="oui-text-base-contrast-36 oui-text-2xs oui-me-1 [font-family:var(--oui-font-family)]">
                    %
                  </span>
                }
                classNames={{
                  root: cn(
                    "oui-h-9 oui-bg-base-7 oui-border oui-border-line-12 focus-within:oui-border-primary oui-rounded",
                    !isRateValid &&
                      callbackRate !== "" &&
                      "oui-border-trade-loss",
                  ),
                  input:
                    "oui-text-xs oui-text-base-contrast [font-family:var(--oui-font-family)]",
                }}
              />
            </div>

            <Button
              type="button"
              variant="outlined"
              size="sm"
              disabled={isMutating || rateNum >= 5.0}
              onClick={() => {
                const next = Math.min(5.0, Number((rateNum + 0.1).toFixed(1)));
                setCallbackRate(next.toFixed(1));
              }}
              className="oui-h-9 oui-px-2.5 oui-bg-base-7 hover:oui-bg-base-6 oui-border oui-border-line-12 oui-text-xs oui-font-bold [font-family:var(--oui-font-family)]"
            >
              +0.1%
            </Button>
          </Flex>

          {/* Quick rate chips */}
          <Flex gap={1} className="oui-mt-1">
            {QUICK_CALLBACK_RATES.map((rate) => (
              <button
                key={rate}
                type="button"
                onClick={() => setCallbackRate(rate)}
                className={cn(
                  "oui-flex-1 oui-py-1 oui-rounded oui-text-2xs oui-font-medium oui-transition-colors [font-family:var(--oui-font-family)]",
                  callbackRate === rate
                    ? "oui-bg-primary oui-text-primary-contrast"
                    : "oui-bg-base-7 oui-text-base-contrast-54 hover:oui-bg-base-6 hover:oui-text-base-contrast",
                )}
              >
                {rate}%
              </button>
            ))}
          </Flex>
          {!isRateValid && callbackRate !== "" && (
            <span className="oui-text-2xs oui-text-trade-loss">
              Callback rate must be between 0.1% and 5.0%.
            </span>
          )}
        </div>

        {/* Close Quantity (% of position) */}
        <div className="oui-flex oui-flex-col oui-gap-1.5">
          <Flex justify="between" itemAlign="center">
            <span className="oui-font-semibold oui-text-base-contrast-80">
              Close Quantity (% of Position)
            </span>
            <span className="oui-text-2xs oui-text-base-contrast-36">
              Max: {totalQty} {baseToken}
            </span>
          </Flex>

          <Input
            type="number"
            min={baseTick.toString()}
            max={totalQty.toString()}
            step={baseTick.toString()}
            value={quantity}
            onValueChange={handleQuantityChange}
            placeholder="0.0"
            suffix={
              <span className="oui-text-base-contrast-36 oui-text-2xs oui-me-1 [font-family:var(--oui-font-family)]">
                {baseToken}
              </span>
            }
            classNames={{
              root: cn(
                "oui-h-9 oui-bg-base-7 oui-border oui-border-line-12 focus-within:oui-border-primary oui-rounded",
                !isQtyValid && quantity !== "" && "oui-border-trade-loss",
              ),
              input:
                "oui-text-xs oui-text-base-contrast [font-family:var(--oui-font-family)]",
            }}
          />

          {/* Quick quantity percentage buttons */}
          <Flex gap={1} className="oui-mt-1">
            {QUICK_QTY_PERCENTS.map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => handlePercentClick(pct)}
                className={cn(
                  "oui-flex-1 oui-py-1 oui-rounded oui-text-2xs oui-font-medium oui-transition-colors [font-family:var(--oui-font-family)]",
                  selectedPercent === pct
                    ? "oui-bg-primary oui-text-primary-contrast"
                    : "oui-bg-base-7 oui-text-base-contrast-54 hover:oui-bg-base-6 hover:oui-text-base-contrast",
                )}
              >
                {pct === 100 ? "100% (Full)" : `${pct}%`}
              </button>
            ))}
          </Flex>
          {qtyNum > totalQty && (
            <span className="oui-text-2xs oui-text-trade-loss">
              Quantity exceeds current position size ({totalQty} {baseToken}).
            </span>
          )}
        </div>

        {/* Optional Activation Price */}
        <div className="oui-flex oui-flex-col oui-gap-1.5">
          <Flex justify="between" itemAlign="center">
            <span className="oui-font-semibold oui-text-base-contrast-80">
              Activation Price (Optional)
            </span>
            <span className="oui-text-2xs oui-text-base-contrast-36">
              Immediate if blank
            </span>
          </Flex>

          <Input
            type="number"
            min={(symbolInfo?.quote_tick || 0.01).toString()}
            step={(symbolInfo?.quote_tick || 0.01).toString()}
            value={activatedPrice}
            onValueChange={setActivatedPrice}
            disabled={Boolean(activeTSLOrder?.is_activated)}
            placeholder={
              currentMarkPrice
                ? currentMarkPrice.toFixed(quoteDp)
                : "Trigger price threshold"
            }
            suffix={
              <span className="oui-text-base-contrast-36 oui-text-2xs oui-me-1 [font-family:var(--oui-font-family)]">
                {quoteToken}
              </span>
            }
            classNames={{
              root: cn(
                "oui-h-9 oui-bg-base-7 oui-border oui-border-line-12 focus-within:oui-border-primary oui-rounded",
                activationError && "oui-border-trade-loss",
              ),
              input:
                "oui-text-xs oui-text-base-contrast [font-family:var(--oui-font-family)]",
            }}
          />
          <span className="oui-text-2xs oui-text-base-contrast-36">
            {isLong
              ? "Trailing starts once mark price reaches or rises above this level."
              : "Trailing starts once mark price reaches or drops below this level."}
          </span>
          {activationError && (
            <span className="oui-text-2xs oui-text-trade-loss">
              {activationError}
            </span>
          )}
          {pendingActivationRequired && (
            <span className="oui-text-2xs oui-text-trade-loss">
              Activation price is required while this TSL is pending.
            </span>
          )}
        </div>

        <Divider className="oui-w-full oui-my-1" />

        {/* Live Estimation Preview Card */}
        {estInitialTriggerPrice && (
          <div className="oui-p-3 oui-rounded-lg oui-bg-base-9 oui-border oui-border-line-6">
            <Flex justify="between" itemAlign="center" className="oui-mb-1">
              <span className="oui-text-2xs oui-text-base-contrast-54">
                Est. Initial Trigger Price:
              </span>
              <span className="oui-font-semibold oui-text-xs oui-text-base-contrast">
                ${estInitialTriggerPrice.toFixed(quoteDp)}
              </span>
            </Flex>

            {estPnL !== null && (
              <Flex justify="between" itemAlign="center">
                <span className="oui-text-2xs oui-text-base-contrast-54">
                  Est. PnL at Initial Trigger:
                </span>
                <span
                  className={cn(
                    "oui-font-semibold oui-text-xs",
                    estPnL >= 0
                      ? "oui-text-trade-profit"
                      : "oui-text-trade-loss",
                  )}
                >
                  {estPnL >= 0
                    ? `+${estPnL.toFixed(quoteDp)}`
                    : estPnL.toFixed(quoteDp)}{" "}
                  {quoteToken}
                </span>
              </Flex>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <Flex gap={2} className="oui-mt-2">
          {activeTSLOrder ? (
            <>
              <Button
                color="danger"
                variant="outlined"
                className="oui-flex-1 oui-h-9 oui-text-xs oui-font-medium [font-family:var(--oui-font-family)]"
                loading={isMutating}
                onClick={handleCancelOrder}
              >
                Cancel TSL
              </Button>
              <Button
                color="primary"
                className="oui-flex-1 oui-h-9 oui-text-xs oui-font-semibold [font-family:var(--oui-font-family)]"
                disabled={!canSubmit}
                loading={isMutating}
                onClick={handleSubmit}
              >
                Update TSL
              </Button>
            </>
          ) : (
            <>
              <Button
                color="secondary"
                variant="outlined"
                className="oui-flex-1 oui-h-9 oui-text-xs oui-font-medium [font-family:var(--oui-font-family)]"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                color="primary"
                className="oui-flex-1 oui-h-9 oui-text-xs oui-font-semibold [font-family:var(--oui-font-family)]"
                disabled={!canSubmit}
                loading={isMutating}
                onClick={handleSubmit}
              >
                Confirm Full TSL
              </Button>
            </>
          )}
        </Flex>
      </div>
    </SimpleDialog>
  );
};
