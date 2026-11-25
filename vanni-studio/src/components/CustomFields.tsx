import { useTable } from '../lib/store';
import { DateField, NumberField, Rating, Select, TextArea, TextField, Toggle } from './ui';
import type { CustomField } from '../lib/types';

export function renderCustomInput(f: { key: string; label: string; type: CustomField['type']; options?: string[] }, value: unknown, set: (v: unknown) => void) {
  switch (f.type) {
    case 'number': return <NumberField key={f.key} label={f.label} value={value as number | null} onChange={set} />;
    case 'date': return <DateField key={f.key} label={f.label} value={value as string | null} onChange={set} />;
    case 'textarea': return <TextArea key={f.key} label={f.label} value={value as string} onChange={set} className="span-2" />;
    case 'checkbox': return <Toggle key={f.key} label={f.label} checked={!!value} onChange={set} />;
    case 'rating': return <Rating key={f.key} label={f.label} value={value as number | null} onChange={set} />;
    case 'select': return <Select key={f.key} label={f.label} value={(value as string) ?? ''} onChange={set} placeholder="—" options={(f.options ?? []).map((o) => ({ value: o, label: o }))} />;
    case 'url': return <TextField key={f.key} label={f.label} type="url" inputMode="url" value={value as string} onChange={set} placeholder="https://" />;
    default: return <TextField key={f.key} label={f.label} value={value as string} onChange={set} />;
  }
}

/** Campos editables definidos por el usuario en Ajustes → Personalización. Se guardan en `custom`. */
export function CustomFieldsEditor({ entity, value, onChange }: { entity: string; value: Record<string, unknown> | null | undefined; onChange: (v: Record<string, unknown>) => void }) {
  const fields = useTable('custom_fields').rows.filter((f) => f.entity === entity).sort((a, b) => a.sort - b.sort);
  if (!fields.length) return null;
  const data = value ?? {};
  return (
    <div className="form-grid two">
      {fields.map((f) => renderCustomInput(f, data[f.key], (v) => onChange({ ...data, [f.key]: v })))}
    </div>
  );
}
