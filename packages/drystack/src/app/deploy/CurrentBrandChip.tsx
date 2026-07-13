import { ActionButton } from '@keystar/ui/button';
import { Icon } from '@keystar/ui/icon';
import { copyIcon } from '@keystar/ui/icon/icons/copyIcon';
import { gitBranchIcon } from '@keystar/ui/icon/icons/gitBranchIcon';
import { toastQueue } from '@keystar/ui/toast';
import { Text } from '@keystar/ui/typography';

import { useCurrentBrand } from '../brand';
import { brandDisplayLabel } from '../brand-label';

// Replaces the old branch dropdown + "..." menu (new branch/github repo) in
// the navbar and dashboard — see plan/brand.md §9-10. Just the current
// brand's label, truncated, as a single ActionButton (press = copy) so it
// reads as a button next to DeployButton rather than plain text — there's
// nothing to pick anymore since every editor only ever has one brand at a time.
export function CurrentBrandChip() {
  const brand = useCurrentBrand();
  // Display drops the leading date/time (see brandDisplayLabel); the press
  // handler still copies the full original label.
  const label = brand ? brandDisplayLabel(brand.label) : '';

  return (
    <ActionButton
      isDisabled={!brand}
      width="100%"
      minWidth={0}
      onPress={() => {
        if (!brand) return;
        navigator.clipboard.writeText(brand.label);
        toastQueue.positive('Đã copy tên brand', { timeout: 2000 });
      }}
    >
      <Icon src={gitBranchIcon} />
      <Text truncate flex minWidth={0} title={label}>
        {label}
      </Text>
      <Icon src={copyIcon} />
    </ActionButton>
  );
}
