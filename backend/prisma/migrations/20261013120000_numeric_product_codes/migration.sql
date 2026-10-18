BEGIN;

DO $$
DECLARE
  code_base BIGINT;
  next_code BIGINT;
  previous_sequence_value BIGINT;
BEGIN
  SELECT last_value INTO previous_sequence_value FROM product_code_sequence;

  SELECT GREATEST(
    COALESCE((SELECT MAX(code::numeric) FROM products WHERE code ~ '^[0-9]+$'), 0),
    COALESCE((SELECT MAX(code::numeric) FROM skus WHERE code ~ '^[0-9]+$'), 0),
    previous_sequence_value,
    99999
  ) INTO code_base;

  WITH ranked_products AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt", id) AS ordinal
    FROM products
  )
  UPDATE products AS product
  SET code = (code_base + ranked_products.ordinal)::text
  FROM ranked_products
  WHERE product.id = ranked_products.id;

  SELECT GREATEST(
    COALESCE((SELECT MAX(code::numeric) FROM products WHERE code ~ '^[0-9]+$'), 0),
    COALESCE((SELECT MAX(code::numeric) FROM skus WHERE code ~ '^[0-9]+$'), 0),
    previous_sequence_value,
    99999
  ) + 1 INTO next_code;

  PERFORM setval('product_code_sequence', next_code, false);
END $$;

COMMIT;
