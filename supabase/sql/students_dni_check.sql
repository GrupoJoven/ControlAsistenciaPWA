-- ============================================================================
-- Validación de DNI/NIE en students
--
-- Usa la función is_valid_spanish_dni_nie(text), que ya existe y que devuelve
-- true para NULL y para cadenas vacías: el DNI es opcional en students.
--
-- Se aplica como CHECK y no como trigger porque la regla depende solo de una
-- columna de la propia fila. Un trigger sería necesario si hubiera que
-- modificar la fila o consultar otras tablas.
-- ============================================================================

-- 1. Marcar la función como IMMUTABLE.
--    Depende únicamente de su argumento, así que es correcto, y es lo que
--    espera Postgres de una función usada dentro de un CHECK.
ALTER FUNCTION public.is_valid_spanish_dni_nie(text) IMMUTABLE;

-- 2. Antes de aplicar nada, mira si hay datos que ya incumplen:
--
--    SELECT id, name, dni FROM public.students
--    WHERE NOT public.is_valid_spanish_dni_nie(dni);

-- 3a. Si la consulta anterior NO devuelve filas, usa esta versión.
--     Valida los datos existentes y todos los futuros.
ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS students_dni_valid;

ALTER TABLE public.students
  ADD CONSTRAINT students_dni_valid
  CHECK (public.is_valid_spanish_dni_nie(dni));

-- 3b. Si SÍ devuelve filas y prefieres no corregirlas ahora, comenta el bloque
--     3a y descomenta este. Con NOT VALID la restricción se aplica solo a
--     inserciones y actualizaciones nuevas; las filas antiguas se quedan como
--     están hasta que las arregles y ejecutes el VALIDATE.
--
-- ALTER TABLE public.students
--   DROP CONSTRAINT IF EXISTS students_dni_valid;
--
-- ALTER TABLE public.students
--   ADD CONSTRAINT students_dni_valid
--   CHECK (public.is_valid_spanish_dni_nie(dni))
--   NOT VALID;
--
--  Y cuando ya no queden filas inválidas:
--
-- ALTER TABLE public.students VALIDATE CONSTRAINT students_dni_valid;
