-- =============================================================================
-- ERP v2 — 007 seed de referencia
-- Traduce las tablas de códigos de 1 letra del legacy a catálogos con nombre.
-- Cada fila lleva su legacy_code para que la migración pueda cruzar sin adivinar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- monedas  (TIPO_MONEDA)
-- -----------------------------------------------------------------------------
INSERT INTO core.currency (code, sunat_code, name, short_name, symbol, decimals, is_base) VALUES
  ('PEN','1','Soles','Soles','S/',2, true),
  ('USD','2','Dólares americanos','Dólares','US$',2, false),
  ('EUR','3','Euros','Euro','€',2, false);

-- -----------------------------------------------------------------------------
-- unidades  (no existían: PESO y MEDIDA eran números sin unidad)
-- -----------------------------------------------------------------------------
INSERT INTO core.unit (code, name, kind, factor_to_base) VALUES
  ('g','Gramo','mass',1),
  ('kg','Kilogramo','mass',1000),
  ('ct','Quilate (0.2 g)','mass',0.2),
  ('oz','Onza troy','mass',31.1034768),
  ('mm','Milímetro','length',1),
  ('cm','Centímetro','length',10),
  ('m','Metro','length',1000),
  ('und','Unidad','count',1),
  ('par','Par','count',2),
  ('jgo','Juego','count',1),
  ('doc','Docena','count',12),
  ('h','Hora','time',1);

-- -----------------------------------------------------------------------------
-- impuestos
-- -----------------------------------------------------------------------------
INSERT INTO core.tax_category (code, name, rate, sunat_afectacion) VALUES
  ('igv_18','IGV 18%',0.18,'10'),
  ('exonerado','Exonerado',0,'20'),
  ('inafecto','Inafecto',0,'30'),
  ('exportacion','Exportación',0,'40');

-- -----------------------------------------------------------------------------
-- usuarios de sistema
-- -----------------------------------------------------------------------------
INSERT INTO core.app_user (username, full_name, can_see_cost, is_system) VALUES
  ('migracion','Proceso de migración', true, true),
  ('ecommerce','Tienda online', false, true),
  ('sistema','Tareas automáticas', true, true);

-- -----------------------------------------------------------------------------
-- materiales  (material.csv, SIN las filas que no eran material)
-- -----------------------------------------------------------------------------
INSERT INTO catalog.material
  (code, name, family, purity_millis, karat, is_precious, is_priced_by_weight, legacy_code) VALUES
  ('AU24','Oro 24K','gold',999,24, true, true, NULL),
  ('AU21','Oro 21K','gold',875,21, true, true, 'L'),
  ('AU18','Oro 18K','gold',750,18, true, true, 'O'),
  ('AU14','Oro 14K','gold',585,14, true, true, 'Z'),
  ('AG925','Plata 925','silver',925,NULL, true, true, 'P'),
  ('AG-GEM','Plata con gemas','silver',925,NULL, true, true, 'J'),
  ('AG-AU18','Plata con oro 18K','silver',925,NULL, true, true, 'M'),
  ('PT','Platino','platinum',950,NULL, true, true, 'T'),
  ('ACERO','Acero quirúrgico','steel',NULL,NULL, false, false, 'U'),
  ('BRONCE','Bronce','bronze',NULL,NULL, false, false, 'B'),
  ('COBRE','Cobre','copper',NULL,NULL, false, false, 'C'),
  ('NIQUEL','Níquel','nickel',NULL,NULL, false, false, 'N'),
  ('FANTASIA','Fantasía','costume',NULL,NULL, false, false, 'A'),
  ('GOLD-FILLED','Gold filled','gold',NULL,NULL, false, false, 'G'),
  ('PLAQUE','Plaqué','other',NULL,NULL, false, false, 'Q'),
  ('BANADO','Bañado / enchapado','other',NULL,NULL, false, false, 'X'),
  ('CRISTAL-MAT','Cristal','other',NULL,NULL, false, false, 'K'),
  ('MARMOL','Mármol','marble',NULL,NULL, false, false, 'Y'),
  ('DIAMANTADO','Línea diamante','other',NULL,NULL, false, false, 'D'),
  ('VARIOS','Varios','other',NULL,NULL, false, false, 'V');

-- NOTA: las letras E (ESTUCHES), F (COMERCIAL), H (HERRAMIENTAS), I (IMAGEN-DISEÑO),
-- R (REGALO), S (SERV) y W (CATALOGO) NO son materiales: la migración las convierte
-- en catalog.product.kind = packaging / other / supply / marketing / gift / service.

