-- =============================================================================
-- ERP v2 — test de la lógica de agrupación
--
-- Las filas ASD1..ASD6 del legacy NO se pueden cargar desde el CSV de muestra:
-- su descripción trae una coma y el export las parte. Acá se insertan con los
-- valores correctos (leídos del export original) para probar que la lógica de
-- agrupación, el eje de color de piedra y la extracción de piedras funcionan.
--
-- Correr DESPUÉS de 010..030, en lugar de la carga de CSV.
-- =============================================================================
BEGIN;

-- Los 6 artículos son el MISMO anillo en 5 tallas, dos de ellos en talla 14
-- con distinto color de piedra. Misma descripción, mismo precio 566.
INSERT INTO legacy.almacen_articulo (
  codigo_articulo, id_tipo, codigo, codigo_ala, codigo_cla_alhajas,
  codigo_tipo_piedra, codigo_clase_piedra, codigo_color, id_color_metal, id_tipo_moneda,
  nombre, descripcion, peso, medida,
  porcentaje_comerciante, precio_comerciante, porc_mayor, precio_mayor,
  porcenteje, precio, clave, stock, stock_minimo, activo, numero, moneda,
  fecha_ingreso, dejar_usar, favorito, ind_producto, ind_estado, ind_registro,
  usuario_registro, fecha_registro)
VALUES
  ('ASD1','1','A','S','D','5','15','01','20','1','RivierP2_01',
   '@cruzado aro con 20 pi 2.5 mm espesor 2mm, y aro pulido 2.5 mm espesor 1.5mm',
   '4','16','18','236','50','354','60','566','EDN.BB','0','1','y','1','Soles',
   '2026-09-28','N','N','2','1','1','ASANDOVAL','2026-09-28 11:37:13'),
  ('ASD2','1','A','S','D','5','15','01','20','1','RivierP2_01',
   '@cruzado aro con 20 pi 2.5 mm espesor 2mm, y aro pulido 2.5 mm espesor 1.5mm',
   '4','15','18','236','50','354','60','566','EDN.BB','0','1','y','2','Soles',
   '2026-09-28','N','N','2','1','1','ASANDOVAL','2026-09-28 11:51:00'),
  ('ASD3','1','A','S','D','5','15','02','20','1','RivierP2_02',
   '@cruzado aro con 20 pi 2.5 mm espesor 2mm, y aro pulido 2.5 mm espesor 1.5mm',
   '4','14','18','236','50','354','60','566','EDN.BB','0','1','y','3','Soles',
   '2026-09-28','N','N','2','1','1','ASANDOVAL','2026-09-28 11:54:09'),
  ('ASD4','1','A','S','D','5','15','01','20','1','RivierP2_01',
   '@cruzado aro con 20 pi 2.5 mm espesor 2mm, y aro pulido 2.5 mm espesor 1.5mm',
   '4','17','18','236','50','354','60','566','EDN.BB','0','1','y','4','Soles',
   '2026-09-28','N','N','2','1','1','ASANDOVAL','2026-09-28 12:03:31'),
  ('ASD5','1','A','S','D','5','15','04','20','1','RivierP2_04',
   '@cruzado aro con 20 pi 2.5 mm espesor 2mm, y aro pulido 2.5 mm espesor 1.5mm',
   '4','11','18','236','50','354','60','566','EDN.BB','0','1','y','5','Soles',
   '2026-09-28','N','N','2','1','1','ASANDOVAL','2026-09-28 12:05:49'),
  ('ASD6','1','A','S','D','5','15','01','20','1','RivierP2_01',
   '@cruzado aro con 20 pi 2.5 mm espesor 2mm, y aro pulido 2.5 mm espesor 1.5mm',
   '4','14','18','236','50','354','60','566','EDN.BB','0','1','y','6','Soles',
   '2026-09-28','N','N','2','1','1','ASANDOVAL','2026-09-28 12:08:38');

