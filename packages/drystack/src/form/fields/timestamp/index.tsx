import { BasicFormField } from '../../api';
import { FieldDataError } from '../error';
import { basicFormFieldWithSimpleReaderParse } from '../utils';

export function timestamp({
  label,
  mode,
}: {
  label: string;
  mode: 'created' | 'updated';
}): BasicFormField<string | null> {
  return {
    ...basicFormFieldWithSimpleReaderParse({
      label,
      columnKind: 'datetime',
      Input() {
        return null;
      },
      defaultValue() {
        return null;
      },
      parse(value) {
        if (value === undefined || value === null) return null;
        if (value instanceof Date) return value.toISOString();
        if (typeof value !== 'string') {
          throw new FieldDataError('Must be a string or date');
        }
        return value;
      },
      serialize(value) {
        return value === null ? { value: undefined } : { value };
      },
      validate(value) {
        return value;
      },
    }),
    timestamp: mode,
  };
}
