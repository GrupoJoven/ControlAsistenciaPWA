-- ============================================================================
-- Un calendario lectivo por etapa
--
-- class_days era un calendario único, con la fecha como clave, para las dos
-- etapas de catequesis: si preconfirmación tenía clase un sábado y
-- confirmación no, había que marcarlo igual para las dos y a los catequistas
-- de la otra se les apuntaba una falta de un día que no era suyo.
--
-- Ahora cada etapa lleva el suyo, como ya hacían comunión y postcomunión con
-- monitor_activity_days:
--
--   class_days(stage, date)   stage = 'preconfirmation' | 'confirmation'
--
-- Lo modifica el coordinador de la etapa (y el general, cualquiera de las
-- dos), con la misma regla que todo lo demás: can_access_stage(stage).
--
-- Los días que ya estaban guardados valían para las DOS etapas, así que cada
-- uno se duplica: una fila para preconfirmación y otra para confirmación. Así
-- ningún porcentaje ya calculado cambia al ejecutar esto; a partir de ahora
-- cada coordinador decide los suyos.
--
-- La lectura sigue abierta a cualquier usuario autenticado, como hasta ahora:
-- el calendario no es un dato sensible y la app ya le muestra a cada uno el de
-- sus etapas.
--
-- Esto debe coincidir con src/utils/calendars.ts (classDaysForStages y
-- compañía). Si cambias una regla, cambia la otra.
--
-- Orden de ejecución: después de stages.sql (usa can_access_stage()). No
-- depende de monitors.sql, pero si ya lo has ejecutado no estorba.
--
-- Hay que volver a desplegar la edge function generate-monthly-report: ahora
-- cuenta los días lectivos de la etapa del informe, no todos.
-- ============================================================================


-- ============================================================================
-- 1. Columna
-- ============================================================================

ALTER TABLE public.class_days
  ADD COLUMN IF NOT EXISTS stage text;


-- ============================================================================
-- 2. Fuera la clave antigua
--
-- Era (date) a secas, así que impediría que un mismo día estuviera en las dos
-- etapas: hay que quitarla ANTES de duplicar las filas.
-- ============================================================================

ALTER TABLE public.class_days
  DROP CONSTRAINT IF EXISTS class_days_pkey;


-- ============================================================================
-- 3. Las filas que ya había valen para las dos etapas
--
-- Cada una tiene que convertirse en DOS, así que primero se copia a
-- confirmación (mientras las antiguas siguen reconocibles por su stage nula) y
-- luego las antiguas pasan a ser las de preconfirmación.
--
-- Es idempotente por construcción: en una segunda ejecución ya no queda
-- ninguna fila con stage nula, así que el INSERT no inserta nada y el UPDATE
-- no actualiza nada.
-- ============================================================================

INSERT INTO public.class_days (stage, date)
SELECT 'confirmation', cd.date
FROM public.class_days cd
WHERE cd.stage IS NULL;

UPDATE public.class_days
SET stage = 'preconfirmation'
WHERE stage IS NULL;


-- ============================================================================
-- 4. Clave nueva, restricciones e índice
-- ============================================================================

ALTER TABLE public.class_days
  ALTER COLUMN stage SET NOT NULL;

ALTER TABLE public.class_days
  DROP CONSTRAINT IF EXISTS class_days_stage_check;

-- Comunión y postcomunión no entran aquí: tienen monitor_activity_days.
ALTER TABLE public.class_days
  ADD CONSTRAINT class_days_stage_check
  CHECK (stage IN ('preconfirmation', 'confirmation'));

-- La clave pasa de (date) a (stage, date). Ninguna tabla referencia
-- class_days, así que no hay claves ajenas que arreglar.
ALTER TABLE public.class_days
  ADD CONSTRAINT class_days_pkey PRIMARY KEY (stage, date);

CREATE INDEX IF NOT EXISTS class_days_date_idx ON public.class_days (date);


-- ============================================================================
-- 5. RLS
--
-- La lectura no cambia (class_days_auth_read). La escritura pasa de "cualquier
-- coordinador" a "el coordinador de esa etapa", que es la misma regla que
-- gobierna grupos, niños, eventos y monitores.
-- ============================================================================

DROP POLICY IF EXISTS "class_days_coordinator_full_access" ON public.class_days;
DROP POLICY IF EXISTS "class_days_coordinator_manage"      ON public.class_days;

CREATE POLICY "class_days_coordinator_manage"
  ON public.class_days
  FOR ALL
  TO authenticated
  USING (public.can_access_stage(stage))
  WITH CHECK (public.can_access_stage(stage));


-- ============================================================================
-- 6. Comprobación
--
--   -- Deben salir los mismos días en las dos etapas justo después de migrar:
--   SELECT stage, count(*) FROM public.class_days GROUP BY stage;
--
--   -- Y ningún día sin etapa:
--   SELECT count(*) FROM public.class_days WHERE stage IS NULL;
-- ============================================================================
