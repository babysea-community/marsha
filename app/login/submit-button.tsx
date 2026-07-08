'use client';

import { useFormStatus } from 'react-dom';

import { Button } from '@/components/ui/button';

export function LoginSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      disabled={pending}
      className="h-auto w-full px-4 py-3 text-sm font-semibold"
    >
      {pending ? 'Entering...' : 'Enter studio'}
    </Button>
  );
}