-- -----------------------------------------------------------------------------
-- colores de metal  (Color_metal_articulo, descompuesto)
-- -----------------------------------------------------------------------------
INSERT INTO catalog.metal_color (code, name, hex, legacy_code) VALUES
  ('amarillo','Amarillo','#D4AF37','A'),
  ('blanco','Blanco','#E8E8E8','B'),
  ('rosa','Rosa','#E8B4A0','R'),
  ('negro','Negro','#2C2C2A','N'),
  ('plata','Plata','#C0C0C0','P'),
  ('plata_quemada','Plata quemada','#8A8A86','PQ'),
  ('satinado_plata','Satinado plata','#B8B8B4','S');

-- NOTA: 'N+A+B', 'A+R', 'R+A+B' del legacy se migran a metal_color +
-- secondary_metal_color; las combinaciones de 3 o más colores van a
-- catalog.variant_attribute_value con el detalle completo.

-- -----------------------------------------------------------------------------
-- acabados  (hoy en texto libre: "todo pul", "satinado")
-- -----------------------------------------------------------------------------
INSERT INTO catalog.finish (code, name) VALUES
  ('pulido','Pulido'),
  ('satinado','Satinado'),
  ('diamantado','Diamantado'),
  ('envejecido','Envejecido'),
  ('oxidado','Oxidado'),
  ('texturado','Texturado'),
  ('estampado','Estampado'),
  ('embutido','Embutido'),
  ('martillado','Martillado');

-- -----------------------------------------------------------------------------
-- formas de piedra y engastes  (no existían)
-- -----------------------------------------------------------------------------
INSERT INTO catalog.stone_cut (code, name) VALUES
  ('redonda','Redonda / brillante'),
  ('ovalada','Ovalada'),
  ('princesa','Princesa'),
  ('marquesa','Marquesa'),
  ('gota','Gota / pera'),
  ('esmeralda','Esmeralda'),
  ('corazon','Corazón'),
  ('baguette','Baguette'),
  ('cabujon','Cabujón'),
  ('talla_libre','Talla libre'),
  ('esferica','Esférica'),
  ('mostacilla','Mostacilla');

INSERT INTO catalog.setting_type (code, name) VALUES
  ('garra','Garra'),
  ('carril','Carril'),
  ('pave','Pavé'),
  ('cerrado','Cerrado / bisel'),
  ('pegado','Pegado'),
  ('cruzado','Cruzado'),
  ('tension','Tensión'),
  ('engarzado','Engarzado'),
  ('hilado','Hilado / alambre');

-- -----------------------------------------------------------------------------
-- colores  (color_piedra.csv, quedándose SÓLO con lo que es color)
-- -----------------------------------------------------------------------------
INSERT INTO catalog.color (code, name, legacy_code) VALUES
  ('cristalino','Cristalino','01'),
  ('rojo','Rojo','02'),
  ('verde','Verde','03'),
  ('azul','Azul','04'),
  ('rosa_francia','Rosa de Francia','05'),
  ('morado','Morado / amatista','06'),
  ('agua_marina','Agua marina','07'),
  ('naranja','Naranja / topacio','08'),
  ('negro','Negro','09'),
  ('plomo_oscuro','Plomo oscuro','011'),
  ('lavanda','Lavanda','014'),
  ('verde_berilo','Verde berilo','015'),
  ('fucsia','Fucsia','016'),
  ('champagne','Champagne','017'),
  ('topacio_suave','Topacio suave','018'),
  ('azul_zafiro','Azul zafiro','019'),
  ('violeta','Violeta','020'),
  ('granate','Granate','021'),
  ('limon','Limón','022'),
  ('verde_claro','Verde claro','023'),
  ('rojo_marron','Rojo marrón','025'),
  ('verde_jade','Verde jade','026'),
  ('turquesa','Turquesa','027'),
  ('amarillo','Amarillo','028'),
  ('verde_agua','Verde agua','029'),
  ('marron','Marrón','030'),
  ('tornasol','Tornasol','031'),
  ('vino','Vino','032'),
  ('bicolor','Bicolor','040'),
  ('alejandrina','Alejandrina','045'),
  ('citrino','Citrino','049'),
  ('topacio_rosa','Topacio rosa','050'),
  ('mixto','Mixto','0M'),
  ('ovalon','Ovalón (revisar)','024');

