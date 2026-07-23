import { useLocalizedStringFormatter } from "@react-aria/i18n";
import { DismissButton, useModalOverlay } from "@react-aria/overlays";
import { useUpdateEffect } from "@react-aria/utils";
import {
  OverlayTriggerState,
  useOverlayTriggerState,
} from "@react-stately/overlays";
import { typedKeys } from "emery";
import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useId,
  useRef,
} from "react";

import { Badge } from "@keystar/ui/badge";
import { Icon } from "@keystar/ui/icon";
import { chevronDownIcon } from "@keystar/ui/icon/icons/chevronDownIcon";
import { Box, Divider, ScrollView, HStack, VStack } from "@keystar/ui/layout";
import { NavList, NavItem } from "@keystar/ui/nav-list";
import { Blanket } from "@keystar/ui/overlays";
import { StatusLight } from "@keystar/ui/status-light";
import {
  breakpoints,
  css,
  tokenSchema,
  transition,
  useBreakpoint,
} from "@keystar/ui/style";
import { Text } from "@keystar/ui/typography";
import { usePrevious } from "@keystar/ui/utils";

import l10nMessages from "../../l10n";
import { useRouter } from "../../router";
import { ItemOrGroup, useNavItems } from "../../useNavItems";
import { isDemoConfig } from "../../utils";

import { useBrand } from "../common";
import { SIDE_PANEL_ID } from "../constants";
import { useExpandedNavGroups } from "./collapsed-groups";
import { ThemeMenu, UserActions } from "./components";
import { useAppState, useConfig } from "../context";

const SidebarContext = createContext<OverlayTriggerState | null>(null);
export function useSidebar() {
  let context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be within a SidebarProvider");
  }
  return context;
}

const breakpointNames = typedKeys(breakpoints);
export function SidebarProvider(props: { children: ReactNode }) {
  const matchedBreakpoints = useBreakpoint();
  const state = useOverlayTriggerState({
    defaultOpen: matchedBreakpoints.includes("desktop"),
  });

  let breakpointIndex = breakpointNames.indexOf(matchedBreakpoints[0]);
  let previousIndex = usePrevious(breakpointIndex) || 0;

  useUpdateEffect(() => {
    let larger = previousIndex < breakpointIndex;
    if (larger && breakpointIndex >= 2) {
      state.open();
    } else if (breakpointIndex < 2) {
      state.close();
    }
  }, [matchedBreakpoints]);

  return (
    <SidebarContext.Provider value={state}>
      {props.children}
    </SidebarContext.Provider>
  );
}

export function SidebarPanel() {
  return (
    <VStack backgroundColor="surface" height="100%">
      <SidebarHeader />
      <SidebarNav />
      <SidebarFooter />
    </VStack>
  );
}

function SidebarHeader() {
  let config = useConfig();
  // r2 has a real signed-in identity (email + logout), so it gets the
  // footer treatment below, not this header shortcut - only demo (no
  // identity at all) moves ThemeMenu up here.
  let isLocal = isDemoConfig(config);
  let { brandMark } = useBrand();

  return (
    <HStack
      alignItems="center"
      gap="regular"
      paddingY="regular"
      paddingX="medium"
      height={{ mobile: "element.large", tablet: "element.xlarge" }}
    >
      <HStack
        flex
        alignItems="center"
        gap="regular"
        UNSAFE_className={css({
          // let consumers use "currentColor" in SVG for their brand mark
          color: tokenSchema.color.foreground.neutralEmphasis,

          // ensure that the brand mark doesn't get squashed
          "& :first-child": {
            flexShrink: 0,
          },
        })}
      >
        <a href="/">{brandMark}</a>
      </HStack>
      {isLocal && <ThemeMenu />}
    </HStack>
  );
}

