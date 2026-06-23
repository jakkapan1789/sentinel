import { useState } from 'react';
import { Button, Field, Modal, SelectMenu, TextInput, Textarea } from './ui';

export type FieldType = 'text' | 'number' | 'select' | 'textarea';

export type FieldDef<T> = {
  name: keyof T & string;
  label: string;
  type?: FieldType;
  placeholder?: string;
  required?: boolean;
  hint?: string;
  options?: { value: string; label: string }[];
  colSpan?: 1 | 2;
  /** Custom validation: return an error string, or empty when valid. */
  validate?: (value: string, draft: Record<string, string>) => string;
};

type Props<T> = {
  title: string;
  description?: string;
  fields: FieldDef<T>[];
  initial: Record<string, string>;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (values: Record<string, string>) => void;
};

export function EntityForm<T>({
  title,
  description,
  fields,
  initial,
  submitLabel,
  onCancel,
  onSubmit,
}: Props<T>) {
  const [draft, setDraft] = useState<Record<string, string>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const setValue = (name: string, value: string) => {
    setDraft((current) => ({ ...current, [name]: value }));
    setErrors((current) => (current[name] ? { ...current, [name]: '' } : current));
  };

  const validate = (): boolean => {
    const nextErrors: Record<string, string> = {};
    for (const field of fields) {
      const value = (draft[field.name] ?? '').trim();
      if (field.required && !value) {
        nextErrors[field.name] = `${field.label} is required.`;
        continue;
      }
      if (value && field.validate) {
        const message = field.validate(value, draft);
        if (message) nextErrors[field.name] = message;
      }
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    onSubmit(draft);
  };

  return (
    <Modal
      title={title}
      description={description}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>{submitLabel}</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {fields.map((field) => (
          <Field
            key={field.name}
            label={field.label}
            required={field.required}
            error={errors[field.name]}
            hint={field.hint}
            className={field.colSpan === 2 ? 'sm:col-span-2' : ''}
          >
            {field.type === 'select' ? (
              <SelectMenu
                value={draft[field.name] ?? ''}
                options={field.options ?? []}
                onChange={(value) => setValue(field.name, value)}
              />
            ) : field.type === 'textarea' ? (
              <Textarea
                value={draft[field.name] ?? ''}
                placeholder={field.placeholder}
                onChange={(event) => setValue(field.name, event.target.value)}
              />
            ) : (
              <TextInput
                type={field.type === 'number' ? 'number' : 'text'}
                value={draft[field.name] ?? ''}
                placeholder={field.placeholder}
                onChange={(event) => setValue(field.name, event.target.value)}
              />
            )}
          </Field>
        ))}
      </div>
    </Modal>
  );
}