-- NOTA: los códigos 010 (OJO DE TIGRE), 012 (NACAR), 013 (CORAL) y 044 (PERLA)
-- NO son colores: son piedras. Se migran a catalog.stone.
-- Los códigos 041..048 (CRISTAL-NEGRO, CRISTAL-RUBI...) se migran como
-- stone = CRISTAL + color correspondiente.
-- El código 0N (NINGUNO) no se migra: sin piedra = sin fila.

-- -----------------------------------------------------------------------------
-- piedras  (Tipo_piedra + clase_piedra, desenredadas; + las que estaban en color)
-- -----------------------------------------------------------------------------
INSERT INTO catalog.stone (code, name, origin, is_gem, default_unit, legacy_tipo, legacy_clase) VALUES
  -- gemas finas (tipo 3)
  ('RUBI','Rubí','natural', true,'ct',3,11),
  ('ESMERALDA','Esmeralda','natural', true,'ct',3,12),
  ('AMATISTA','Amatista','natural', true,'ct',3,13),
  ('ZAFIRO','Zafiro','natural', true,'ct',3,14),
  ('DIAMANTE','Diamante','natural', true,'ct',3,18),
  -- zircón (tipo 5)
  ('ZIRCON','Zircón','synthetic', false,'und',5,15),
  -- artificiales (tipo 1)
  ('CRISTAL','Cristal','synthetic', false,'und',1,1),
  ('VIDRIO','Vidrio','imitation', false,'und',1,16),
  ('ACRILICO','Acrílico','imitation', false,'und',1,17),
  ('OJO_GATO','Ojo de gato','imitation', false,'und',1,27),
  ('OJO_TURCO','Ojo turco','imitation', false,'und',1,41),
  ('MURANO','Murano','imitation', false,'und',1,42),
  ('DIAM_LAB','Diamante de laboratorio','lab_grown', true,'ct',1,47),
  -- naturales (tipo 2)
  ('SPONDYLUS','Spondylus','organic', false,'und',2,2),
  ('JASPE','Jaspe','natural', false,'und',2,3),
  ('NACAR','Nácar','organic', false,'und',2,4),
  ('ABALON','Abalón','organic', false,'und',2,5),
  ('CRISOCOLA','Crisocola','natural', false,'und',2,6),
  ('SODALITA','Sodalita','natural', false,'und',2,7),
  ('ONIX','Ónix','natural', false,'und',2,8),
  ('OJO_TIGRE','Ojo de tigre','natural', false,'und',2,9),
  ('HEMATITE','Hematite','natural', false,'und',2,10),
  ('MIXTO','Piedra mixta','natural', false,'und',2,22),
  ('OPALO_AND','Ópalo andino','natural', false,'und',2,23),
  ('TURQUESA_PE','Turquesa peruana','natural', false,'und',2,24),
  ('CORAL','Coral','organic', false,'und',2,30),
  ('MARQUESITA','Marquesita','natural', false,'und',2,32),
  ('CUARZO','Cuarzo','natural', false,'und',2,33),
  ('SERPENTINA','Serpentina','natural', false,'und',2,36),
  ('AGATA','Ágata','natural', false,'und',2,37),
  ('AMBAR','Ámbar','organic', false,'und',2,38),
  ('JADE_CHINO','Jade chino','natural', false,'und',2,39),
  ('TIGRILLO','Tigrillo','natural', false,'und',2,40),
  ('LAPIZ_LAZULI','Lapislázuli','natural', false,'und',2,43),
  ('PIEDRA_FUEGO','Piedra de fuego','natural', false,'und',2,44),
  ('BERILO','Berilo','natural', true,'ct',2,45),
  ('SILICATO','Silicato','natural', false,'und',2,46),
  -- perlas (tipo 6)
  ('PERLA_CULT','Perla cultivada','organic', false,'und',6,25),
  ('PERLA_ART','Perla artificial','imitation', false,'und',6,26),
  ('PERLA_RIO','Perla de río','organic', false,'und',6,29),
  ('PERLA_AGUA','Perla de agua','organic', false,'und',6,34),
  -- productos naturales (tipo 7)
  ('HUAYRURO','Huayruro','organic', false,'und',7,20),
  ('ALAS_MARIPOSA','Alas de mariposa','organic', false,'und',7,28),
  ('HOJA_COCA','Hoja de coca','organic', false,'und',7,31),
  ('SEMILLA','Semilla','organic', false,'und',7,35),
  -- decorativas que hoy viven sólo en la descripción
  ('MOSTACILLA','Mostacilla','imitation', false,'und',NULL,NULL),
  ('STRASS','Strass','imitation', false,'und',NULL,NULL);

