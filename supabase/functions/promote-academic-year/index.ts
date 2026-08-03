/// <reference types="jsr:@supabase/functions-js/edge-runtime.d.ts" />

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// ============================================================================
// promote-academic-year
//
// Promociona los grupos un curso y da de baja a los que terminan.
//
// El trabajo de base de datos NO se hace aquí: se delega en la función de
// Postgres promote_academic_year(), que corre en una única transacción. Si se
// hicieran los borrados desde aquí con supabase-js serían llamadas HTTP
// independientes y un fallo a mitad dejaría alumnos borrados a medias, sin
// vuelta atrás. Aquí solo se hace lo que la base de datos no puede hacer:
// comprobar quién llama y limpiar los ficheros de Storage.
// ============================================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

/** Borra todos los objetos bajo students/<id>/ (Storage no tiene carpetas reales). */
async function deleteStudentFolder(admin: any, studentId: string): Promise<number> {
  const bucket = admin.storage.from("media");
  const prefix = `students/${studentId}`;

  let removed = 0;
  let offset = 0;
  const limit = 100;

  while (true) {
    const { data, error } = await bucket.list(prefix, { limit, offset });
    if (error) throw error;

    const items = data ?? [];
    if (items.length === 0) break;

    const paths = items
      .filter((it: any) => !!it?.name)
      .map((it: any) => `${prefix}/${it.name}`);

    if (paths.length > 0) {
      const { error: rmErr } = await bucket.remove(paths);
      if (rmErr) throw rmErr;
      removed += paths.length;
    }

    if (items.length < limit) break;
    offset += limit;
  }

  return removed;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true }, 200);
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Faltan variables de entorno de Supabase." }, 500);
  }

  // ------------------------------------------------------------ quién llama
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: authData, error: authErr } = await userClient.auth.getUser();
  if (authErr || !authData?.user) {
    return json({ error: "No autorizado (token inválido o expirado)." }, 403);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("id, role, name")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileErr) return json({ error: "No se pudo leer el perfil." }, 500);

  // El rol se comprueba en servidor: ocultar el botón en el cliente no es una
  // medida de seguridad, cualquiera puede llamar al endpoint directamente.
  if (profile?.role !== "coordinator") {
    return json({ error: "Solo un coordinador puede promocionar el curso." }, 403);
  }

  let dryRun = false;
  try {
    const body = await req.json();
    dryRun = body?.dryRun === true;
  } catch {
    // Sin body: ejecución real.
  }

  // -------------------------------------------------- trabajo transaccional
  const { data: result, error: rpcErr } = await admin.rpc("promote_academic_year", {
    p_dry_run: dryRun,
  });

  if (rpcErr) {
    // El ensayo termina siempre en excepción, es como se descarta la transacción.
    if (dryRun && rpcErr.message?.includes("DRY_RUN_OK")) {
      return json({ ok: true, dryRun: true, detalle: rpcErr.message }, 200);
    }
    return json({ error: rpcErr.message ?? "Error al promocionar el curso." }, 400);
  }

  // --------------------------------------------------------- fotos (Storage)
  // Va después del commit y a propósito no rompe la operación: si una foto no
  // se borra, queda un fichero huérfano, que es mucho menos grave que abortar
  // una promoción ya confirmada en base de datos.
  const studentIds: string[] = Array.isArray(result?.ids_alumnos) ? result.ids_alumnos : [];
  let photosRemoved = 0;
  const photoErrors: string[] = [];

  for (const studentId of studentIds) {
    try {
      photosRemoved += await deleteStudentFolder(admin, studentId);
    } catch (e: any) {
      photoErrors.push(`${studentId}: ${e?.message ?? "error"}`);
    }
  }

  return json({
    ...result,
    ejecutado_por: profile?.name ?? authData.user.id,
    fotos_eliminadas: photosRemoved,
    errores_fotos: photoErrors,
  });
});
