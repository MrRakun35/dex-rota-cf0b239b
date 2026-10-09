import { Outlet, useLocation } from "react-router-dom";
import { Bell, ShieldCheck } from "lucide-react";
import {
  PortfolioLayoutWidget,
  usePortfolioLayoutScript,
} from "@orderly.network/portfolio";
import { useNav } from "@/hooks/useNav";
import { useOrderlyConfig } from "@/utils/config";
import "./layout.css";

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
          name: "Rota Guard",
          href: "/portfolio/guard",
          icon: <ShieldCheck size={20} />,
        },
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
      classNames={{ body: "rota-portfolio-body" }}
      leftSideProps={{
        current: pathname,
        className: "rota-portfolio-nav",
        style: { whiteSpace: "nowrap" },
      }}
      bottomNavProps={config.scaffold.bottomNavProps}
    >
      <Outlet />
    </PortfolioLayoutWidget>
  );
}
