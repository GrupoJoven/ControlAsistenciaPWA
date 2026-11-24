-- ============================================================================
-- Borrar los informes mensuales que en realidad guardaban un error de la IA
--
-- generate-monthly-report devolvía los fallos de Gemini como si fueran el
-- informe ({ "summary": "Error Gemini (503) con el modelo ..." }), los guardaba
-- en monthly_reports y el mes quedaba bloqueado: el botón «Generar Informe IA»
-- se deshabilitaba sin que hubiera informe que leer.
--
-- La función ya no guarda esos fallos (responde con error y no escribe nada), y
-- tanto la Edge Function como Reports.tsx reconocen las filas antiguas y
-- vuelven a generar el informe encima. Este script es el atajo para desbloquear
-- un mes sin esperar a desplegar la app, o para dejar la tabla limpia.
--
-- Orden de ejecución: cuando se quiera. No cambia el esquema ni las políticas.
-- ============================================================================

-- 1. Mirar primero QUÉ se va a borrar. Debe salir solo texto de error.
SELECT
  id,
  scope,
  scope_id,
  stage,
  month,
  report_type,
  generated_at,
  left(payload ->> 'summary', 160) AS resumen
FROM public.monthly_reports
WHERE coalesce(trim(payload ->> 'summary'), '') = ''
   OR payload ->> 'summary' ILIKE 'Error Gemini%'
   OR payload ->> 'summary' ILIKE 'No se pudo parsear%'
   OR payload ->> 'summary' ILIKE 'No se pudo contactar%'
   OR (payload ->> 'error') = 'true'
ORDER BY generated_at DESC;

-- 2. Si la lista de arriba es la esperada, borrar esas filas.
--    Mismo WHERE: no toca ningún informe de verdad.
DELETE FROM public.monthly_reports
WHERE coalesce(trim(payload ->> 'summary'), '') = ''
   OR payload ->> 'summary' ILIKE 'Error Gemini%'
   OR payload ->> 'summary' ILIKE 'No se pudo parsear%'
   OR payload ->> 'summary' ILIKE 'No se pudo contactar%'
   OR (payload ->> 'error') = 'true';
