import { Breadcrumbs, Item } from "@keystar/ui/breadcrumbs";
import { Key, memo } from "react";

type HeaderBreadcrumbsProps = {
  /** The breadcrumb items. */
  items: { key: Key; label: string; href?: string }[];
};

export const HeaderBreadcrumbs = memo((props: HeaderBreadcrumbsProps) => (
  <Breadcrumbs flex size="medium" minWidth="alias.singleLineWidth">
    {props.items.map((item) => (
      // spread conditionally rather than `href={item.href}` - react-aria's
      // useLinkProps checks `'href' in props`, not truthiness, so passing
      // `href={undefined}` still resolves to href="" on the rendered element
      <Item key={item.key} {...(item.href ? { href: item.href } : {})}>
        {item.label}
      </Item>
    ))}
  </Breadcrumbs>
));
