ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS sub_type text NULL;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS floor_load numeric NULL;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS ev_charging text NULL;