import { createContext, ReactNode, useContext, useState } from "react";
import {
  useMarginModeBySymbol,
  useLeverageBySymbol,
} from "@orderly.network/hooks";
import { MarginMode } from "@orderly.network/types";

const Context = createContext({
  symbol: "",
  mode: "trade",
  setMode: (() => {}) as (mode: string) => void,
});
export function OrderEntryModeProvider({
  symbol,
  children,
}: {
  symbol: string;
  children: ReactNode;
}) {
  const [mode, setMode] = useState("trade");
  return (
    <Context.Provider value={{ symbol, mode, setMode }}>
      {children}
    </Context.Provider>
  );
}
export const useOrderEntryMode = () => useContext(Context);
export function useBotTradingSettings(symbol: string) {
  const { marginMode, isLoading } = useMarginModeBySymbol(symbol);
  const leverage = useLeverageBySymbol(symbol, marginMode);
  return {
    marginMode: marginMode || MarginMode.CROSS,
    leverage: leverage ?? 1,
    isLoading,
  };
}
