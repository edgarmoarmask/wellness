import { cn } from "@/lib/utils"
const base = "w-full rounded-xl border border-input bg-white px-3 text-sm outline-none transition focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:opacity-50"
export const Input = ({ className, ...p }) => <input data-slot="input" className={cn(base, "h-10", className)} {...p} />
export const Textarea = ({ className, ...p }) => <textarea data-slot="textarea" className={cn(base, "min-h-20 py-2", className)} {...p} />
export const NativeSelect = ({ className, children, ...p }) => <select data-slot="select" className={cn(base, "h-10 cursor-pointer pr-8", className)} {...p}>{children}</select>
export const Label = ({ className, ...p }) => <label data-slot="label" className={cn("grid gap-1.5 text-sm font-semibold", className)} {...p} />