-- NOTA: el tipo 4 (SIN PIEDRA) y la clase 19 (NINGUNO) NO se migran.
-- Una variante sin piedra simplemente no tiene filas en catalog.variant_stone.

-- -----------------------------------------------------------------------------
-- escalas de talla  (el legacy mezclaba 11..17 con "5.5*4" en la misma columna)
-- -----------------------------------------------------------------------------
INSERT INTO catalog.size_scale (code, name, unit_code) VALUES
  ('aro_pe','Talla de aro (Perú)','mm'),
  ('collar_cm','Largo de collar (cm)','cm'),
  ('pulsera_cm','Largo de pulsera (cm)','cm');

-- tallas de aro de 4 a 32, en pasos de 0.5
INSERT INTO catalog.size_value (size_scale_id, value, label, diameter_mm, sort_order)
SELECT (SELECT id FROM catalog.size_scale WHERE code = 'aro_pe'),
       v, rtrim(trim(to_char(v, 'FM999.9')), '.'),
       round(12.0 + (v - 4) * 0.33, 2),
       row_number() OVER (ORDER BY v)
FROM generate_series(4, 32, 0.5) AS g(v);

INSERT INTO catalog.size_value (size_scale_id, value, label, sort_order)
SELECT (SELECT id FROM catalog.size_scale WHERE code = 'collar_cm'),
       v, v || ' cm', row_number() OVER (ORDER BY v)
FROM generate_series(35, 90, 5) AS g(v);

INSERT INTO catalog.size_value (size_scale_id, value, label, sort_order)
SELECT (SELECT id FROM catalog.size_scale WHERE code = 'pulsera_cm'),
       v, v || ' cm', row_number() OVER (ORDER BY v)
FROM generate_series(14, 24, 1) AS g(v);

-- -----------------------------------------------------------------------------
-- categorías: raíces + nivel 1 desde tipo_alhajas
-- Los nombres pegados con "/" del legacy se separan acá.
-- -----------------------------------------------------------------------------
INSERT INTO catalog.category (slug, name, path, sort_order) VALUES
  ('joyeria','Joyería','joyeria',1),
  ('artesania','Artesanía','artesania',2),
  ('accesorios','Accesorios','accesorios',3),
  ('insumos','Insumos y empaques','insumos',4),
  ('servicios','Servicios','servicios',5);

INSERT INTO catalog.category (parent_id, slug, name, path, legacy_ala, sort_order)
SELECT (SELECT id FROM catalog.category WHERE slug = d.root),
       d.slug, d.name, (d.root || '.' || d.slug)::ltree, d.ala, d.ord
FROM (VALUES
  ('joyeria','aretes','Aretes y aros','A',1),
  ('joyeria','sortijas','Sortijas','S',2),
  ('joyeria','pulseras','Pulseras','B',3),
  ('joyeria','cadenas','Cadenas','C',4),
  ('joyeria','dijes','Dijes','D',5),
  ('joyeria','esclavas','Esclavas','E',6),
  ('joyeria','filigrana','Filigrana','F',7),
  ('joyeria','argollas','Argollas','G',8),
  ('joyeria','juegos','Juegos','J',9),
  ('joyeria','medallas','Medallas','M',10),
  ('joyeria','piercings','Piercings','N',11),
  ('joyeria','cruces','Cruces','R',12),
  ('joyeria','religiosos','Religiosos','X',13),
  ('joyeria','logia','Logia','Y',14),
  ('accesorios','prendedores','Prendedores y solaperos','K',1),
  ('accesorios','corbateros','Corbateros y gemelos','O',2),
  ('accesorios','coronas','Coronas, tiaras y peinetas','W',3),
  ('accesorios','llaveros','Llaveros','L',4),
  ('accesorios','puneras','Puñeras','Ñ',5),
  ('artesania','platos','Platos recordatorio','H',1),
  ('artesania','cuberteria','Cubertería','I',2),
  ('artesania','placas','Placas','P',3),
  ('artesania','artesanias','Artesanías varias','T',4),
  ('artesania','cuadros','Cuadros','U',5),
  ('artesania','zircones','Línea zircones','Z',6),
  ('insumos','utiles','Útiles y accesorios','V',1),
  ('insumos','exhibicion','Exhibición','Q',2)
) AS d(root, slug, name, ala, ord);

