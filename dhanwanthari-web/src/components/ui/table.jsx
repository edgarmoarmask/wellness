import { cn } from "@/lib/utils"
export const Table = ({ className, ...p }) => <div className="w-full overflow-x-auto"><table data-slot="table" className={cn("w-full text-sm", className)} {...p} /></div>
export const THead = ({ className, ...p }) => <thead className={cn("bg-muted text-left text-xs text-muted-foreground", className)} {...p} />
export const TR = ({ className, ...p }) => <tr className={cn("border-t", className)} {...p} />
export const TH = ({ className, ...p }) => <th className={cn("px-3 py-2.5 font-semibold", className)} {...p} />
export const TD = ({ className, ...p }) => <td className={cn("px-3 py-3 align-top", className)} {...p} />
