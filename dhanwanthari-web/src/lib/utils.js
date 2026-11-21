import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"
export const cn = (...a) => twMerge(clsx(a))
export const rm = (n) => "RM" + Number(n || 0).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const rm0 = (n) => "RM" + Math.round(n || 0).toLocaleString("en-MY")
export const num = (n) => Math.round(n || 0).toLocaleString("en-MY")
export const initials = (name) => name.split(" ").filter((w) => !/^(bin|binti|a\/l|a\/p|Dr\.)$/i.test(w)).map((w) => w[0]).slice(0, 2).join("")
