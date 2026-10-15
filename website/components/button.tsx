import type { AnchorHTMLAttributes, ReactNode } from 'react';

const variants = {
  primary: 'border-transparent bg-ink text-paper hover:opacity-90',
  ghost: 'border-rule bg-sheet text-ink hover:border-ink-3',
};

type ButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: keyof typeof variants;
};

/** A link that looks like a button. */
export function ButtonLink({ variant = 'primary', className = '', ...props }: ButtonLinkProps) {
  return (
    <a
      className={`inline-flex items-center gap-2 rounded-[10px] border px-4.5 py-2.75 text-15 leading-none font-semibold transition ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

/** A row of buttons. */
export function Actions({
  className = 'mt-8',
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={`flex flex-wrap gap-3 ${className}`}>{children}</div>;
}
