import { useLocalizedStringFormatter } from "@react-aria/i18n";
import { isHotkey } from "is-hotkey";
import { useEffect, useRef, useState } from "react";

import { ActionButton } from "@keystar/ui/button";
import { Icon } from "@keystar/ui/icon";
import { searchIcon } from "@keystar/ui/icon/icons/searchIcon";
import { Flex } from "@keystar/ui/layout";
import { SearchField } from "@keystar/ui/search-field";
import {
  breakpointQueries,
  css,
  tokenSchema,
  useMediaQuery,
} from "@keystar/ui/style";
import { Tooltip, TooltipTrigger } from "@keystar/ui/tooltip";

import { ColumnsMenu } from "./ColumnsMenu";
import l10nMessages from "../l10n";

// document + magnifier glyph for the "search content" toggle - not part of
// @keystar/ui's stroke-icon set (see searchIcon), so its paths carry their
// own fill instead of relying on the shared --kui-icon-stroke variable.
// Authored for a 20x20 grid (Icon's wrapper svg hardcodes viewBox="0 0 24
// 24"), so scaled 1.2x (24/20) to fill the same box as every other icon.
const contentSearchIcon = (
  <path
    strokeWidth={0.5}
    fill="currentColor"
    fillRule="evenodd"
    d="M10.944 1.25h2.112c1.838 0 3.294 0 4.433.153c1.172.158 2.121.49 2.87 1.238c.748.749 1.08 1.698 1.238 2.87c.153 1.14.153 2.595.153 4.433v4.112c0 1.838 0 3.294-.153 4.433c-.158 1.172-.49 2.121-1.238 2.87c-.749.748-1.698 1.08-2.87 1.238c-1.14.153-2.595.153-4.433.153h-2.112c-1.838 0-3.294 0-4.433-.153c-1.172-.158-2.121-.49-2.87-1.238c-.748-.749-1.08-1.698-1.238-2.87c-.153-1.14-.153-2.595-.153-4.433V9.944c0-1.838 0-3.294.153-4.433c.158-1.172.49-2.121 1.238-2.87c.749-.748 1.698-1.08 2.87-1.238c1.14-.153 2.595-.153 4.433-.153M6.71 2.89c-1.006.135-1.586.389-2.01.812c-.422.423-.676 1.003-.811 2.009c-.138 1.028-.14 2.382-.14 4.289v4c0 1.907.002 3.262.14 4.29c.135 1.005.389 1.585.812 2.008s1.003.677 2.009.812c1.028.138 2.382.14 4.289.14h2c1.907 0 3.262-.002 4.29-.14c1.005-.135 1.585-.389 2.008-.812s.677-1.003.812-2.009c.138-1.027.14-2.382.14-4.289v-4c0-1.907-.002-3.261-.14-4.29c-.135-1.005-.389-1.585-.812-2.008s-1.003-.677-2.009-.812c-1.027-.138-2.382-.14-4.289-.14h-2c-1.907 0-3.261.002-4.29.14M7.25 10A.75.75 0 0 1 8 9.25h8a.75.75 0 0 1 0 1.5H8a.75.75 0 0 1-.75-.75m0 4a.75.75 0 0 1 .75-.75h5a.75.75 0 0 1 0 1.5H8a.75.75 0 0 1-.75-.75"
    clipRule="evenodd"
  />
);

// ActionButton's own `isSelected` styling is a neutral gray, targeted via a
// compound `&:not([data-prominence])[data-selected]` selector (see
// useActionButtonStyles.tsx) - there's no built-in prop for the app's
// primary/accent color. A same-specificity override here loses the
// cascade tie to that selector's extra `:not(...)` clause regardless of
// insertion order (module-level css() runs at import time, before
// ActionButton's own css() call from its first render, so ours is
// actually the *earlier* rule) - `!important` sidesteps the specificity
// fight entirely rather than trying to out-specify it. Colors match the
// `indigo9/10/11` scale steps the "Add" button (Button prominence="high"
// tone="accent") uses, so the toggle reads as the same primary color.
const contentSearchToggleStyle = css({
  "&[data-selected]": {
    backgroundColor: `${tokenSchema.color.scale.indigo9} !important`,
    borderColor: `${tokenSchema.color.scale.indigo9} !important`,
    color: `${tokenSchema.color.foreground.onEmphasis} !important`,
  },
  "&[data-selected][data-interaction=hover]": {
    backgroundColor: `${tokenSchema.color.scale.indigo10} !important`,
    borderColor: `${tokenSchema.color.scale.indigo10} !important`,
  },
  "&[data-selected][data-interaction=press]": {
    backgroundColor: `${tokenSchema.color.scale.indigo11} !important`,
    borderColor: `${tokenSchema.color.scale.indigo11} !important`,
  },
});