// in demo mode there's no user identity, so we hide the footer and move the
// theme menu to the header. r2 has a real signed-in user, so it keeps the
// footer for UserActions (email + logout).
function SidebarFooter() {
  let config = useConfig();
  if (isDemoConfig(config)) {
    return null;
  }
  return (
    <HStack
      alignItems="center"
      paddingY="regular"
      paddingX="medium"
      gap="regular"
    >
      <UserActions />
      <ThemeMenu />
    </HStack>
  );
}

export function SidebarDialog() {
  const state = useSidebar();
  const router = useRouter();

  // close the sidebar when the route changes
  useUpdateEffect(() => {
    state.close();
  }, [router.href]);

  let dialogRef = useRef<HTMLDivElement>(null);
  let { modalProps, underlayProps } = useModalOverlay(
    { isDismissable: true },
    state,
    dialogRef,
  );

  return (
    <>
      <Blanket {...underlayProps} isOpen={state.isOpen} zIndex={10} />
      <div
        data-visible={state.isOpen}
        id={SIDE_PANEL_ID}
        ref={dialogRef}
        {...modalProps}
        // styles
        className={css({
          backgroundColor: tokenSchema.color.background.surface,
          boxShadow: `${tokenSchema.size.shadow.large} ${tokenSchema.color.shadow.regular}`,
          display: "flex",
          flexDirection: "column",
          inset: 0,
          insetInlineEnd: "auto",
          // ensure that there's always enough of gutter for the user to press
          // and exit the sidebar
          maxWidth: `calc(100% - ${tokenSchema.size.element.medium})`,
          minWidth: tokenSchema.size.scale[3000],
          outline: 0,
          pointerEvents: "none",
          position: "fixed",
          transform: "translateX(-100%)",
          visibility: "hidden",
          zIndex: 10,

          // exit animation
          transition: [
            transition("transform", {
              easing: "easeIn",
              duration: "short",
              // delay: 'short',
            }),
            transition("visibility", {
              delay: "regular",
              duration: 0,
              easing: "linear",
            }),
          ].join(", "),

          "&[data-visible=true]": {
            transform: "translateX(0)",
            // enter animation
            transition: transition("transform", { easing: "easeOut" }),
            pointerEvents: "auto",
            visibility: "visible",
          },
        })}
      >
        <SidebarHeader />
        <SidebarNav />
        <SidebarFooter />
        <DismissButton onDismiss={state.close} />
      </div>
    </>
  );
}

export function SidebarNav() {
  const { basePath } = useAppState();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const navItems = useNavItems();
  const isCurrent = useIsCurrent();
  const [expandedGroups, toggleGroup] = useExpandedNavGroups();

  return (
    <ScrollView flex paddingY="large" paddingEnd="medium">
      <NavList>
        <NavItem
          href={basePath}
          aria-current={isCurrent(basePath, { exact: true })}
        >
          {stringFormatter.format("dashboard")}
        </NavItem>

        {navItems.map((item, i) => (
          <NavItemOrGroup
            key={i}
            itemOrGroup={item}
            expandedGroups={expandedGroups}
            onToggleGroup={toggleGroup}
          />
        ))}
      </NavList>
    </ScrollView>
  );
}

// Utils
// ----------------------------------------------------------------------------

function useIsCurrent() {
  const router = useRouter();
  return useCallback(
    (href: string, { exact = false } = {}) => {
      if (exact) {
        return href === router.pathname ? "page" : undefined;
      }
      return href === router.pathname || router.pathname.startsWith(`${href}/`)
        ? "page"
        : undefined;
    },
    [router.pathname],
  );
}

// Renderers
// ----------------------------------------------------------------------------
type NavItemOrGroupProps = {
  itemOrGroup: ItemOrGroup;
  expandedGroups: Set<string>;
  onToggleGroup: (title: string) => void;
};

