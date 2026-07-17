import { useMemo, useState } from 'react';

import { Button, ButtonGroup } from '@keystar/ui/button';
import { Checkbox } from '@keystar/ui/checkbox';
import { Dialog } from '@keystar/ui/dialog';
import { Content } from '@keystar/ui/slots';
import { Flex } from '@keystar/ui/layout';
import { Notice } from '@keystar/ui/notice';
import { Radio, RadioGroup } from '@keystar/ui/radio';
import { TextArea } from '@keystar/ui/text-field';
import { Heading, Text } from '@keystar/ui/typography';

import type { ComponentSchema } from '../../form/api';
import { AiSize, SIZE_SPECS } from '../../api/ai/prompt';
import { AiFieldSpec, describeFields } from '../../api/ai/schema-to-yaml';
import type { MagicWriteRequest } from './useMagicWrite';
import { fieldToContextText, isFieldEmpty } from './field-value-text';

export function MagicWriteDialog(props: {
  entryLabel: string;
  schema: Record<string, ComponentSchema>;
  state: Record<string, unknown>;
  /** when set, the dialog writes only this field and skips the column picker */
  singleFieldKey?: string;
  onDismiss: () => void;
  onGenerate: (request: MagicWriteRequest) => void;
}) {
  const { schema, state, singleFieldKey } = props;

  const specs = useMemo(() => describeFields(schema), [schema]);

  // Default split: what's already written becomes context, what's blank gets
  // filled. That's the common case on a fresh entry (everything empty → fill
  // everything) and on a half-written one (keep what's there).
  const [selection, setSelection] = useState<Record<string, Column>>(() => {
    const initial: Record<string, Column> = {};
    for (const spec of specs) {
      if (singleFieldKey) {
        initial[spec.key] = spec.key === singleFieldKey ? 'fill' : 'context';
        continue;
      }
      initial[spec.key] = isFieldEmpty(schema[spec.key], state[spec.key])
        ? 'fill'
        : 'context';
    }
    return initial;
  });

  const [description, setDescription] = useState('');
  const [size, setSize] = useState<AiSize>('medium');

  const fillKeys = specs.filter(s => selection[s.key] === 'fill').map(s => s.key);
  const hasContentTarget = specs.some(
    s => selection[s.key] === 'fill' && s.kind === 'content'
  );

  const submit = () => {
    const context: Record<string, string> = {};
    for (const spec of specs) {
      if (selection[spec.key] !== 'context') continue;
      const text = fieldToContextText(schema[spec.key], state[spec.key]);
      if (text) context[spec.key] = text;
    }
    props.onGenerate({ targets: fillKeys, context, description, size });
  };

  return (
    <Dialog>
      <Heading>Magic write — {props.entryLabel}</Heading>
      <Content>
        <form
          style={{ display: 'contents' }}
          onSubmit={event => {
            event.preventDefault();
            submit();
          }}
        >
          <Flex direction="column" gap="large">
            {specs.length === 0 && (
              <Notice tone="caution">
                <Text>
                  Không có trường nào AI có thể điền cho mục này. Ảnh, tệp và
                  liên kết tới mục khác nằm ngoài phạm vi.
                </Text>
              </Notice>
            )}

            {!singleFieldKey && specs.length > 0 && (
              <ColumnPicker
                specs={specs}
                selection={selection}
                onChange={setSelection}
              />
            )}

            <TextArea
              label="Mô tả"
              description="Nói cho AI biết bạn muốn gì: chủ đề, đối tượng đọc, giọng văn."
              value={description}
              onChange={setDescription}
              autoFocus
              height="scale.1600"
            />

            {hasContentTarget && (
              <RadioGroup
                label="Kích thước nội dung"
                value={size}
                onChange={value => setSize(value as AiSize)}
                orientation="horizontal"
              >
                {(Object.keys(SIZE_SPECS) as AiSize[]).map(key => (
                  <Radio key={key} value={key}>
                    {`${SIZE_SPECS[key].label} (${SIZE_SPECS[key].words})`}
                  </Radio>
                ))}
              </RadioGroup>
            )}
          </Flex>
        </form>
      </Content>
      <ButtonGroup>
        <Button onPress={props.onDismiss}>Huỷ</Button>
        <Button
          prominence="high"
          isDisabled={fillKeys.length === 0}
          onPress={submit}
        >
          Tạo
        </Button>
      </ButtonGroup>
    </Dialog>
  );
}

type Column = 'context' | 'fill' | 'none';

function ColumnPicker(props: {
  specs: AiFieldSpec[];
  selection: Record<string, Column>;
  onChange: (selection: Record<string, Column>) => void;
}) {
  const { specs, selection, onChange } = props;

  // The two columns are mutually exclusive per field, but a field may be in
  // neither — "ignore this one entirely" is a real choice, so these are
  // checkboxes rather than a radio pair.
  const set = (key: string, column: Exclude<Column, 'none'>, checked: boolean) => {
    onChange({ ...selection, [key]: checked ? column : 'none' });
  };

  return (
    <Flex gap="xlarge">
      <Flex direction="column" gap="regular" flex>
        <Text weight="semibold">Lấy thông tin</Text>
        <Text size="small" color="neutralSecondary">
          AI đọc để hiểu ngữ cảnh
        </Text>
        {specs.map(spec => (
          <Checkbox
            key={spec.key}
            isSelected={selection[spec.key] === 'context'}
            onChange={checked => set(spec.key, 'context', checked)}
          >
            {spec.label}
          </Checkbox>
        ))}
      </Flex>
      <Flex direction="column" gap="regular" flex>
        <Text weight="semibold">Điền thông tin</Text>
        <Text size="small" color="neutralSecondary">
          AI viết và ghi đè
        </Text>
        {specs.map(spec => (
          <Checkbox
            key={spec.key}
            isSelected={selection[spec.key] === 'fill'}
            onChange={checked => set(spec.key, 'fill', checked)}
          >
            {spec.label}
          </Checkbox>
        ))}
      </Flex>
    </Flex>
  );
}
