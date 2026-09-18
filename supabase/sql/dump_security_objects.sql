-- ============================================================================
-- Volcado de políticas RLS, funciones, vistas, triggers, enums y grants
--
-- Solo lectura. Ejecútalo en el SQL editor como postgres y exporta el
-- resultado (botón Export -> JSON) a supabase/dump/db_dump.json. Sirve para
-- revisar la seguridad sin necesitar acceso directo a la base de datos.
-- ============================================================================

SELECT 'policy' AS kind,
       p.tablename || '.' || p.policyname AS name,
       to_jsonb(p) AS data
FROM pg_policies p
WHERE p.schemaname IN ('public', 'storage')

UNION ALL

SELECT 'rls',
       c.relname,
       jsonb_build_object('enabled', c.relrowsecurity, 'forced', c.relforcerowsecurity)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'

UNION ALL

SELECT 'function',
       p.proname,
       jsonb_build_object('def', pg_get_functiondef(p.oid))
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
  AND l.lanname IN ('plpgsql', 'sql')

UNION ALL

SELECT 'view',
       v.viewname,
       jsonb_build_object('def', v.definition)
FROM pg_views v
WHERE v.schemaname = 'public'

UNION ALL

SELECT 'trigger',
       c.relname || '.' || t.tgname,
       jsonb_build_object('def', pg_get_triggerdef(t.oid))
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND NOT t.tgisinternal

UNION ALL

SELECT 'enum',
       t.typname,
       jsonb_build_object('values', jsonb_agg(e.enumlabel ORDER BY e.enumsortorder))
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
GROUP BY t.typname

UNION ALL

SELECT 'grant',
       g.table_name || '.' || g.grantee,
       jsonb_build_object('privileges', jsonb_agg(g.privilege_type ORDER BY g.privilege_type))
FROM information_schema.role_table_grants g
WHERE g.table_schema = 'public'
  AND g.grantee IN ('anon', 'authenticated')
GROUP BY g.table_name, g.grantee

ORDER BY 1, 2;
