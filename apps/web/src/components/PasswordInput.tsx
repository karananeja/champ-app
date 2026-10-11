import { useState, type ComponentProps } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type Props = Omit<ComponentProps<'input'>, 'type'>;

/**
 * A password field with a show/hide (eye) toggle inside it on the right (D-060). Each instance toggles on its
 * own. The toggle is not a tab stop, so Tab still goes from the field to the next field or the submit button.
 */
export function PasswordInput({ className, disabled, ...props }: Props) {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;
  return (
    <div className="relative">
      <Input type={visible ? 'text' : 'password'} disabled={disabled} className={cn('pr-10', className)} {...props} />
      <button
        type="button"
        tabIndex={-1}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        disabled={disabled}
        // Keep focus (and the caret) in the field when the icon is clicked.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
      >
        <Icon className="size-4" aria-hidden="true" data-icon={visible ? 'eye-off' : 'eye'} />
      </button>
    </div>
  );
}
