import { Outlet, useLocation } from "react-router-dom";
import { Bell } from "lucide-react";
import {
  PortfolioLayoutWidget,
  usePortfolioLayoutScript,
} from "@orderly.network/portfolio";
import { useNav } from "@/hooks/useNav";
import { useOrderlyConfig } from "@/utils/config";

export default function PortfolioLayout() {
  const location = useLocation();
  const pathname = location.pathname;

  const { onRouteChange } = useNav();
  const config = useOrderlyConfig();
  const { items } = usePortfolioLayoutScript({ current: pathname });

  return (
    <PortfolioLayoutWidget
      items={[
        ...items,
        {
          name: "Telegram",
          href: "/portfolio/notifications",
          icon: <Bell size={20} />,
        },
      ]}
      footerProps={config.scaffold.footerProps}
      mainNavProps={{
        ...config.scaffold.mainNavProps,
        initialMenu: "/portfolio",
      }}
      routerAdapter={{
        onRouteChange,
      }}
      leftSideProps={{
        current: pathname,
      }}
      bottomNavProps={config.scaffold.bottomNavProps}
    >
      <Outlet />
    </PortfolioLayoutWidget>
  );
}
