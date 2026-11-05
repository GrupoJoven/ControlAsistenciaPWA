-- ============================================================================
-- El nombre de un monitor se guarda siempre en mayúsculas
--
-- monitors.name guardaba lo que se escribiera en el formulario, así que la
-- lista salía con "Ana García" y "ANA GARCÍA" mezclados según quién la
-- hubiera dado de alta. La regla pasa a vivir en la base de datos y no en la
-- pantalla, para que valga para TODOS los caminos de escritura: el registro de
-- monitores, la ficha que se crea al asignar un coordinador de etapa, y
-- cualquier INSERT o UPDATE hecho a mano desde el editor SQL.
--
-- upper() respeta los acentos con la configuración UTF-8 de Supabase, así que
-- "José Peláez" queda "JOSÉ PELÁEZ" y no "JOSE PELAEZ". El trigger también
-- recorta los espacios de los extremos, que es lo mismo que ya hacía el
-- formulario.
--
-- El nombre se ordena y se busca en la app con localeCompare y con
-- normalizeSearchText, los dos insensibles a mayúsculas, así que nada más
-- cambia por esto.
--
-- Orden de ejecución: después de monitors.sql. No hace falta volver a
-- desplegar ninguna edge function.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.upper_monitor_name()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Sin coalesce a propósito: un nombre nulo tiene que seguir fallando contra
  -- el NOT NULL de la columna, no convertirse en una cadena vacía.
  NEW.name := upper(btrim(NEW.name));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_monitors_upper_name ON public.monitors;

-- En todos los UPDATE, no solo en los que mencionan name: así una fila que se
-- hubiera quedado en minúsculas se arregla sola en cuanto se la toca.
CREATE TRIGGER trg_monitors_upper_name
  BEFORE INSERT OR UPDATE ON public.monitors
  FOR EACH ROW
  EXECUTE FUNCTION public.upper_monitor_name();


-- Las que ya estuvieran guardadas.
UPDATE public.monitors
SET name = upper(btrim(name))
WHERE name IS DISTINCT FROM upper(btrim(name));


-- ============================================================================
-- Comprobación (opcional)
--
--   SELECT name FROM public.monitors ORDER BY name;
--
--   -- Debe guardarse "ÁNGELA DE LA FUENTE":
--   -- INSERT INTO public.monitors (stage, name) VALUES ('communion', '  Ángela de la Fuente ');
-- ============================================================================
