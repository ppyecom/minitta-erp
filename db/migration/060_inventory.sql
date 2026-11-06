-- =============================================================================
-- ERP v2 — migración 060: inventario
--
-- Decisión 5: el stock NO se migra. Los saldos del legacy ya están en conflicto
-- (BLX1 dice 160 en almacen_articulo y 89 en STOCKS). Migrarlos sería heredar
-- el descuadre y dejar el kardex torcido desde el primer día.
--
-- En su lugar: se deja el saldo legacy como REFERENCIA y se arma un inventario
-- físico de apertura por sede. Lo que la gente cuente es el saldo real.
-- =============================================================================

BEGIN;

SET LOCAL app.user_id = '1';
SET LOCAL app.client_info = 'migracion legacy->v2';

-- -----------------------------------------------------------------------------
-- 1. el saldo del legacy, conservado para comparar contra el conteo
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS migration.legacy_stock_snapshot CASCADE;
CREATE TABLE migration.legacy_stock_snapshot (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  legacy_code       text NOT NULL,
  variant_id        bigint REFERENCES catalog.variant(id),
  legacy_num_tienda int,
  location_id       bigint REFERENCES core.location(id),
  stock_en_stocks   numeric(14,3),     -- STOCKS.stock (por tienda)
  stock_en_articulo numeric(14,3),     -- almacen_articulo.STOCK (global)
  stock_minimo      numeric(14,3),
  legacy_estado     text,              -- el 'L' sin diccionario
  legacy_usuario    text,
  discrepancia      numeric(14,3)
);

INSERT INTO migration.legacy_stock_snapshot (
  legacy_code, variant_id, legacy_num_tienda, location_id,
  stock_en_stocks, stock_en_articulo, stock_minimo, legacy_estado, legacy_usuario, discrepancia)
SELECT btrim(st.codigo_articulo),
       v.variant_id,
       migration.to_int(st.num_tienda),
       ml.location_id,
       migration.to_numeric(st.stock),
       s.stock,
       s.stock_minimo,
       migration.clean_text(st.estado),
       migration.clean_text(st.modificado_por_usuario),
       migration.to_numeric(st.stock) - s.stock
FROM legacy.stocks st
LEFT JOIN migration.variant_alias v ON v.legacy_code = btrim(st.codigo_articulo)
LEFT JOIN migration.article_stage s ON s.legacy_code = btrim(st.codigo_articulo)
LEFT JOIN migration.map_location ml ON ml.legacy_num = migration.to_int(st.num_tienda);

-- el descuadre que ya existe hoy y nadie puede explicar
SELECT migration.log_exception('error','inventory','saldo_en_conflicto', legacy_code,
         format('STOCKS dice %s y almacen_articulo dice %s (diferencia %s): el conteo físico define el saldo real',
                stock_en_stocks, stock_en_articulo, discrepancia),
         jsonb_build_object('stocks', stock_en_stocks,
                            'articulo', stock_en_articulo,
                            'diferencia', discrepancia,
                            'tienda', legacy_num_tienda))
FROM migration.legacy_stock_snapshot
WHERE discrepancia IS NOT NULL AND discrepancia <> 0;

SELECT migration.log_exception('warning','inventory','stock_sin_variante', legacy_code,
         'STOCKS referencia un artículo que no existe en almacen_articulo',
         jsonb_build_object('tienda', legacy_num_tienda))
FROM migration.legacy_stock_snapshot WHERE variant_id IS NULL;

SELECT migration.log_exception('warning','inventory','stock_sin_sede', legacy_code,
         format('STOCKS referencia la tienda %s, que no tiene sede en v2', legacy_num_tienda),
         '{}')
FROM migration.legacy_stock_snapshot WHERE location_id IS NULL;

-- -----------------------------------------------------------------------------
-- 2. stock mínimo por sede: eso sí se migra, es configuración, no saldo
-- -----------------------------------------------------------------------------
INSERT INTO inventory.stock (variant_id, location_id, on_hand, min_quantity)
SELECT ls.variant_id, ls.location_id, 0, COALESCE(max(ls.stock_minimo), 0)
FROM migration.legacy_stock_snapshot ls
JOIN core.location l ON l.id = ls.location_id
WHERE ls.variant_id IS NOT NULL AND ls.location_id IS NOT NULL AND l.holds_stock
GROUP BY ls.variant_id, ls.location_id
ON CONFLICT (variant_id, location_id) DO UPDATE
  SET min_quantity = EXCLUDED.min_quantity;