-- -----------------------------------------------------------------------------
-- listas de precio  (decisión 2: las 3 del legacy + e-commerce)
-- -----------------------------------------------------------------------------
INSERT INTO pricing.price_list
  (code, name, currency_code, includes_tax, default_margin_pct, rounding_step, min_order_qty, priority) VALUES
  ('publico','Precio público','PEN', true, 100, 0.10, 1, 10),
  ('comerciante','Comerciante','PEN', true, 55, 0.10, 1, 20),
  ('mayorista','Mayorista','PEN', true, 40, 0.10, 6, 30),
  ('ecommerce','Tienda online','PEN', true, 100, 0.10, 1, 15);

-- -----------------------------------------------------------------------------
-- motivos de movimiento  (el "Estado = 'L'" del legacy nunca tuvo diccionario)
-- -----------------------------------------------------------------------------
INSERT INTO inventory.movement_reason (code, name, type, requires_note) VALUES
  ('inv_apertura','Inventario de apertura','opening', false),
  ('compra_prov','Compra a proveedor','purchase', false),
  ('dev_proveedor','Devolución a proveedor','purchase_return', true),
  ('venta_mostrador','Venta en mostrador','sale', false),
  ('venta_online','Venta online','sale', false),
  ('dev_cliente','Devolución de cliente','sale_return', true),
  ('traslado_envio','Envío a otra sede','transfer_out', false),
  ('traslado_recep','Recepción de otra sede','transfer_in', false),
  ('ajuste_conteo','Diferencia de inventario','count', true),
  ('ajuste_error','Corrección de error de digitación','adjustment', true),
  ('robo','Robo o pérdida','adjustment', true),
  ('rotura','Rotura','scrap', true),
  ('merma_taller','Merma de taller','scrap', true),
  ('fundicion','Fundición de la pieza','scrap', true),
  ('taller_salida','Salida a taller','production_out', true),
  ('taller_ingreso','Ingreso de taller','production_in', false),
  ('reparacion','Reparación','production_out', true),
  ('ajuste_talla','Ajuste de talla','production_out', true),
  ('exhibicion_salida','Salida a exhibición','loan_out', true),
  ('exhibicion_retorno','Retorno de exhibición','loan_in', false),
  ('consig_entrega','Entrega en consignación','consignment_out', true),
  ('consig_retorno','Retorno de consignación','consignment_in', false);

-- -----------------------------------------------------------------------------
-- sedes  (tiendas.csv; decisión 6: las cerradas se migran con is_active = false)
-- Las filas 20 y 21 del legacy, sin nombre, NO se migran: son basura.
-- -----------------------------------------------------------------------------
INSERT INTO core.location
  (code, name, kind, sells, holds_stock, address_line, phone, mobile, email, is_active, legacy_num) VALUES
  ('T-1','Tienda 1','store', true, true, NULL,'01 428-5698','985655073','t1@minittajoyeria.com', true, 1),
  ('T-JOCKEY','Tienda Jockey Plaza','store', true, true,'Jockey Plaza','01 428-4665',NULL,NULL, true, 4),
  ('T-7','Tienda 7','store', true, true,'Jr. Huallaga 549 Dpto. 219','01 428-1076','998801880','ventas@minittajoyeria.com', true, 11),
  ('T-8','Tienda 8','store', true, true,'Av. Argentina 308',NULL,'968710516','t8@minittajoyeria.com', true, 15),
  ('OFI-T1','Oficina T1','office', false, false,'T1',NULL,NULL,NULL, true, 8),
  ('PROD','Área de producción','workshop', false, true, NULL,NULL,NULL,NULL, true, 9),
  ('COMPRAS','Área de compras','purchasing', false, false, NULL,NULL,NULL,NULL, true, 13),
  ('DISTRIB','Área de distribución','distribution', false, true, NULL,NULL,NULL,NULL, true, 14),
  ('GRABADO','Grabado y publicidad','workshop', false, true,'Jr. Huallaga 470',NULL,NULL,NULL, true, 12),
  ('TJ1','Taller Regina','workshop', false, true,'Regina',NULL,NULL,NULL, true, 10),
  ('ECOM','Tienda online','virtual', true, false, NULL,NULL,NULL,NULL, true, NULL);

