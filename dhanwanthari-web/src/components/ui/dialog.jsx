import * as D from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
export const Dialog = D.Root
export function DialogContent({ className, children, title, description, ...p }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-[#12132e]/40 backdrop-blur-sm" />
      <D.Content className={cn("fixed top-1/2 left-1/2 z-50 grid max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-2xl border bg-white p-6 shadow-2xl", className)} {...p}>
        <div className="pr-8"><D.Title className="font-display text-lg font-bold">{title}</D.Title>{description ? <D.Description className="mt-1 text-sm text-muted-foreground">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}</div>
        {children}
        <D.Close className="absolute top-4 right-4 grid size-8 cursor-pointer place-items-center rounded-full hover:bg-muted" aria-label="Close"><X className="size-4" /></D.Close>
      </D.Content>
    </D.Portal>)
}
export const DialogClose = D.Close
