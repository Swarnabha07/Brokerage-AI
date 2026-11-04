import { Bot, User } from "lucide-react";
import { cn } from "@/lib/utils";

const SENDERS = {
  buyer_agent: { label: "Buyer agent", Icon: Bot, side: "left" },
  seller_agent: { label: "Seller agent", Icon: Bot, side: "right" },
  buyer: { label: "Buyer", Icon: User, side: "left" },
  seller: { label: "Seller", Icon: User, side: "right" },
};

export function ChatBubble({ sender, text }) {
  const { label, Icon, side } = SENDERS[sender] ?? SENDERS.buyer;
  const right = side === "right";
  return (
    <li className={cn("flex gap-3", right && "flex-row-reverse")}>
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          right
            ? "bg-brand-end/20 text-brand-end"
            : "bg-brand-mid/20 text-brand-mid",
        )}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className={cn("max-w-[80%] space-y-1", right && "text-right")}>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-left text-sm",
            right ? "rounded-tr-sm bg-brand-end/15" : "rounded-tl-sm bg-muted",
          )}
        >
          {text}
        </div>
      </div>
    </li>
  );
}
