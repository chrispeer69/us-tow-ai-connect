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
  disabled?: boolean;
}

export function Select({ value, onValueChange, children, disabled }: SelectProps) {
  const items: { value: string; label: string }[] = [];
  let trigger: React.ReactNode = null;

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === SelectTrigger) {
      trigger = child;
    } else if (child.type === SelectContent) {
      const contentProps = child.props as { children?: React.ReactNode };
      React.Children.forEach(contentProps.children, (item) => {
        if (React.isValidElement(item) && item.type === SelectItem) {
          const itemProps = item.props as { value: string | number; children?: React.ReactNode };
          items.push({
            value: String(itemProps.value),
            label: typeof itemProps.children === 'string' ? itemProps.children : String(itemProps.value),
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
          disabled={disabled}
          onChange={(e) => onValueChange(e.target.value)}
          className={cn(
            'h-10 w-full appearance-none rounded-[12px] border border-[var(--border-strong)] bg-[var(--surface-card)] px-3 pr-9 text-sm text-[var(--text-main)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--alliance-blue)] focus-visible:border-[var(--alliance-blue)] disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {items.map((it) => (
            <option key={it.value} value={it.value} className="bg-[var(--surface-card)] text-[var(--text-main)]">
              {it.label}
            </option>
          ))}
        </select>
        {trigger}
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">
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
