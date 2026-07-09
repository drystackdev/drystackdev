import { ReactNode } from 'react';
import { css } from '@keystar/ui/style';

const blockElementSpacing = css({
  marginBlock: '0.75em',
  '&:first-child': {
    marginBlockStart: 0,
  },
  '&:last-child': {
    marginBlockEnd: 0,
  },
});

type BlockWrapperProps = {
  attributes?: {
    'data-slate-node': 'element';
    'data-slate-inline'?: true;
    'data-slate-void'?: true;
    dir?: 'rtl';
    ref: any;
  };
  children: ReactNode;
  draggable?: boolean;
};

export const BlockWrapper = (props: BlockWrapperProps) => {
  let { attributes, children, draggable = false } = props;
  return (
    <div draggable={draggable} className={blockElementSpacing} {...attributes}>
      {children}
    </div>
  );
};
