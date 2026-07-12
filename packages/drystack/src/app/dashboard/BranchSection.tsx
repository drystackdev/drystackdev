import { Flex } from '@keystar/ui/layout';

import { DashboardSection } from './components';
import { useLocalizedString } from '../shell/i18n';
import { CurrentBrandChip } from '../deploy/CurrentBrandChip';

export function BranchSection() {
  let localizedString = useLocalizedString();

  return (
    <DashboardSection title={localizedString.format('currentBrand')}>
      <Flex
        alignItems="center"
        gap="regular"
        border="muted"
        borderRadius="medium"
        backgroundColor="canvas"
        padding="large"
      >
        <CurrentBrandChip />
      </Flex>
    </DashboardSection>
  );
}
