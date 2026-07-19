import { useState } from "react";
import { HexAlphaColorPicker, HexColorInput } from "react-colorful";
import { Button, ButtonGroup } from "@keystar/ui/button";
import { Dialog, useDialogContainer } from "@keystar/ui/dialog";
import { Flex } from "@keystar/ui/layout";
import { Content } from "@keystar/ui/slots";
import { css, tokenSchema } from "@keystar/ui/style";
import { Heading } from "@keystar/ui/typography";
import { useRecentTextColors } from "../recent-colors";

// react-colorful's own hex/alpha shorthand handling accepts 3/4/6/8-digit
// hex - normalize to this mark's canonical 8-digit lowercase form (matching
// TEXT_COLOR_VALUE_PATTERN in schema.tsx) so a value typed as shorthand still
// passes the parser's validator once it round-trips through disk.
function normalizeHexAlpha(value: string): string | null {
  const hex = value.replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{8}$/.test(hex)) return `#${hex}`;
  if (/^[0-9a-f]{6}$/.test(hex)) return `#${hex}ff`;
  if (/^[0-9a-f]{4}$/.test(hex)) {
    const [r, g, b, a] = hex;
    return `#${r}${r}${g}${g}${b}${b}${a}${a}`;
  }
  if (/^[0-9a-f]{3}$/.test(hex)) {
    const [r, g, b] = hex;
    return `#${r}${r}${g}${g}${b}${b}ff`;
  }
  return null;
}

const pickerClass = css({
  width: "100%",
  "& .react-colorful": { width: "100%" },
});

const swatchButtonClass = css({
  width: tokenSchema.size.icon.large,
  height: tokenSchema.size.icon.large,
  borderRadius: tokenSchema.size.radius.small,
  border: `1px solid ${tokenSchema.color.alias.borderIdle}`,
  padding: 0,
  cursor: "pointer",

  "&:disabled": {
    cursor: "default",
    opacity: 0.4,
  },
});

const hexInputClass = css({
  width: "100%",
  boxSizing: "border-box",
  height: tokenSchema.size.element.regular,
  paddingInline: tokenSchema.size.space.regular,
  borderRadius: tokenSchema.size.radius.regular,
  border: `1px solid ${tokenSchema.color.alias.borderIdle}`,
  font: "inherit",
  color: tokenSchema.color.alias.foregroundIdle,
  background: "transparent",

  "&:focus": {
    outline: "none",
    borderColor: tokenSchema.color.alias.borderFocused,
  },
});

export function TextColorDialog(props: {
  initialValue: string | undefined;
  mixed: boolean;
  onSubmit: (value: string | null) => void;
}) {
  const { dismiss } = useDialogContainer();
  const [value, setValue] = useState(props.initialValue ?? "#000000ff");
  const [recentColors, pushRecentColor] = useRecentTextColors();
  const canRemove = !!props.initialValue || props.mixed;
  const normalized = normalizeHexAlpha(value);

  return (
    <Dialog size="small">
      <Heading>Text color</Heading>
      <Content>
        <Flex direction="column" gap="large">
          <HexAlphaColorPicker
            className={pickerClass}
            color={normalized ?? value}
            onChange={setValue}
          />
          <HexColorInput
            className={hexInputClass}
            color={value}
            onChange={setValue}
            prefixed
            alpha
            placeholder={props.mixed ? "Mixed" : undefined}
            aria-label="Hex"
          />
          <Flex gap="small">
            {Array.from({ length: 6 }).map((_, i) => {
              const recent = recentColors[i];
              return (
                <button
                  key={i}
                  type="button"
                  aria-label={recent ? `Recent color ${recent}` : "Empty"}
                  disabled={!recent}
                  className={swatchButtonClass}
                  style={{ background: recent ?? "transparent" }}
                  onClick={() => recent && setValue(recent)}
                />
              );
            })}
          </Flex>
        </Flex>
      </Content>
      <ButtonGroup>
        <Button onPress={dismiss}>Cancel</Button>
        <Button
          tone="critical"
          isDisabled={!canRemove}
          onPress={() => {
            dismiss();
            props.onSubmit(null);
          }}
        >
          Remove color
        </Button>
        <Button
          prominence="high"
          isDisabled={!normalized}
          onPress={() => {
            if (!normalized) return;
            dismiss();
            pushRecentColor(normalized);
            props.onSubmit(normalized);
          }}
        >
          Save
        </Button>
      </ButtonGroup>
    </Dialog>
  );
}
