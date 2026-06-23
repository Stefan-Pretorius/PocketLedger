import { type ReactNode } from "react";
import { Link, useRoute } from "wouter";
import {
  LayoutDashboard, Wallet, Receipt, Target, FileText, Settings, TrendingUp, PieChart,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/" },
  { label: "Budget", icon: Wallet, href: "/budget" },
  { label: "Expenses", icon: Receipt, href: "/expenses" },
  { label: "Goals", icon: Target, href: "/goals" },
  { label: "Investments", icon: PieChart, href: "/investments" },
  { label: "Trends", icon: TrendingUp, href: "/trends" },
  { label: "Statements", icon: FileText, href: "/statements" },
  { label: "Settings", icon: Settings, href: "/settings" },
];

function NavItem({ label, icon: Icon, href }: { label: string; icon: React.ElementType; href: string }) {
  const [active] = useRoute(href === "/" ? "/" : `${href}*`);
  return (
    <Link href={href}>
      <span
        className={cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer",
          active
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        <Icon size={18} className="flex-shrink-0" />
        <span className="hidden lg:block">{label}</span>
      </span>
    </Link>
  );
}

function BottomNavItem({ label, icon: Icon, href }: { label: string; icon: React.ElementType; href: string }) {
  const [active] = useRoute(href === "/" ? "/" : `${href}*`);
  return (
    <Link href={href}>
      <span
        className={cn(
          "flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl transition-colors cursor-pointer flex-1",
          active ? "text-primary" : "text-muted-foreground",
        )}
      >
        <Icon size={20} className={cn("transition-transform", active && "scale-110")} />
        <span className="text-[10px] font-medium">{label}</span>
      </span>
    </Link>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden sm:flex flex-col w-16 lg:w-56 border-r border-border bg-card flex-shrink-0 py-4 gap-1">
        <div className="px-3 mb-4 flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center flex-shrink-0">
            <Wallet size={16} className="text-primary-foreground" />
          </div>
          <span className="hidden lg:block font-bold text-foreground text-base">PocketLedger</span>
        </div>
        {navItems.map(item => (
          <NavItem key={item.href} {...item} />
        ))}
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto scrollbar-thin pb-20 sm:pb-0">
        {children}
      </main>

      {/* Mobile bottom nav */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border flex items-center px-2 pb-safe z-40">
        {navItems.map(item => (
          <BottomNavItem key={item.href} {...item} />
        ))}
      </nav>
    </div>
  );
}

export function PageHeader({
  title, subtitle, actions,
}: {
  title: string; subtitle?: string; actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between px-4 sm:px-6 pt-5 pb-3 gap-3">
      <div>
        <h1 className="text-xl font-bold text-foreground">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}
