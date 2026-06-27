import type * as React from "react"

// Allow the Iconify <iconify-icon> web component inside React/TSX islands.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "iconify-icon": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        icon: string
        width?: string | number
        height?: string | number
        inline?: boolean
        mode?: string
      }
    }
  }
}
