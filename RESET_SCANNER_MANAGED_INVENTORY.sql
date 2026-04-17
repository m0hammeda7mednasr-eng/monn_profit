-- Optional:
-- Add `where store_id = 'YOUR_STORE_ID'` to the UPDATE statements below
-- if you want to reset one store only instead of every store.
--
-- This script resets only the scanner-managed warehouse stock.
-- It does NOT change Shopify inventory fields on the product.

update public.products
set
  data = case
    when jsonb_typeof(coalesce(data, '{}'::jsonb)) = 'object' then
      jsonb_set(
        case
          when jsonb_typeof(coalesce(data, '{}'::jsonb)->'variants') = 'array' then
            jsonb_set(
              (
                coalesce(data, '{}'::jsonb)
                - '_moon_profit_warehouse_last_scanned_at'
                - '_moon_profit_warehouse_last_movement_type'
                - '_moon_profit_warehouse_last_movement_quantity'
                - '_moon_profit_warehouse_created_at'
                - '_moon_profit_warehouse_updated_at'
              ),
              '{variants}',
              coalesce(
                (
                  select jsonb_agg(
                    case
                      when jsonb_typeof(variant_item) = 'object' then
                        jsonb_set(
                          (
                            variant_item
                            - '_moon_profit_warehouse_last_scanned_at'
                            - '_moon_profit_warehouse_last_movement_type'
                            - '_moon_profit_warehouse_last_movement_quantity'
                            - '_moon_profit_warehouse_created_at'
                            - '_moon_profit_warehouse_updated_at'
                          ),
                          '{_moon_profit_warehouse_quantity}',
                          '0'::jsonb,
                          true
                        )
                      else
                        variant_item
                    end
                  )
                  from jsonb_array_elements(coalesce(data, '{}'::jsonb)->'variants') as variant_item
                ),
                '[]'::jsonb
              ),
              true
            )
          else
            (
              coalesce(data, '{}'::jsonb)
              - '_moon_profit_warehouse_last_scanned_at'
              - '_moon_profit_warehouse_last_movement_type'
              - '_moon_profit_warehouse_last_movement_quantity'
              - '_moon_profit_warehouse_created_at'
              - '_moon_profit_warehouse_updated_at'
            )
        end,
        '{_moon_profit_warehouse_quantity}',
        '0'::jsonb,
        true
      )
    else
      jsonb_build_object('_moon_profit_warehouse_quantity', 0)
  end;

do $$
begin
  if to_regclass('public.warehouse_inventory') is not null then
    execute $warehouse$
      update public.warehouse_inventory
      set
        quantity = 0,
        last_movement_quantity = 0,
        last_scanned_at = now(),
        updated_at = now()
    $warehouse$;
  end if;

  -- Optional clean start for scanner history too:
  -- if to_regclass('public.warehouse_scan_events') is not null then
  --   execute 'delete from public.warehouse_scan_events';
  -- end if;
end $$;
