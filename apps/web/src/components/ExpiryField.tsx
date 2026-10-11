import { Select } from "@base-ui/react/select"
import { Check, ChevronsUpDown } from "lucide-react"
import { type ExpiryChoice, expiryPresets } from "../lib/expiry.ts"
import { cx, Input, inputClass } from "./ui.tsx"

const items = expiryPresets.map(({ value, label }) => ({ value, label }))

export function ExpiryField({
  value,
  onChange,
}: {
  value: ExpiryChoice
  onChange: (value: ExpiryChoice) => void
}) {
  return (
    <div className="grid gap-1.5">
      <Select.Root
        items={items}
        value={value.preset}
        onValueChange={(preset) => preset && onChange({ ...value, preset })}
      >
        <Select.Label className="text-[13px] font-medium">Expires</Select.Label>
        <Select.Trigger
          className={cx(
            inputClass,
            "flex items-center justify-between text-left transition-colors hover:border-muted/50",
          )}
        >
          <Select.Value />
          <Select.Icon>
            <ChevronsUpDown className="size-3.5 text-muted" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner className="z-50 outline-none" sideOffset={4}>
            <Select.Popup className="min-w-(--anchor-width) origin-(--transform-origin) rounded-lg border border-line bg-card p-1 shadow-lg outline-none transition-[scale,opacity] duration-100 data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0">
              <Select.List>
                {items.map((item) => (
                  <Select.Item
                    key={item.value}
                    value={item.value}
                    className="grid grid-cols-[1rem_1fr] items-center gap-2 rounded-md py-1.5 pr-3 pl-2 text-sm outline-none select-none data-highlighted:bg-hover"
                  >
                    <Select.ItemIndicator>
                      <Check className="size-3.5" />
                    </Select.ItemIndicator>
                    <Select.ItemText className="col-start-2">{item.label}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.List>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
      {value.preset === "custom" && (
        <Input
          type="datetime-local"
          aria-label="Expiry date and time"
          value={value.custom}
          onChange={(e) => onChange({ ...value, custom: e.target.value })}
        />
      )}
      <span className="text-xs text-muted">Expired sites are deleted within an hour.</span>
    </div>
  )
}
