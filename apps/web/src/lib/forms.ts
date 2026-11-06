import { useState } from 'react';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from './api';

/**
 * Mutación estándar de formulario: muestra el error de la API (que ya viene en
 * español, incluidos los RAISE EXCEPTION de la base) y guarda los errores por campo.
 */
export function useSave<TBody, TRes>(
  fn: (body: TBody) => Promise<TRes>,
  opts: { success?: string; invalidate?: QueryKey[]; onSuccess?: (r: TRes) => void } = {},
) {
  const qc = useQueryClient();
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const m = useMutation({
    mutationFn: fn,
    onMutate: () => setFields({}),
    onSuccess: (r) => {
      opts.invalidate?.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      if (opts.success) toast.success(opts.success);
      opts.onSuccess?.(r);
    },
    onError: (e: Error) => {
      if (e instanceof ApiError) setFields(e.fields);
      toast.error(e.message);
    },
  });
  return { ...m, fields, setFields };
}