-- también las dos piezas de artesanía idénticas, para probar los alias
INSERT INTO legacy.almacen_articulo (
  codigo_articulo, id_tipo, codigo, codigo_ala, codigo_cla_alhajas,
  id_color_metal, id_tipo_moneda, nombre, descripcion, imagen, peso, medida,
  porcenteje, precio, precio_producto, clave, stock, stock_minimo, activo, numero,
  moneda, fecha_ingreso, dejar_usar, favorito, usuario_registro)
VALUES
  ('CHI114','1','C','H','I','20','1','Cochola',
   'circular estampado embutido cobre y bronce llama y cholita 28.5*28.5cm',
   'C:\Sistema Minitta\imagen\Cochola.jpg','250','30','100','83.2','41.6','NH.LB',
   '0','1','y','114','Soles','2009-02-28','N','N','JAVIER'),
  ('CHI115','1','C','H','I','20','1','Cochola',
   'circular estampado embutido cobre y bronce llama y cholita 28.5*28.5cm',
   'C:\Sistema Minitta\imagen\Cochola.jpg','256.5','30','100','83.2','41.6','NH.LB',
   '0','1','y','115','Soles','2009-02-28','N','N','JAVIER');

COMMIT;

\echo ''
\echo '=== TEST DE AGRUPACIÓN ==='
\i 040_catalog.sql
\i 050_pricing.sql

\echo ''
\echo '--- esperado: 1 producto RIV (ASD) con 6 variantes en 5 tallas'
SELECT p.code, p.name, p.status, count(v.id) AS variantes,
       string_agg(v.legacy_code, ',' ORDER BY v.legacy_code) AS legacy
FROM catalog.product p JOIN catalog.variant v ON v.product_id = p.id
WHERE p.legacy_code = 'ASD'
GROUP BY p.id, p.code, p.name, p.status;

\echo ''
\echo '--- las 6 variantes: la talla y el color de piedra son ejes distintos'
SELECT v.legacy_code, v.sku, sv.label AS talla, v.stone_color, v.weight_g
FROM catalog.variant v
JOIN catalog.product p ON p.id = v.product_id
LEFT JOIN catalog.size_value sv ON sv.id = v.size_value_id
WHERE p.legacy_code = 'ASD'
ORDER BY v.legacy_code;

\echo ''
\echo '--- las "20 pi 2.5 mm" de la descripción, ahora como dato'
SELECT v.legacy_code, s.name AS piedra, vs.color_code, vs.quantity, vs.size_mm
FROM catalog.variant_stone vs
JOIN catalog.variant v ON v.id = vs.variant_id
JOIN catalog.product p ON p.id = v.product_id
JOIN catalog.stone   s ON s.id = vs.stone_id
WHERE p.legacy_code = 'ASD'
ORDER BY v.legacy_code;

\echo ''
\echo '--- un precio por lista, no 566 repetido 6 veces'
SELECT pl.code AS lista, count(*) AS precios, min(pr.amount) AS monto
FROM pricing.price pr
JOIN pricing.price_list pl ON pl.id = pr.price_list_id
JOIN catalog.variant v ON v.id = pr.variant_id
JOIN catalog.product p ON p.id = v.product_id
WHERE p.legacy_code = 'ASD'
GROUP BY pl.code ORDER BY pl.code;

\echo ''
\echo '--- CHI114 y CHI115: una variante, dos piezas (alias), pesos distintos'
SELECT a.legacy_code, a.is_representative, a.peso, v.sku
FROM migration.variant_alias a
JOIN catalog.variant v ON v.id = a.variant_id
WHERE a.legacy_code IN ('CHI114','CHI115')
ORDER BY a.legacy_code;

\echo ''
\echo '--- cobertura: los 8 códigos del legacy tienen destino'
SELECT count(*) AS legacy_con_destino
FROM migration.variant_alias
WHERE legacy_code IN ('ASD1','ASD2','ASD3','ASD4','ASD5','ASD6','CHI114','CHI115');
