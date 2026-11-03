"use client"

import { Check, ChevronsUpDown, X } from "lucide-react"
import { useState } from "react"
import { UserAvatar } from "@/components/common"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { UserSummary } from "@/lib/types"
import { cn } from "@/lib/utils"

/** Searchable multi-select of people. Keyboard accessible via cmdk. */
export function PeoplePicker({
  id,
  people,
  value,
  onChange,
  placeholder = "Select people",
  exclude = [],
}: {
  id?: string
  people: UserSummary[]
  value: number[]
  onChange: (ids: number[]) => void
  placeholder?: string
  exclude?: number[]
}) {
  const [open, setOpen] = useState(false)
  const options = people.filter((p) => !exclude.includes(p.id))
  const selected = options.filter((p) => value.includes(p.id))
  const toggle = (pid: number) => onChange(value.includes(pid) ? value.filter((v) => v !== pid) : [...value, pid])

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
            <span className="truncate text-muted-foreground">{selected.length ? `${selected.length} selected` : placeholder}</span>
            <ChevronsUpDown className="opacity-50" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search people…" />
            <CommandList>
              <CommandEmpty>No one found.</CommandEmpty>
              <CommandGroup>
                {options.map((p) => (
                  <CommandItem key={p.id} value={`${p.name} ${p.id}`} onSelect={() => toggle(p.id)}>
                    <UserAvatar user={p} className="size-6" />
                    <span className="flex-1 truncate">{p.name}</span>
                    <Check className={cn("size-4", value.includes(p.id) ? "opacity-100" : "opacity-0")} aria-hidden />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selected.length ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((p) => (
            <Badge key={p.id} variant="secondary" className="gap-1 pr-1">
              {p.name}
              <button type="button" className="rounded-sm hover:bg-muted" onClick={() => toggle(p.id)} aria-label={`Remove ${p.name}`}>
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** Single person select with an optional "nobody" choice. */
export function PersonSelect({
  id,
  people,
  value,
  onChange,
  placeholder = "Unassigned",
  allowNone = true,
  disabled,
}: {
  id?: string
  people: UserSummary[]
  value: number | null
  onChange: (id: number | null) => void
  placeholder?: string
  allowNone?: boolean
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const current = people.find((p) => p.id === value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} disabled={disabled} className="w-full justify-between font-normal">
          <span className="flex min-w-0 items-center gap-2">
            {current ? <UserAvatar user={current} className="size-5" /> : null}
            <span className={cn("truncate", !current && "text-muted-foreground")}>{current?.name ?? placeholder}</span>
          </span>
          <ChevronsUpDown className="opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search…" />
          <CommandList>
            <CommandEmpty>No one found.</CommandEmpty>
            <CommandGroup>
              {allowNone ? (
                <CommandItem
                  value="__none__"
                  onSelect={() => {
                    onChange(null)
                    setOpen(false)
                  }}
                >
                  <span className="flex-1 text-muted-foreground">{placeholder}</span>
                  <Check className={cn("size-4", value === null ? "opacity-100" : "opacity-0")} aria-hidden />
                </CommandItem>
              ) : null}
              {people.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`${p.name} ${p.id}`}
                  onSelect={() => {
                    onChange(p.id)
                    setOpen(false)
                  }}
                >
                  <UserAvatar user={p} className="size-6" />
                  <span className="flex-1 truncate">{p.name}</span>
                  <Check className={cn("size-4", value === p.id ? "opacity-100" : "opacity-0")} aria-hidden />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
