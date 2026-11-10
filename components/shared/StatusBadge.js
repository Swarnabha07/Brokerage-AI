import {
  CheckCircle2,
  Clock,
  Loader2,
  PackageCheck,
  ShieldCheck,
  Truck,
  CreditCard,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DEAL_STATUS_META } from "@/lib/constants/deal-status";

const visuals = {
  negotiating: { variant: "brand", Icon: Loader2, spin: true },
  agreed: { variant: "warning", Icon: ShieldCheck },
  invoiced: { variant: "warning", Icon: Clock },
  paid: { variant: "success", Icon: CreditCard },
  shipped: { variant: "warning", Icon: Truck },
  return_window: { variant: "warning", Icon: Clock },
  released: { variant: "success", Icon: PackageCheck },
  disputed: { variant: "warning", Icon: AlertTriangle },
  cancelled: { variant: "default", Icon: XCircle },
  refunded: { variant: "default", Icon: XCircle },
};

export function StatusBadge({ status }) {
  const meta = DEAL_STATUS_META[status];
  const { variant, Icon, spin } = visuals[status] ?? {
    variant: "default",
    Icon: CheckCircle2,
  };
  return (
    <Badge variant={variant}>
      <Icon
        className={spin ? "h-3 w-3 animate-spin" : "h-3 w-3"}
        aria-hidden="true"
      />
      {meta?.label ?? status}
    </Badge>
  );
}
