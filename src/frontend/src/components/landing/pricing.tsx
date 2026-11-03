"use client"

import { Check } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { PLANS, type Plan, SALES_EMAIL, YEARLY_DISCOUNT } from "@/lib/marketing"
import { cn } from "@/lib/utils"

function price(plan: Plan, yearly: boolean): { amount: string; note: string } {
  if (plan.monthly === null) return { amount: "Free", note: "forever, up to 10 members" }
  if (plan.monthly === "custom") return { amount: "Custom", note: "tailored to your organisation" }
  const perMonth = yearly ? plan.monthly * (1 - YEARLY_DISCOUNT) : plan.monthly
  return { amount: `RM ${perMonth % 1 ? perMonth.toFixed(2) : perMonth}`, note: yearly ? "per user / month, billed yearly" : "per user / month" }
}

function ctaHref(plan: Plan): string {
  if (plan.id === "enterprise" && SALES_EMAIL) {
    return `mailto:${SALES_EMAIL}?subject=${encodeURIComponent("RakanSpace Enterprise")}`
  }
  return `/register?plan=${plan.id}`
}

export function Pricing() {
  const [yearly, setYearly] = useState(true)

  return (
    <div>
      <div className="flex justify-center">
        <div role="radiogroup" aria-label="Billing period" className="inline-flex rounded-full border border-white/10 bg-white/5 p-1 text-sm">
          {[
            { value: false, label: "Monthly" },
            { value: true, label: `Yearly · save ${Math.round(YEARLY_DISCOUNT * 100)}%` },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              role="radio"
              aria-checked={yearly === o.value}
              onClick={() => setYearly(o.value)}
              className={cn(
                "rounded-full px-4 py-1.5 transition-colors",
                yearly === o.value ? "bg-white text-slate-950 shadow" : "text-slate-300 hover:text-white",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <ul className="mt-12 grid gap-6 lg:grid-cols-3">
        {PLANS.map((plan) => {
          const p = price(plan, yearly)
          return (
            <li
              key={plan.id}
              className={cn(
                "lp-reveal relative flex flex-col rounded-3xl border p-8",
                plan.highlight
                  ? "border-emerald-400/50 bg-gradient-to-b from-emerald-500/15 to-white/[0.03] shadow-2xl shadow-emerald-500/10"
                  : "border-white/10 bg-white/[0.03]",
              )}
            >
              {plan.highlight ? (
                <span className="absolute -top-3 left-8 rounded-full bg-gradient-to-r from-teal-400 to-emerald-500 px-3 py-1 text-xs font-semibold text-slate-950">
                  Most popular
                </span>
              ) : null}
              <h3 className="text-lg font-semibold text-white">{plan.name}</h3>
              <p className="mt-1 text-sm text-slate-400">{plan.tagline}</p>
              <p className="mt-6 flex items-baseline gap-2">
                <span className="text-4xl font-semibold tracking-tight text-white">{p.amount}</span>
              </p>
              <p className="text-sm text-slate-400">{p.note}</p>
              <Link
                href={ctaHref(plan)}
                className={cn(
                  "mt-8 rounded-full px-5 py-3 text-center text-sm font-medium transition",
                  plan.highlight ? "bg-white text-slate-950 hover:bg-emerald-50" : "border border-white/15 text-white hover:bg-white/10",
                )}
              >
                {plan.cta}
              </Link>
              <ul className="mt-8 space-y-3 text-sm text-slate-300">
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-3">
                    <Check className="mt-0.5 size-4 shrink-0 text-emerald-400" aria-hidden />
                    {f}
                  </li>
                ))}
              </ul>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
