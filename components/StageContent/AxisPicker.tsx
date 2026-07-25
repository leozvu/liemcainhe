import React, { useId } from 'react';
import { AxisOption } from '../../types/content';

interface Props<T extends string> {
  label: string;
  options: AxisOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * Một trục điều khiển.
 *
 * Hiện mô tả của lựa chọn đang chọn ngay dưới ô chọn: bốn trục chỉ hữu ích khi
 * người dùng biết mỗi lựa chọn thực sự làm gì, mà nhãn thì quá ngắn để nói hết.
 */
function AxisPicker<T extends string>({ label, options, value, onChange }: Props<T>) {
  const id = useId();
  const current = options.find((option) => option.value === value);

  return (
    <div>
      <label htmlFor={id} className="eg-kicker block">{label}</label>
      <select
        id={id}
        className="eg-input mt-2 w-full"
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        aria-describedby={`${id}-mota`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <p id={`${id}-mota`} className="mt-1.5 text-xs leading-relaxed text-zinc-500">
        {current?.description}
      </p>
    </div>
  );
}

export default AxisPicker;