SELECT migration.log_exception('info','inventory','stock_minimo_uniforme', NULL,
         format('el legacy tenía STOCK_MINIMO = %s en %s de %s artículos: conviene definir mínimos reales por sede',
                (SELECT mode() WITHIN GROUP (ORDER BY stock_minimo) FROM migration.article_stage),
                (SELECT count(*) FROM migration.article_stage
                  WHERE stock_minimo = (SELECT mode() WITHIN GROUP (ORDER BY stock_minimo)
                                        FROM migration.article_stage)),
                (SELECT count(*) FROM migration.article_stage)), '{}');

-- -----------------------------------------------------------------------------
-- 3. inventario de apertura: un conteo abierto por sede que maneja stock,
--    pre-cargado con lo que el legacy creía tener, para que la gente compare
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS migration.count_reference CASCADE;
CREATE TABLE migration.count_reference (
  count_sheet_id bigint NOT NULL REFERENCES inventory.count_sheet(id) ON DELETE CASCADE,
  variant_id     bigint NOT NULL REFERENCES catalog.variant(id),
  legacy_code    text,
  legacy_stocks  numeric(14,3),
  legacy_articulo numeric(14,3),
  PRIMARY KEY (count_sheet_id, variant_id)
);

DO $$
DECLARE
  r_loc record;
  v_sheet bigint;
  v_lines int;
BEGIN
  FOR r_loc IN
    SELECT DISTINCT l.id, l.code
    FROM core.location l
    JOIN migration.legacy_stock_snapshot ls ON ls.location_id = l.id
    WHERE l.holds_stock AND l.is_active
    ORDER BY l.code
  LOOP
    INSERT INTO inventory.count_sheet (code, location_id, is_opening, status, created_by, notes)
    VALUES ('APERTURA-' || r_loc.code, r_loc.id, true, 'open', 1,
            'Inventario de apertura del ERP v2. El saldo del legacy está en migration.count_reference como referencia, NO como verdad.')
    RETURNING id INTO v_sheet;

    INSERT INTO inventory.count_line (count_sheet_id, variant_id, system_qty, notes)
    SELECT v_sheet, ls.variant_id, 0,
           format('referencia legacy: STOCKS=%s, almacen_articulo=%s',
                  COALESCE(max(ls.stock_en_stocks)::text,'?'),
                  COALESCE(max(ls.stock_en_articulo)::text,'?'))
    FROM migration.legacy_stock_snapshot ls
    WHERE ls.location_id = r_loc.id AND ls.variant_id IS NOT NULL
    GROUP BY ls.variant_id
    ON CONFLICT (count_sheet_id, variant_id) DO NOTHING;

    INSERT INTO migration.count_reference
      (count_sheet_id, variant_id, legacy_code, legacy_stocks, legacy_articulo)
    SELECT v_sheet, ls.variant_id, max(ls.legacy_code),
           max(ls.stock_en_stocks), max(ls.stock_en_articulo)
    FROM migration.legacy_stock_snapshot ls
    WHERE ls.location_id = r_loc.id AND ls.variant_id IS NOT NULL
    GROUP BY ls.variant_id
    ON CONFLICT DO NOTHING;

    SELECT count(*) INTO v_lines FROM inventory.count_line WHERE count_sheet_id = v_sheet;
    PERFORM migration.log_exception('info','inventory','conteo_apertura_creado', r_loc.code,
      format('conteo de apertura %s con %s línea(s) por contar', 'APERTURA-' || r_loc.code, v_lines),
      jsonb_build_object('count_sheet_id', v_sheet, 'lineas', v_lines));
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 4. piezas serializadas: se crean vacías de stock, una por unidad que el
--    legacy creía tener. El conteo físico confirma cuáles existen de verdad.
-- -----------------------------------------------------------------------------
SELECT migration.log_exception('warning','inventory','series_por_crear', NULL,
         format('%s variante(s) quedaron en modo serial. Sus piezas se registran al contarlas (hay que pesar cada una), no se generan acá para no inventar códigos ni pesos.',
                count(*)), '{}')
FROM catalog.variant WHERE tracking_mode = 'serial';

-- -----------------------------------------------------------------------------
-- 5. control: después de esta etapa el inventario tiene que estar en cero
-- -----------------------------------------------------------------------------
DO $$
DECLARE v_mov int; v_onhand numeric;
BEGIN
  SELECT count(*) INTO v_mov FROM inventory.movement;
  SELECT COALESCE(sum(on_hand), 0) INTO v_onhand FROM inventory.stock;

  IF v_mov <> 0 OR v_onhand <> 0 THEN
    RAISE EXCEPTION
      'la migración no debe crear stock: hay % movimiento(s) y % unidad(es) en saldo',
      v_mov, v_onhand;
  END IF;

  PERFORM migration.log_exception('info','inventory','sin_stock_migrado', NULL,
    'correcto: la migración no creó movimientos ni saldos. El stock nace del conteo físico.', '{}');
END $$;

COMMIT;