function NavItemOrGroup({
  itemOrGroup,
  expandedGroups,
  onToggleGroup,
}: NavItemOrGroupProps) {
  const isCurrent = useIsCurrent();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  if (itemOrGroup.isDivider) {
    return <Divider />;
  }

  if (itemOrGroup.children) {
    return (
      <CollapsibleNavGroup
        title={itemOrGroup.title}
        collapsed={!expandedGroups.has(itemOrGroup.title)}
        onToggle={() => onToggleGroup(itemOrGroup.title)}
      >
        {itemOrGroup.children.map((child, i) => (
          <NavItemOrGroup
            itemOrGroup={child}
            key={i}
            expandedGroups={expandedGroups}
            onToggleGroup={onToggleGroup}
          />
        ))}
      </CollapsibleNavGroup>
    );
  }

  let changeElement = (() => {
    if (!itemOrGroup.changed) {
      return null;
    }

    return typeof itemOrGroup.changed === "number" ? (
      <Badge tone="accent" marginStart="auto">
        <Text>{itemOrGroup.changed}</Text>
        <Text visuallyHidden>
          {stringFormatter.format("changeWord", { count: itemOrGroup.changed })}
        </Text>
      </Badge>
    ) : (
      <StatusLight
        tone="accent"
        marginStart="auto"
        aria-label={stringFormatter.format("changedLabel")}
        role="status"
      />
    );
  })();

  return (
    <NavItem href={itemOrGroup.href} aria-current={isCurrent(itemOrGroup.href)}>
      {itemOrGroup.icon && <Icon src={itemOrGroup.icon} />}
      <Text truncate title={itemOrGroup.label}>
        {itemOrGroup.label}
      </Text>
      {changeElement}
    </NavItem>
  );
}

// A collapsible stand-in for @keystar/ui/nav-list's NavGroup (which has no
// expand/collapse of its own - see its "collapsible?" TODO) - same heading
// look and list semantics, plus a toggle button and a real height animation
// (grid-template-rows 0fr → 1fr, not a fixed max-height guess) instead of
// just mounting/unmounting the group's children.
function CollapsibleNavGroup(props: {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const { title, collapsed, onToggle, children } = props;
  const baseId = useId();
  const headingId = `${baseId}-heading`;
  const bodyId = `${baseId}-body`;

  return (
    <li
      className={css({
        "&:not(:first-child)": {
          marginBlockStart: tokenSchema.size.space.regular,
        },
        "&:not(:last-child)": {
          marginBlockEnd: tokenSchema.size.space.regular,
        },
      })}
    >
      <button
        type="button"
        id={headingId}
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-controls={bodyId}
        className={css({
          alignItems: "center",
          background: "none",
          border: 0,
          color: tokenSchema.color.foreground.neutralSecondary,
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          gap: tokenSchema.size.space.small,
          paddingBlock: tokenSchema.size.space.regular,
          paddingInlineEnd: tokenSchema.size.space.medium,
          paddingInlineStart: tokenSchema.size.space.medium,
          textAlign: "start",
          width: "100%",
          "&:hover": {
            color: tokenSchema.color.foreground.neutralEmphasis,
          },
          "& svg": {
            flexShrink: 0,
            transition: transition("transform", { easing: "easeOut" }),
          },
          '&[aria-expanded="false"] svg': {
            transform: "rotate(-90deg)",
          },
        })}
      >
        <Text
          elementType="span"
          truncate
          size="small"
          weight="bold"
          color="neutralTertiary"
          UNSAFE_className={css({ textTransform: "uppercase" })}
        >
          {title}
        </Text>
        <Icon src={chevronDownIcon} size="small" />
      </button>
      <div
        className={css({
          display: "grid",
          gridTemplateRows: "0fr",
          transition: transition("grid-template-rows", { easing: "easeOut" }),
          '&[data-expanded="true"]': {
            gridTemplateRows: "1fr",
          },
        })}
        data-expanded={!collapsed}
      >
        <div className={css({ minHeight: 0, overflow: "hidden" })}>
          <Box
            elementType="ul"
            id={bodyId}
            aria-labelledby={headingId}
            flexShrink={0}
          >
            {children}
          </Box>
        </div>
      </div>
    </li>
  );
}
