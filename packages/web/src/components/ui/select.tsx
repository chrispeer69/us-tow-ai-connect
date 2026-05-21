'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

type SelectContextValue = {
  value: string;
  onChange: (v: string) => void;
};

const SelectContext = React.createContext<SelectContextValue | null>(null);

interface SelectProps {
  value: string;
  onValueChange: (v: string) => void;
  children: React.ReactNode;
}

export function Select({ value, onValueChange, children }: SelectProps) {
  const items: { value: string; label: string }[] = [];
  let trigger: React.ReactNode = null;

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === SelectTrigger) {
      trigger = child;
    } else if (child.type === SelectContent) {
      React.Children.forEach(child.props.children, (item) => {
        if (React.isValidElement(item) && item.type === SelectItem) {
          items.push({
            value: String(item.props.value),
            label: typeof item.props.children === 'string' ? item.props.children : String(item.props.value),
          });
        }
      });
    }
  });

  return (
    <SelectContext.Provider value={{ value, onChange: onValueChange }}>
      <div className="relative inline-block w-full">
        <select
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          className={cn(
            'h-10 w-full appearance-none rounded-md border border-zinc-700 bg-zinc-900 px-3 pr-9 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
          )}
        >
          {items.map((it) => (
            <option key={it.value} value={it.value} className="bg-zinc-900 text-zinc-100">
              {it.label}
            </option>
          ))}
        </select>
        {trigger}
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500">
          ▾
        </span>
      </div>
    </SelectContext.Provider>
  );
}

interface SelectTriggerProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
}

export function SelectTrigger(_props: SelectTriggerProps) {
  // Rendering is handled by the native <select> in Select; this is a
  // shape-only placeholder so the spec's JSX pattern compiles.
  return null;
}

export function SelectValue(_props: { placeholder?: string }) {
  return null;
}

export function SelectContent({ children }: { children: React.ReactNode }) {
  // children are scraped by Select; nothing to render here
  return <>{children}</>;
}

export interface SelectItemProps {
  value: string;
  children: React.ReactNode;
  className?: string;
}

export function SelectItem(_props: SelectItemProps) {
  // Scraped by Select; nothing to render directly.
  return null;
}
