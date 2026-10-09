import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const buttonVariants = cva(
  // The shared `.btn` class carries size, radius, weight and the press
  // response; variants below only choose colour. See globals.css.
  "btn group/button focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 outline-none select-none disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "btn-primary",
        outline: "btn-secondary",
        secondary: "btn-secondary",
        ghost: "btn-ghost",
        destructive: "btn-danger",
        link: "text-accent underline-offset-4 hover:underline h-auto px-0",
      },
      size: {
        default: "",
        xs: "btn-sm",
        sm: "btn-sm",
        lg: "btn-lg",
        icon: "size-12 px-0",
        "icon-xs": "size-10 px-0",
        "icon-sm": "size-10 px-0",
        "icon-lg": "size-14 px-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
