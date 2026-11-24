-- ============================================================================
-- Índice por fecha en student_attendance
--
-- La app ya no se trae el histórico entero al arrancar: pide solo el curso que
-- se está viendo, con `date >= '<año>-09-01' AND date <= '<año+1>-08-31'`. Y
-- para saber qué cursos ofrecer en el selector hace dos consultas de una fila,
-- `ORDER BY date ASC LIMIT 1` y la misma descendente.
--
-- Esas tres consultas son las que más pesan en el arranque, y sin índice por
-- fecha no hay nada que las sostenga: Postgres recorre la tabla entera y la
-- ordena para devolver una sola fila. Medido en producción con unas 6.000
-- filas, cada `ORDER BY date LIMIT 1` tardaba entre 2,2 y 3,9 s, y acotar un
-- curso entre 0,7 y 2,3 s. Con el índice son búsquedas directas.
--
-- Las tablas hermanas ya lo tienen (class_days_date_idx,
-- monitor_activity_days_date_idx, monitor_attendance_date_idx); esta se quedó
-- sin él, probablemente por haberse creado desde el panel de Supabase.
--
-- Es un índice, así que no toca ni una fila de datos y se puede crear y borrar
-- sin riesgo. En una tabla de este tamaño tarda milisegundos.
-- ============================================================================

CREATE INDEX IF NOT EXISTS student_attendance_date_idx
  ON public.student_attendance (date);

-- Comprobación: debe aparecer student_attendance_date_idx.
--
--   SELECT indexname FROM pg_indexes
--   WHERE schemaname = 'public' AND tablename = 'student_attendance';
--
-- Y para ver que las consultas del arranque lo usan, en lugar de un
-- Seq Scan + Sort:
--
--   EXPLAIN ANALYZE
--   SELECT student_id, date, catechism, mass FROM public.student_attendance
--   WHERE date >= '2026-09-01' AND date <= '2027-08-31'
--   ORDER BY student_id, date LIMIT 1000;
--
--   EXPLAIN ANALYZE
--   SELECT date FROM public.student_attendance ORDER BY date ASC LIMIT 1;
