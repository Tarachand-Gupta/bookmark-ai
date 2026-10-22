"use client";
import { Children, isValidElement, type ReactNode } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
const NONE = "__organization_no_value__";
/** Shared anchored picker for organization fields. Option children describe
 * labels only; the rendered control uses Radix keyboard/typeahead/focus logic. */
export function OrganizationPicker({value,onValueChange,children,className,disabled,"aria-label":label}:{value:string;onValueChange:(value:string)=>void;children:ReactNode;className?:string;disabled?:boolean;"aria-label"?:string}) {
  return <Select value={value || NONE} onValueChange={next=>onValueChange(next===NONE?"":next)} disabled={disabled}>
    <SelectTrigger aria-label={label} className={cn("h-11 min-h-11 w-full min-w-0 [&>span]:truncate",className)}><SelectValue /></SelectTrigger>
    <SelectContent position="popper" align="start" sideOffset={4} collisionPadding={12} className="w-[var(--radix-select-trigger-width)] min-w-0 max-w-[calc(100vw-24px)]">
      {Children.toArray(children).filter(isValidElement).map(child=>{const option=child.props as {value:string;disabled?:boolean;children:ReactNode};return <SelectItem key={option.value || NONE} value={option.value || NONE} disabled={option.disabled} className="min-h-11 whitespace-normal break-words">{option.children}</SelectItem>;})}
    </SelectContent>
  </Select>;
}
