import { ActionButton } from '@keystar/ui/button';
import { Icon } from '@keystar/ui/icon';
import { copyIcon } from '@keystar/ui/icon/icons/copyIcon';
import { gitBranchIcon } from '@keystar/ui/icon/icons/gitBranchIcon';
import { HStack } from '@keystar/ui/layout';
import { toastQueue } from '@keystar/ui/toast';
import { Text } from '@keystar/ui/typography';

import { useCurrentBrand } from '../brand';

// Replaces the old branch dropdown + "..." menu (new branch/github repo) in
// the navbar and dashboard — see plan/brand.md §9-10. Just the current
// brand's label, truncated, with a copy button; there's nothing to pick
// anymore since every editor only ever has one brand at a time.
export function CurrentBrandChip() {
  const brand = useCurrentBrand();
  const label = brand?.label ?? '';

  return (
    <HStack alignItems="center" gap="small" flex minWidth={0}>
      <Icon src={gitBranchIcon} color="neutralTertiary" />
      <Text truncate flex title={label}>
        {label}
      </Text>
      <ActionButton
        aria-label="Copy brand name"
        prominence="low"
        isDisabled={!brand}
        onPress={() => {
          if (!brand) return;
          navigator.clipboard.writeText(brand.label);
          toastQueue.positive('Đã copy tên brand', { timeout: 2000 });
        }}
      >
        <Icon src={copyIcon} />
      </ActionButton>
    </HStack>
  );
}