// The search + column-visibility toolbar used by the collection list
// (CollectionPage). The "search inside content" toggle is opt-in via
// `onSearchContentChange` - lists whose data model has no fields.content()
// body simply omit it and the toggle isn't rendered.
export function CollectionToolbar(props: {
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  columns: { key: string; label: string }[];
  hiddenColumns: ReadonlySet<string>;
  onHiddenColumnsChange: (hidden: Set<string>) => void;
  searchContent?: boolean;
  onSearchContentChange?: (value: boolean) => void;
}) {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const isAboveMobile = useMediaQuery(breakpointQueries.above.mobile);
  const [searchVisible, setSearchVisible] = useState(isAboveMobile);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSearchVisible(isAboveMobile);
  }, [isAboveMobile]);

  // entries are presented in a virtualized table view, so we replace the
  // default (e.g. ctrl+f) browser search behaviour
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      // bail if the search field is already focused; let users invoke the
      // browser search if they need to
      if (document.activeElement === searchRef.current) {
        return;
      }

      if (isHotkey("mod+f", event)) {
        event.preventDefault();
        searchRef.current?.select();
      }
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  return (
    <Flex
      alignItems="center"
      justifyContent="flex-end"
      gap="regular"
      paddingTop={{ tablet: "large" }}
      UNSAFE_className={css({
        // Tighter than the table below it: with the content toggle now always
        // on screen, the open search field and three buttons need the room.
        marginInline: tokenSchema.size.space.small,
        [breakpointQueries.above.mobile]: {
          marginInline: `calc(${tokenSchema.size.space.xlarge} - ${tokenSchema.size.space.medium})`,
        },
        [breakpointQueries.above.tablet]: {
          marginInline: `calc(${tokenSchema.size.space.xxlarge} - ${tokenSchema.size.space.medium})`,
        },
      })}
    >
      <Flex role="search" alignItems="center" gap="regular">
        <SearchField
          ref={searchRef}
          // Only the field itself collapses on mobile - the content toggle
          // beside it stays put, like the columns menu. It's a persistent
          // preference for how the collection is searched, so hiding it behind
          // the field made it look like it had been turned off.
          isHidden={!searchVisible}
          aria-label={stringFormatter.format("search")} // TODO: l10n "Search {collection}"?
          onChange={props.onSearchTermChange}
          onClear={() => {
            props.onSearchTermChange("");
            if (!isAboveMobile) {
              setTimeout(() => {
                setSearchVisible(false);
              }, 250);
            }
          }}
          onBlur={() => {
            if (!isAboveMobile && props.searchTerm === "") {
              setSearchVisible(false);
            }
          }}
          placeholder={stringFormatter.format("search")}
          value={props.searchTerm}
          width="scale.2400"
        />
        {props.onSearchContentChange && (
          <TooltipTrigger>
            <ActionButton
              aria-label={stringFormatter.format("searchContent")}
              isSelected={props.searchContent}
              onPress={() =>
                props.onSearchContentChange!(!props.searchContent)
              }
              UNSAFE_className={contentSearchToggleStyle}
            >
              <Icon src={contentSearchIcon} />
            </ActionButton>
            <Tooltip>{stringFormatter.format("searchContentHelp")}</Tooltip>
          </TooltipTrigger>
        )}
      </Flex>
      <ActionButton
        aria-label={stringFormatter.format("showSearchAriaLabel")}
        isHidden={searchVisible || { above: "mobile" }}
        onPress={() => {
          setSearchVisible(true);
          // NOTE: this hack is to force the search field to focus, and invoke
          // the software keyboard on mobile safari
          let tempInput = document.createElement("input");
          tempInput.style.position = "absolute";
          tempInput.style.opacity = "0";
          document.body.appendChild(tempInput);
          tempInput.focus();

          setTimeout(() => {
            searchRef.current?.focus();
            tempInput.remove();
          }, 0);
        }}
      >
        <Icon src={searchIcon} />
      </ActionButton>
      <ColumnsMenu
        columns={props.columns}
        hiddenColumns={props.hiddenColumns}
        onHiddenColumnsChange={props.onHiddenColumnsChange}
      />
    </Flex>
  );
}
