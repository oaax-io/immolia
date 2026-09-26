
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS price_monthly numeric(10,2) NULL CHECK (price_monthly IS NULL OR price_monthly >= 0),
  ADD COLUMN IF NOT EXISTS price_yearly numeric(10,2) NULL CHECK (price_yearly IS NULL OR price_yearly >= 0),
  ADD COLUMN IF NOT EXISTS currency text NULL CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  ADD COLUMN IF NOT EXISTS is_custom boolean NULL;
ALTER TABLE public.credit_action_costs DROP CONSTRAINT credit_action_costs_category_check;
ALTER TABLE public.credit_action_costs ADD CONSTRAINT credit_action_costs_category_check
  CHECK (category IN ('ai','communication','documents','data','marketing','publishing','financing','media','storage','users'));
