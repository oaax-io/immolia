ALTER TABLE public.financing_checklist_items
  ADD COLUMN IF NOT EXISTS auto_detected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_reason text NULL,
  ADD COLUMN IF NOT EXISTS manual_override boolean NOT NULL DEFAULT false;