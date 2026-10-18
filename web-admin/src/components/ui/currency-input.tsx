'use client';

import { useState, type InputHTMLAttributes } from 'react';

type CurrencyInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'type'> & {
  value?: string;
  defaultValue?: string | number;
  onChange?: (value: string) => void;
};

export function parseCurrency(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits ? Number(digits) : 0;
}

function formatCurrency(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 12);
  return digits ? new Intl.NumberFormat('vi-VN').format(Number(digits)) : '';
}

export function CurrencyInput({ value, defaultValue, onChange, inputMode = 'numeric', name, min, max, onBlur, onFocus, ...props }: CurrencyInputProps) {
  const [uncontrolledValue, setUncontrolledValue] = useState(String(defaultValue ?? ''));
  const rawValue = value ?? uncontrolledValue;
  const rawDigits = rawValue.replace(/\D/g, '').slice(0, 12).replace(/^0+(?=\d)/, '');

  return <>
    {name && <input type="hidden" name={name} value={rawDigits} />}
    <input
      {...props}
      type="text"
      inputMode={inputMode}
      value={formatCurrency(rawValue)}
      onFocus={event => {
        if (/^0+$/.test(rawDigits)) event.currentTarget.select();
        onFocus?.(event);
      }}
      onChange={event => {
        const next = event.target.value.replace(/\D/g, '').slice(0, 12).replace(/^0+(?=\d)/, '');
        if (value === undefined) setUncontrolledValue(next);
        onChange?.(next);
        const amount = next ? Number(next) : 0;
        event.currentTarget.setCustomValidity(
          (min !== undefined && amount < Number(min)) || (max !== undefined && amount > Number(max))
            ? `Số tiền phải từ ${min ?? 0} đến ${max ?? 'không giới hạn'}.`
            : '',
        );
      }}
      onBlur={event => {
        const amount = rawDigits ? Number(rawDigits) : 0;
        event.currentTarget.setCustomValidity(
          (min !== undefined && amount < Number(min)) || (max !== undefined && amount > Number(max))
            ? `Số tiền phải từ ${min ?? 0} đến ${max ?? 'không giới hạn'}.`
            : '',
        );
        onBlur?.(event);
      }}
      aria-valuemin={min === undefined ? undefined : Number(min)}
      aria-valuemax={max === undefined ? undefined : Number(max)}
    />
  </>;
}
