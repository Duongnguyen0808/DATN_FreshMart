DO $$
DECLARE
  next_code BIGINT;
BEGIN
  SELECT GREATEST(
    COALESCE((SELECT MAX(code::numeric) FROM products WHERE code ~ '^[0-9]+$'), 0),
    COALESCE((SELECT MAX(code::numeric) FROM skus WHERE code ~ '^[0-9]+$'), 0),
    99999
  ) + 1
    INTO next_code;

  EXECUTE format('CREATE SEQUENCE product_code_sequence START WITH %s', next_code);
END $$;
