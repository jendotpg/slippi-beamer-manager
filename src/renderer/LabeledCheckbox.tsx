import { Checkbox, FormControlLabel } from '@mui/material';
import { ChangeEvent, CSSProperties, ReactNode } from 'react';

export default function LabeledCheckbox({
  checked,
  disabled = false,
  label,
  labelPlacement = 'end',
  style = {},
  set,
}: {
  checked: boolean;
  disabled?: boolean;
  label: ReactNode;
  labelPlacement?: 'end' | 'start' | 'top' | 'bottom';
  style?: CSSProperties;
  set: (checked: boolean) => void;
}) {
  return (
    <FormControlLabel
      control={
        <Checkbox
          checked={checked}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            set(event.target.checked);
          }}
        />
      }
      disabled={disabled}
      disableTypography
      label={label}
      labelPlacement={labelPlacement}
      sx={{ typography: 'caption' }}
      style={style}
    />
  );
}
