import { useMemo, useCallback } from "react";
import {
  useMutation,
  useOrderStream,
  useSubAccountMutation,
  useSubAccountAlgoOrderStream,
  useEventEmitter,
  useMarkPrice,
  useSymbolsInfo,
  useAccount,
} from "@orderly.network/hooks";
import {
  API,
  AlgoOrderRootType,
  OrderType,
  OrderSide,
  OrderStatus,
  MarginMode,
} from "@orderly.network/types";
import { toast } from "@orderly.network/ui";

export interface SubmitTSLParams {
  callbackRate?: number | string; // in percent, e.g. 1.5 for 1.5%
  callbackValue?: number | string; // in quote currency, e.g. 50
  quantity: number | string;
  activatedPrice?: number | string;
}

export function usePositionTSL(
  position?: API.PositionTPSLExt | API.PositionExt,
) {
  const ee = useEventEmitter();
  const { account } = useAccount();
  const symbol = position?.symbol || "";
  const symbolInfoMap = useSymbolsInfo();
  const symbolInfo = symbol ? symbolInfoMap[symbol]?.() : undefined;
  const { data: markPrice } = useMarkPrice(symbol);

  const isSubAccount = Boolean(
    position?.account_id &&
    account?.accountId &&
    position.account_id !== account.accountId,
  );

  // Main account algo order stream
  const [mainAlgoOrders, { refresh: refreshMain }] = useOrderStream(
    {
      status: OrderStatus.INCOMPLETE,
      includes: [AlgoOrderRootType.TRAILING_STOP],
    },
    { keeplive: true },
  );

  // Sub account algo order stream (safe options)
  const [subAlgoOrders, { refresh: refreshSub }] = useSubAccountAlgoOrderStream(
    {
      status: OrderStatus.INCOMPLETE,
      includes: [AlgoOrderRootType.TRAILING_STOP],
    },
    { accountId: position?.account_id || account?.accountId || "" },
  );

  const algoOrders = isSubAccount ? subAlgoOrders : mainAlgoOrders;
  const refresh = isSubAccount ? refreshSub : refreshMain;

  // Find active trailing stop order for this position
  const activeTSLOrder = useMemo(() => {
    if (!symbol || !algoOrders) return undefined;
    return algoOrders.find(
      (order: any) =>
        order.symbol === symbol &&
        (order.algo_type === "TRAILING_STOP" ||
          order.algo_type === AlgoOrderRootType.TRAILING_STOP),
    );
  }, [algoOrders, symbol]);

  // Main account mutations
  const [doMainCreate, { isMutating: isMainCreating }] =
    useMutation("/v1/algo/order");
  const [doMainUpdate, { isMutating: isMainUpdating }] = useMutation(
    "/v1/algo/order",
    "PUT",
  );
  const [doMainDelete, { isMutating: isMainDeleting }] = useMutation(
    "/v1/algo/order",
    "DELETE",
  );

  // Sub account mutations
  const [doSubCreate, { isMutating: isSubCreating }] = useSubAccountMutation(
    "/v1/algo/order",
    "POST",
    { accountId: position?.account_id || "" },
  );
  const [doSubUpdate, { isMutating: isSubUpdating }] = useSubAccountMutation(
    "/v1/algo/order",
    "PUT",
    { accountId: position?.account_id || "" },
  );
  const [doSubDelete, { isMutating: isSubDeleting }] = useSubAccountMutation(
    "/v1/algo/order",
    "DELETE",
    { accountId: position?.account_id || "" },
  );

  const doCreateOrder = isSubAccount ? doSubCreate : doMainCreate;
  const doUpdateOrder = isSubAccount ? doSubUpdate : doMainUpdate;
  const doDeleteOrder = isSubAccount ? doSubDelete : doMainDelete;
  const isCreating = isSubAccount ? isSubCreating : isMainCreating;
  const isUpdating = isSubAccount ? isSubUpdating : isMainUpdating;
  const isDeleting = isSubAccount ? isSubDeleting : isMainDeleting;
  const isMutating =
    isMainCreating ||
    isMainUpdating ||
    isMainDeleting ||
    isSubCreating ||
    isSubUpdating ||
    isSubDeleting;

  const submitTSL = useCallback(
    async (params: SubmitTSLParams) => {
      if (!position) {
        toast.error("No active position found.");
        return false;
      }

      const { callbackRate, callbackValue, quantity, activatedPrice } = params;

      const numQty = Number(quantity);
      const maxQty = Math.abs(Number(position.position_qty));

      if (isNaN(numQty) || numQty <= 0) {
        toast.error("Please enter a valid quantity.");
        return false;
      }

      if (numQty > maxQty) {
        toast.error(`Quantity cannot exceed position size (${maxQty}).`);
        return false;
      }

      let parsedCallbackRate: string | undefined = undefined;
      let parsedCallbackValue: number | undefined = undefined;

      if (callbackValue !== undefined && callbackValue !== "") {
        const val = Number(callbackValue);
        if (isNaN(val) || val <= 0) {
          toast.error("Callback value must be greater than 0.");
          return false;
        }
        if (markPrice && val >= markPrice) {
          toast.error("Callback value must be less than mark price.");
          return false;
        }
        parsedCallbackValue = val;
      } else if (callbackRate !== undefined && callbackRate !== "") {
        const rate = Number(callbackRate);
        if (isNaN(rate) || rate < 0.1 || rate > 5.0) {
          toast.error("Callback rate must be between 0.1% and 5.0%.");
          return false;
        }
        // Round to 0.1% step
        const roundedRate = Math.round(rate * 10) / 10;
        const isWholePercent =
          Math.abs(roundedRate - Math.round(roundedRate)) < 0.0001;

        if (isWholePercent) {
          // Integer percentages (1.0%, 2.0%, 3.0%, 4.0%, 5.0%) strictly meet Orderly's tick 0.01
          parsedCallbackRate = (roundedRate / 100).toFixed(2);
        } else {
          // For decimal rates (0.1%, 0.2%, ..., 1.1%, 1.2%, etc.), Orderly's backend strictly enforces
          // "The trailing rate X must meet the tick 0.01" when sent as callback_rate.
          // Therefore, convert decimal rates into callback_value in quote currency (meeting quote_tick)
          const currentPrice =
            markPrice ?? Number(position.average_open_price ?? 0);
          if (currentPrice > 0) {
            const rawVal = currentPrice * (roundedRate / 100);
            const quoteTick = symbolInfo?.quote_tick || 0.01;
            const quoteDp = symbolInfo?.quote_dp ?? 2;
            const steppedVal = Math.max(
              quoteTick,
              Math.round(rawVal / quoteTick) * quoteTick,
            );
            parsedCallbackValue = Number(steppedVal.toFixed(quoteDp));
          } else {
            parsedCallbackRate = (roundedRate / 100).toFixed(3);
          }
        }
      }

      if (!parsedCallbackRate && !parsedCallbackValue) {
        toast.error("Please provide either a callback rate or callback value.");
        return false;
      }

      let parsedActivatedPrice: number | undefined = undefined;
      if (activatedPrice !== undefined && activatedPrice !== "") {
        const actPrice = Number(activatedPrice);
        if (isNaN(actPrice) || actPrice <= 0) {
          toast.error("Please enter a valid activation price.");
          return false;
        }
        parsedActivatedPrice = actPrice;
      }

      // Closing side is opposite to position side
      const closingSide =
        position.position_qty > 0 ? OrderSide.SELL : OrderSide.BUY;

      const payload: Record<string, any> = {
        symbol: position.symbol,
        algo_type: AlgoOrderRootType.TRAILING_STOP,
        type: OrderType.MARKET,
        trigger_price_type: "MARK_PRICE",
        quantity: numQty,
        side: closingSide,
        reduce_only: true,
        margin_mode: position.margin_mode ?? MarginMode.CROSS,
      };

      if (parsedCallbackRate !== undefined) {
        payload.callback_rate = parsedCallbackRate;
      }
      if (parsedCallbackValue !== undefined) {
        payload.callback_value = parsedCallbackValue;
      }
      if (parsedActivatedPrice !== undefined) {
        payload.activated_price = parsedActivatedPrice;
      }

      try {
        let res: any;
        if (activeTSLOrder?.algo_order_id) {
          // Native SDK uses 'order_id' key for PUT /v1/algo/order and sends changed fields
          const updatePayload: Record<string, any> = {
            order_id: activeTSLOrder.algo_order_id,
            quantity: numQty,
          };
          if (parsedCallbackRate !== undefined) {
            updatePayload.callback_rate = parsedCallbackRate;
          } else if (parsedCallbackValue !== undefined) {
            updatePayload.callback_value = parsedCallbackValue;
          }
          if (parsedActivatedPrice !== undefined) {
            updatePayload.activated_price = parsedActivatedPrice;
          }
          if (position.margin_mode !== undefined) {
            updatePayload.margin_mode = position.margin_mode;
          }
          res = await doUpdateOrder(updatePayload);

          // If update failed due to backend tick validator or parameter switching restriction,
          // cancel the old order and create a fresh one with the new parameters
          if (res && res.success === false) {
            const isTickOrParamError =
              res.message?.includes("tick 0.01") ||
              res.message?.includes("callback") ||
              res.message?.includes("order_id");

            if (isTickOrParamError) {
              const delRes = await doDeleteOrder(null, {
                order_id: activeTSLOrder.algo_order_id,
                symbol: position.symbol,
              });
              if (delRes?.success !== false) {
                res = await doCreateOrder(payload);
              }
            }
          }
        } else {
          res = await doCreateOrder(payload);
        }

        if (res && res.success === false) {
          toast.error(res.message || "Failed to submit Trailing Stop order.");
          return false;
        }

        toast.success(
          activeTSLOrder
            ? "Trailing Stop order updated successfully."
            : "Trailing Stop order placed successfully.",
        );

        ee.emit("order:changed", { symbol: position.symbol });
        refresh?.();
        return true;
      } catch (err: any) {
        toast.error(err?.message || "Failed to submit Trailing Stop order.");
        return false;
      }
    },
    [
      position,
      markPrice,
      activeTSLOrder,
      doCreateOrder,
      doUpdateOrder,
      ee,
      refresh,
    ],
  );

  const cancelTSL = useCallback(
    async (orderId?: number) => {
      const targetId = orderId ?? activeTSLOrder?.algo_order_id;
      if (!targetId || !position?.symbol) {
        toast.error("No active order found to cancel.");
        return false;
      }

      try {
        const res = await doDeleteOrder(null, {
          order_id: targetId,
          symbol: position.symbol,
        });

        if (res && res.success === false) {
          toast.error(res.message || "Failed to cancel Trailing Stop order.");
          return false;
        }

        toast.success("Trailing Stop order cancelled.");
        ee.emit("order:changed", { symbol: position.symbol });
        refresh?.();
        return true;
      } catch (err: any) {
        toast.error(err?.message || "Failed to cancel Trailing Stop order.");
        return false;
      }
    },
    [activeTSLOrder, position?.symbol, doDeleteOrder, ee, refresh],
  );

  return {
    symbolInfo,
    markPrice,
    activeTSLOrder,
    isMutating,
    isCreating,
    isUpdating,
    isDeleting,
    submitTSL,
    cancelTSL,
    refreshOrders: refresh,
  };
}
