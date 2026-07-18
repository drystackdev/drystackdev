import { MemoExoticComponent, ReactElement, ReactNode, memo } from 'react';

import { ComponentSchema, GenericPreviewProps } from './api';
import { ReadonlyPropPath } from './fields/prop-path';
import {
  SlugFieldInfo,
  PathContextProvider,
  SlugFieldProvider,
} from './fields/text/path-slug-context';
import { ObjectFieldInput } from './fields/object/ui';
import { ConditionalFieldInput } from './fields/conditional/ui';
import { ArrayFieldInput } from './fields/array/ui';

function ChildFieldInput() {
  return null;
}

export type ExtraFieldInputProps = {
  autoFocus: boolean;
  forceValidation: boolean;
  omitFieldAtPath?: readonly string[];
};

function getInputComponent(schema: ComponentSchema): any {
  if (schema.kind === 'object') {
    return schema.Input ?? ObjectFieldInput;
  }
  if (schema.kind === 'conditional') {
    return schema.Input ?? ConditionalFieldInput;
  }
  if (schema.kind === 'array') {
    return schema.Input ?? ArrayFieldInput;
  }
  if (schema.kind === 'child') {
    return ChildFieldInput;
  }
  return schema.Input;
}

export const InnerFormValueContentFromPreviewProps: MemoExoticComponent<
  (
    props: GenericPreviewProps<ComponentSchema, unknown> & {
      autoFocus?: boolean;
      forceValidation?: boolean;
      // array fields are not supported because the use case for this (omitting content fields) is not used
      omitFieldAtPath?: readonly string[];
    }
  ) => ReactNode
> = memo(function InnerFormValueContentFromPreview(props) {
  if (props.omitFieldAtPath?.length === 0) return null;
  let Input = getInputComponent(props.schema);
  return (
    <Input
      {...(props as any)}
      autoFocus={!!props.autoFocus}
      forceValidation={!!props.forceValidation}
    />
  );
});

const emptyArray: ReadonlyPropPath = [];
export const FormValueContentFromPreviewProps: MemoExoticComponent<
  (
    props: GenericPreviewProps<ComponentSchema, unknown> & {
      autoFocus?: boolean;
      forceValidation?: boolean;
      slugField?: SlugFieldInfo;
    }
  ) => ReactElement
> = memo(function FormValueContentFromPreview({ slugField, ...props }) {
  let Input = getInputComponent(props.schema);
  return (
    <PathContextProvider value={emptyArray}>
      <SlugFieldProvider value={slugField}>
        <Input
          {...(props as any)}
          autoFocus={!!props.autoFocus}
          forceValidation={!!props.forceValidation}
        />
      </SlugFieldProvider>
    </PathContextProvider>
  );
});
