import { cn } from "@/lib/utils"
export const Card = ({ className, ...p }) => <div data-slot="card" className={cn("ln-shadow rounded-2xl border bg-card text-card-foreground", className)} {...p} />
export const CardHeader = ({ className, ...p }) => <div data-slot="card-header" className={cn("flex flex-wrap items-center gap-2 px-5 pt-5 pb-3", className)} {...p} />
export const CardTitle = ({ className, ...p }) => <h3 data-slot="card-title" className={cn("flex items-center gap-2 text-base font-bold", className)} {...p} />
export const CardContent = ({ className, ...p }) => <div data-slot="card-content" className={cn("px-5 pb-5", className)} {...p} />