-- sedes cerradas: existen para que el histórico cruce, pero no operan
INSERT INTO core.location
  (code, name, kind, sells, holds_stock, address_line, is_active, closed_at, legacy_num) VALUES
  ('T-2','Tienda 2 (cerrada)','store', false, false, NULL, false, '2024-01-01', 2),
  ('T-3','Tienda 3 (cerrada)','store', false, false, NULL, false, '2024-01-01', 3),
  ('T-4','Tienda 4 (cerrada)','store', false, false, NULL, false, '2024-01-01', 5),
  ('A-5','Almacén 5 (cerrado)','warehouse', false, false, NULL, false, '2024-01-01', 6),
  ('T-6','Tienda 6 (cerrada)','store', false, false,'Independencia', false, '2024-01-01', 7),
  ('A-9','Almacén 9 - ex stock T2','warehouse', false, false, NULL, false, '2024-01-01', 16),
  ('A-10','Almacén 10 - ex stock T3','warehouse', false, false, NULL, false, '2024-01-01', 17),
  ('A-20','Almacén 20 (cerrado)','warehouse', false, false, NULL, false, '2024-01-01', 18),
  ('A-3','Almacén 3 (cerrado)','warehouse', false, false, NULL, false, '2024-01-01', 19);

-- OJO: closed_at está puesto en 2024-01-01 como marcador. Hay que reemplazarlo
-- por la fecha real de cierre de cada sede: es un dato que hoy no existe en
-- ninguna tabla y sólo lo sabe la gente de la empresa.

-- -----------------------------------------------------------------------------
-- atributos extensibles de arranque
-- (lo que hoy se apunta en el cuaderno y en la descripción)
-- -----------------------------------------------------------------------------
INSERT INTO catalog.attribute (code, name, type, unit_code, scope, is_filterable) VALUES
  ('tipo_cierre','Tipo de cierre','option',NULL,'product', true),
  ('largo_cadena','Largo de cadena','number','cm','variant', true),
  ('ancho_banda','Ancho de banda','number','mm','variant', false),
  ('cantidad_piezas','Cantidad de piezas del juego','number','und','product', false),
  ('grado_logia','Grado de logia','text',NULL,'product', false),
  ('apto_ninos','Apto para niños','boolean',NULL,'product', true),
  ('hipoalergenico','Hipoalergénico','boolean',NULL,'product', true),
  ('molde_taller','Código de molde del taller','text',NULL,'product', false),
  ('tiempo_produccion','Tiempo de producción','number','h','product', false);

INSERT INTO catalog.attribute_option (attribute_id, code, name, sort_order)
SELECT (SELECT id FROM catalog.attribute WHERE code = 'tipo_cierre'), d.code, d.name, d.ord
FROM (VALUES
  ('reasa','Reasa',1),
  ('mosqueton','Mosquetón',2),
  ('presion','A presión',3),
  ('tornillo','Tornillo',4),
  ('gancho','Gancho',5),
  ('broche','Broche de seguridad',6)
) AS d(code, name, ord);

-- -----------------------------------------------------------------------------
-- fuentes de grabado  (ya existe engraving-fonts en el backend, sin modelo en BD)
-- -----------------------------------------------------------------------------
INSERT INTO catalog.engraving_font (code, name, max_chars, sort_order) VALUES
  ('script','Manuscrita',30,1),
  ('block','Imprenta',30,2),
  ('serif','Serif clásica',30,3),
  ('monogram','Monograma',3,4);

INSERT INTO catalog.engraving_option (code, name, technique, max_chars, lead_time_days) VALUES
  ('laser_int','Grabado láser interior','laser',40,1),
  ('laser_ext','Grabado láser exterior','laser',25,1),
  ('manual','Grabado manual','manual',20,3),
  ('punta_diam','Punta de diamante','diamond_tip',25,2);

-- -----------------------------------------------------------------------------
-- mano de obra de referencia
-- -----------------------------------------------------------------------------
INSERT INTO pricing.labor_rate (code, name, cost_per_gram, cost_per_piece, cost_per_stone, currency_code) VALUES
  ('fundicion','Fundición',3.00,NULL,NULL,'PEN'),
  ('armado','Armado',NULL,8.00,NULL,'PEN'),
  ('engaste','Engaste',NULL,NULL,1.50,'PEN'),
  ('pulido','Pulido',NULL,5.00,NULL,'PEN'),
  ('bano','Baño / enchape',NULL,6.00,NULL,'PEN');
