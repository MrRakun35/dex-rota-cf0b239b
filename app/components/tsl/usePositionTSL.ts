import { useCallback, useMemo } from "react";
import {
  useMutation,
  useOrderStream,
  useSubAccountMutation,
  useSubAccountAlgoOrderStream,
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
import {
  activationPriceError,
  callbackPercentToValue,
  callbackPercentToRatio,
  findActiveTSLOrder,
  floorToTick,
  getErrorMessage,
  isCallbackRateTickAligned,
  roundToTick,
  toFiniteNumber,
} from "./tsl-utils";

interface MutationResponse {
  success?: boolean;
  message?: string;
}

export interface SubmitTSLParams {
  callbackRate?: number | string; // in percent, e.g. 1.5 for 1.5%
  callbackValue?: number | string; // in quote currency, e.g. 50
  quantity: number | string;
  activatedPrice?: number | string;
}

export function usePositionTSL(
  position?: API.PositionTPSLExt | API.PositionExt,
) {
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
    return findActiveTSLOrder(algoOrders, position);
  }, [algoOrders, position]);

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

      const rawQty = Number(quantity);
      const maxQty = Math.abs(Number(position.position_qty));
      const baseTick = symbolInfo?.base_tick || 0.00000001;
      const baseDp = symbolInfo?.base_dp ?? 8;
      const numQty = floorToTick(rawQty, baseTick, baseDp);

      if (!Number.isFinite(numQty) || numQty <= 0) {
        toast.error("Please enter a valid quantity.");
        return false;
      }

      if (numQty > maxQty) {
        toast.error(`Quantity cannot exceed position size (${maxQty}).`);
        return false;
      }

      let parsedCallbackRate: string | undefined;
      let parsedCallbackValue: number | undefined;

      if (callbackValue !== undefined && callbackValue !== "") {
        const val = toFiniteNumber(callbackValue);
        if (val === undefined || val <= 0) {
          toast.error("Callback value must be greater than 0.");
          return false;
        }
        if (markPrice && val >= markPrice) {
          toast.error("Callback value must be less than mark price.");
          return false;
        }
        parsedCallbackValue = roundToTick(
          val,
          symbolInfo?.quote_tick || 0.01,
          symbolInfo?.quote_dp ?? 2,
        );
      } else if (callbackRate !== undefined && callbackRate !== "") {
        const ratio = callbackPercentToRatio(callbackRate);
        if (!ratio) {
          toast.error("Callback rate must be between 0.1% and 5.0%.");
          return false;
        }

        // The API's callback_rate tick is 0.01 in ratio units, so only whole
        // percentages can use it (2% => 0.02). Preserve 0.1% UI steps by
        // representing fractional percentages as a quote-price distance.
        const useCallbackValue =
          (activeTSLOrder?.callback_value && !activeTSLOrder.callback_rate) ||
          !isCallbackRateTickAligned(callbackRate);

        if (useCallbackValue) {
          const referencePrice =
            Number(activeTSLOrder?.extreme_price) ||
            markPrice ||
            Number(position.average_open_price ?? 0);
          parsedCallbackValue = callbackPercentToValue(
            callbackRate,
            referencePrice,
            symbolInfo?.quote_tick || 0.01,
            symbolInfo?.quote_dp ?? 2,
          );

          if (parsedCallbackValue === undefined) {
            toast.error(
              "Mark price is not available yet. Please wait and try again.",
            );
            return false;
          }
        } else {
          parsedCallbackRate = ratio;
        }
      }

      if (!parsedCallbackRate && !parsedCallbackValue) {
        toast.error("Please provide either a callback rate or callback value.");
        return false;
      }

      let parsedActivatedPrice: number | undefined = undefined;
      if (
        activeTSLOrder?.activated_price &&
        !activeTSLOrder.is_activated &&
        (activatedPrice === undefined || activatedPrice === "")
      ) {
        toast.error("Activation price is required while this TSL is pending.");
        return false;
      }
      if (
        !activeTSLOrder?.is_activated &&
        activatedPrice !== undefined &&
        activatedPrice !== ""
      ) {
        const validationError = activationPriceError(
          activatedPrice,
          position,
          markPrice,
        );
        if (validationError) {
          toast.error(validationError);
          return false;
        }
        parsedActivatedPrice = roundToTick(
          Number(activatedPrice),
          symbolInfo?.quote_tick || 0.01,
          symbolInfo?.quote_dp ?? 2,
        );
      }

      // Closing side is opposite to position side
      const closingSide =
        position.position_qty > 0 ? OrderSide.SELL : OrderSide.BUY;

      const payload: Record<string, unknown> = {
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
        let res: MutationResponse | undefined;
        if (activeTSLOrder?.algo_order_id) {
          // Native SDK uses 'order_id' key for PUT /v1/algo/order and sends changed fields
          const updatePayload: Record<string, unknown> = {
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
          res = (await doUpdateOrder(updatePayload)) as MutationResponse;
        } else {
          res = (await doCreateOrder(payload)) as MutationResponse;
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

        refresh?.();
        return true;
      } catch (error: unknown) {
        toast.error(
          getErrorMessage(error, "Failed to submit Trailing Stop order."),
        );
        return false;
      }
    },
    [
      position,
      markPrice,
      activeTSLOrder,
      doCreateOrder,
      doUpdateOrder,
      refresh,
      symbolInfo?.base_dp,
      symbolInfo?.base_tick,
      symbolInfo?.quote_dp,
      symbolInfo?.quote_tick,
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
        refresh?.();
        return true;
      } catch (error: unknown) {
        toast.error(
          getErrorMessage(error, "Failed to cancel Trailing Stop order."),
        );
        return false;
      }
    },
    [activeTSLOrder, position?.symbol, doDeleteOrder, refresh],
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
