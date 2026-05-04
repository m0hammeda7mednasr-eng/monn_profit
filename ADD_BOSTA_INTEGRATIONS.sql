-- Persist Bosta API key per store (saved from Settings page)

CREATE TABLE IF NOT EXISTS public.bosta_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  api_key text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bosta_integrations_store_unique
ON public.bosta_integrations (store_id);

CREATE INDEX IF NOT EXISTS idx_bosta_integrations_is_active
ON public.bosta_integrations (is_active);

DROP TRIGGER IF EXISTS bosta_integrations_set_updated_at ON public.bosta_integrations;
CREATE TRIGGER bosta_integrations_set_updated_at
BEFORE UPDATE ON public.bosta_integrations
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

