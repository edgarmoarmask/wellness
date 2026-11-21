import { cva } from "class-variance-authority"
import { cn } from "@/lib/utils"
const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap [&_svg]:size-3", {
  variants: { variant: {
    default: "bg-accent text-accent-foreground", ok: "bg-[#e3f7ee] text-ok", warn: "bg-[#fdf1dc] text-warn", danger: "bg-[#fee2e2] text-destructive",
    info: "bg-[#e0f4fb] text-[#0779a0]", muted: "bg-muted text-muted-foreground", herb: "bg-herb-soft text-herb", gold: "bg-gold-soft text-gold" } },
  defaultVariants: { variant: "default" },
})
export const Badge = ({ className, variant, ...p }) => <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...p} />
