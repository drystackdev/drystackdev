import { ActionButton } from "@keystar/ui/button";
import { Icon } from "@keystar/ui/icon";
import { copyIcon } from "@keystar/ui/icon/icons/copyIcon";
import { gitBranchIcon } from "@keystar/ui/icon/icons/gitBranchIcon";
import { Flex } from "@keystar/ui/layout";
import { toastQueue } from "@keystar/ui/toast";
import { Text } from "@keystar/ui/typography";

import { DashboardCard, DashboardGrid, DashboardSection } from "./components";
import { useLocalizedString } from "../shell/i18n";
import { useAppState } from "../shell/context";
import { useCurrentBrand } from "../brand";

// Two peer cards in the same grid as collections/singletons (plan/brand.md
// §10), same visual weight as Home/Posts instead of the old full-width bar:
// brand gets double width since its label is long (wraps to 2 lines, then
// ellipsis - see Text truncate={2}), file management is a plain
// single-width card (DashboardCard, same component the collection tiles use).
export function BranchSection() {
  let localizedString = useLocalizedString();
  let { basePath } = useAppState();
  let brand = useCurrentBrand();
  let label = brand?.label ?? "";

  return (
    <DashboardSection title={localizedString.format("currentBrand")}>
      <DashboardGrid>
        <Flex
          gridColumn={{ tablet: "span 2" }}
          alignItems="center"
          gap="medium"
          border="muted"
          borderRadius="medium"
          backgroundColor="canvas"
          padding="large"
        >
          <Icon src={gitBranchIcon} />
          <Text truncate={2} flex minWidth={0} title={label}>
            {label}
          </Text>
          <ActionButton
            isDisabled={!brand}
            onPress={() => {
              if (!brand) return;
              navigator.clipboard.writeText(brand.label);
              toastQueue.positive("Đã copy tên brand", { timeout: 2000 });
            }}
          >
            <Icon src={copyIcon} />
          </ActionButton>
        </Flex>
        <DashboardCard label="File management" href={`${basePath}/files`} />
      </DashboardGrid>
    </DashboardSection>
  );
}
