import { useProvider } from "@keystar/ui/core";
import { tokenSchema, useMediaQuery } from "@keystar/ui/style";

import { serializeRepoConfig } from "../repo-config";
import { useConfig } from "./context";

export function useBrand() {
  let { colorScheme } = useProvider();
  let config = useConfig();
  let prefersDark = useMediaQuery("(prefers-color-scheme: dark)");

  let brandMark = <DrystackLogo />;

  if (config.ui?.brand?.mark) {
    let BrandMark = config.ui.brand.mark;
    let resolvedColorScheme =
      colorScheme === "auto" ? (prefersDark ? "dark" : "light") : colorScheme;

    brandMark = <BrandMark colorScheme={resolvedColorScheme} />;
  }

  return { brandMark };
}

function DrystackLogo() {
  const size = 32;
  const { neutral } = tokenSchema.color.foreground;
  const accent = "var(--kui-color-background-accent-emphasis)";
  return (
    <svg
      width={size * 5}
      height={size}
      viewBox="0 0 160 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Drystack"
    >
      <rect
        x="0.75"
        y="0.75"
        width="30.5"
        height="30.5"
        rx="9"
        fill="none"
        stroke={accent}
        strokeWidth="1.5"
      />
      <svg x="7" y="7" width="18" height="18" viewBox="0 0 24 24" fill={accent}>
        <path d="M4.979 9.685C2.993 8.891 2 8.494 2 8s.993-.89 2.979-1.685l2.808-1.123C9.773 4.397 10.767 4 12 4s2.227.397 4.213 1.192l2.808 1.123C21.007 7.109 22 7.506 22 8s-.993.89-2.979 1.685l-2.808 1.124C14.227 11.603 13.233 12 12 12s-2.227-.397-4.213-1.191z" />
        <path
          fillRule="evenodd"
          d="M2 8c0 .494.993.89 2.979 1.685l2.808 1.124C9.773 11.603 10.767 12 12 12s2.227-.397 4.213-1.191l2.808-1.124C21.007 8.891 22 8.494 22 8s-.993-.89-2.979-1.685l-2.808-1.123C14.227 4.397 13.233 4 12 4s-2.227.397-4.213 1.192L4.98 6.315C2.993 7.109 2 7.506 2 8"
          clipRule="evenodd"
        />
        <path
          d="m5.766 10l-.787.315C2.993 11.109 2 11.507 2 12s.993.89 2.979 1.685l2.808 1.124C9.773 15.603 10.767 16 12 16s2.227-.397 4.213-1.191l2.808-1.124C21.007 12.891 22 12.493 22 12s-.993-.89-2.979-1.685L18.234 10l-2.021.809C14.227 11.603 13.233 12 12 12s-2.227-.397-4.213-1.191z"
          opacity=".7"
        />
        <path
          d="m5.766 14l-.787.315C2.993 15.109 2 15.507 2 16s.993.89 2.979 1.685l2.808 1.124C9.773 19.603 10.767 20 12 20s2.227-.397 4.213-1.192l2.808-1.123C21.007 16.891 22 16.494 22 16c0-.493-.993-.89-2.979-1.685L18.234 14l-2.021.809C14.227 15.603 13.233 16 12 16s-2.227-.397-4.213-1.191z"
          opacity=".4"
        />
      </svg>
      <text
        x="42"
        y="22"
        font-family="'Segoe UI', system-ui, sans-serif"
        font-size="18"
        font-weight="800"
        letter-spacing="-0.5"
      >
        <tspan fill={accent}>Dry</tspan>
        <tspan fill={neutral}>Stack</tspan>
        <tspan fill={neutral} fill-opacity="0.45">
          .dev
        </tspan>
      </text>
    </svg>
  );
}
