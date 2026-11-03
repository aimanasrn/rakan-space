"use client"

import { useState } from "react"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ApiError, errorMessage } from "@/lib/api"

export type FieldErrors = Record<string, string | undefined>

/** Runs a submit handler and maps Laravel validation errors onto fields. */
export function useFormErrors() {
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)

  const capture = (error: unknown) => {
    if (error instanceof ApiError && error.status === 422 && Object.keys(error.errors).length) {
      setErrors(Object.fromEntries(Object.entries(error.errors).map(([k, v]) => [k, v[0]])))
      setFormError(null)
    } else {
      setErrors({})
      setFormError(errorMessage(error))
    }
  }

  const reset = () => {
    setErrors({})
    setFormError(null)
  }

  return { errors, formError, capture, reset, setErrors }
}

export function FormAlert({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      {message}
    </div>
  )
}

type TextFieldProps = {
  id: string
  label: string
  error?: string
  description?: string
  textarea?: boolean
} & Omit<React.InputHTMLAttributes<HTMLInputElement> & React.TextareaHTMLAttributes<HTMLTextAreaElement>, "id">

export function TextField({ id, label, error, description, textarea, ...props }: TextFieldProps) {
  const describedBy = [description ? `${id}-description` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {textarea ? (
        <Textarea id={id} name={id} aria-invalid={!!error} aria-describedby={describedBy} {...(props as React.TextareaHTMLAttributes<HTMLTextAreaElement>)} />
      ) : (
        <Input id={id} name={id} aria-invalid={!!error} aria-describedby={describedBy} {...(props as React.InputHTMLAttributes<HTMLInputElement>)} />
      )}
      {description ? <FieldDescription id={`${id}-description`}>{description}</FieldDescription> : null}
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </Field>
  )
}
