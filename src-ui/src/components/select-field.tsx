import { Icon } from "./icons";

export function SelectField({ label, caption = label, value, onChange, children, compact = false }: {
  label: string; caption?: string; value: string; onChange: (value: string) => void; children: React.ReactNode; compact?: boolean;
}) {
  return <label className={compact ? "select-field sort-field" : "select-field"}>
    <span className={compact ? "sr-only" : "filter-caption"}>{caption}</span>
    <span className="select-control">
      <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>{children}</select>
      <Icon name="chevron-down" />
    </span>
  </label>;
}
