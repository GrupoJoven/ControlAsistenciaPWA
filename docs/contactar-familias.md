# Contactar familias y Correo: puesta en marcha

La página **Coordinación → Contactar familias** envía un correo a los `parent_email`
de los niños de los grupos elegidos. La página **Coordinación → Correo** muestra el
buzón de Gmail de esa misma cuenta (Recibidos y Enviados) y permite responder y
escribir correos nuevos desde la app (ver [Correo](#correo-leer-responder-y-escribir)
más abajo). Quién entra decide qué cuenta usa:

| Coordinador        | Grupos que puede elegir | Cuenta de envío             | Secret en Supabase           |
|--------------------|-------------------------|-----------------------------|------------------------------|
| Preconfirmación    | Solo de preconfirmación | `preconfirmacion@sanpas.es` | `SMTP_PASS_PRECONFIRMACION`  |
| Confirmación       | Solo de confirmación    | `confirmacion@sanpas.es`    | `SMTP_PASS_CONFIRMACION`     |
| General (sin etapa)| Todos                   | `grupojoven@sanpas.es`      | `SMTP_PASS_GRUPOJOVEN`       |

Cada familia recibe su propio correo (nadie ve las direcciones de las demás) y
siempre se añade al final la firma de protección de datos con el logo.

Para que funcione hay que hacer **una sola vez** los pasos siguientes.

---

## 1. Crear una contraseña de aplicación en cada cuenta de Gmail

Hay que repetirlo en las tres cuentas (`preconfirmacion@`, `confirmacion@` y
`grupojoven@`), entrando cada vez con la cuenta correspondiente. Lo más cómodo
es una ventana de incógnito por cuenta.

1. **Activar la verificación en dos pasos** (si la cuenta no la tiene ya):
   <https://myaccount.google.com/signinoptions/twosv> → *Empezar* y seguir los
   pasos (normalmente con un móvil).
   - Si Google dice que no está permitido, el administrador de Google Workspace
     de `sanpas.es` tiene que habilitarlo en *Consola de administración →
     Seguridad → Autenticación → Verificación en dos pasos → Permitir que los
     usuarios activen la verificación en dos pasos*.
2. **Crear la contraseña de aplicación**: <https://myaccount.google.com/apppasswords>
   - Nombre de la aplicación: por ejemplo `App catequesis`.
   - Pulsar *Crear*. Google muestra una contraseña de 16 letras
     (`abcd efgh ijkl mnop`). **Solo se ve una vez**: cópiala en ese momento.
   - Si esa página dice que la opción no está disponible, casi siempre es
     porque la verificación en dos pasos no está activa todavía (paso 1).
3. Guárdala solo el tiempo necesario para el paso 2. No la mandes por
   WhatsApp ni la dejes en ningún documento: da acceso para enviar correo
   desde esa cuenta.

> Si alguna vez cambias la contraseña normal de la cuenta, Google anula sus
> contraseñas de aplicación: habría que crear una nueva y actualizar el secret.

## 2. Guardar las contraseñas en Supabase

1. Abre los secrets de las edge functions del proyecto:
   <https://supabase.com/dashboard/project/pqycvrpdyebshkfaxzmi/functions/secrets>
   (o *Edge Functions → Secrets* en el panel).
2. Añade estos tres secrets (da igual pegar la contraseña con o sin los
   espacios que muestra Google):

   | Name                         | Value                                   |
   |------------------------------|-----------------------------------------|
   | `SMTP_PASS_PRECONFIRMACION`  | contraseña de `preconfirmacion@sanpas.es` |
   | `SMTP_PASS_CONFIRMACION`     | contraseña de `confirmacion@sanpas.es`    |
   | `SMTP_PASS_GRUPOJOVEN`       | contraseña de `grupojoven@sanpas.es`      |

3. Guarda. No hace falta tocar `SMTP_HOST` ni `SMTP_PORT` (ya existen para los
   avisos de ausencia; si no estuvieran, se usa `smtp.gmail.com` y el puerto 465).

## 3. Subir el logo de la firma

1. En Supabase: *Storage → New bucket*.
   - Name: `email-assets`
   - Activa **Public bucket** (el logo tiene que poder verse desde el correo de
     cualquier familia).
2. Entra en el bucket y sube el archivo
   [`supabase/email-assets/logo-grupo-joven.png`](../supabase/email-assets/logo-grupo-joven.png)
   **con ese mismo nombre**.
3. Comprueba que se abre en el navegador:
   <https://pqycvrpdyebshkfaxzmi.supabase.co/storage/v1/object/public/email-assets/logo-grupo-joven.png>

Si el logo no está subido, los correos salen igual pero sin imagen, y la vista
previa de la app lo avisa.

## 4. Desplegar las edge functions y la app

Desde la carpeta del proyecto (la primera vez puede pedir `npx supabase login`):

```bash
npx supabase functions deploy send-family-email
```

```bash
npx supabase functions deploy family-inbox
```

Después publica la app como haces normalmente para que aparezca la opción en
el menú.

## 5. Probar antes de escribir a las familias

1. Crea un grupo de prueba cuyo nombre incluya la etapa, por ejemplo
   `PRUEBA PRECONFIRMACIÓN`, con un niño ficticio cuyo correo de padres sea el
   tuyo.
2. Entra con un coordinador de esa etapa, ve a *Contactar familias*, elige solo
   ese grupo y envía.
3. Comprueba que llega desde la cuenta correcta, con la firma y el logo. El
   correo también queda en la carpeta *Enviados* de esa cuenta de Gmail.
4. Borra el grupo de prueba.

## Límites y problemas habituales

- **Límite de Gmail**: unos 2.000 correos al día por cuenta de Google Workspace.
- **"Falta configurar la contraseña de aplicación…"**: falta el secret de esa
  cuenta o tiene otro nombre (paso 2).
- **"Gmail ha rechazado el envío…"**: la contraseña de aplicación es incorrecta,
  se ha revocado, o se ha alcanzado el límite diario. El envío se detiene para
  no seguir fallando; la app indica a cuántas familias había llegado ya.
- Los detalles técnicos de cada envío se ven en Supabase, en *Edge Functions →
  send-family-email → Logs*.

---

## Correo: leer, responder y escribir

La página **Correo** lee el buzón por IMAP con la **misma contraseña de
aplicación** de cada cuenta (los secrets `SMTP_PASS_...` del paso 2): no hay que
crear nada nuevo. Cada coordinador ve solo el buzón de su cuenta, igual que en
la tabla de arriba.

- **Solo lectura**: la carpeta se abre en modo lectura. Desde la app no se borra
  ni se mueve nada, y abrir un correo **no lo marca como leído** en Gmail.
- **Responder**: solo a correos de Recibidos y solo al remitente (o a su
  *Reply-To*). La respuesta sale desde la misma cuenta, con la firma de
  protección de datos y el correo original citado, y Gmail la agrupa en la misma
  conversación y la guarda en *Enviados*.
- **Redactar**: correo nuevo a cualquier dirección (hasta 20 por envío), desde la
  misma cuenta y con la firma de protección de datos. Si hay varias direcciones,
  cada una recibe su propio correo y nadie ve las demás. Para escribir a grupos
  enteros sigue estando *Contactar familias*.
- **Seguridad**: el contenido de los correos se limpia antes de mostrarlo (sin
  scripts ni formularios) y las imágenes externas no se cargan hasta pulsar
  *Mostrar imágenes*, para que nadie sepa cuándo se ha abierto un correo.
- **Protección de datos**: cualquier coordinador de una etapa ve **todo** el
  buzón de esa cuenta, incluidas las respuestas de las familias.

### Requisito: IMAP permitido en Google Workspace

Si al abrir *Correo* aparece *"La cuenta ... no tiene permitido el acceso IMAP"*,
el administrador de Google Workspace de `sanpas.es` tiene que permitirlo en
*Consola de administración → Aplicaciones → Google Workspace → Gmail → Acceso de
usuarios finales → Acceso POP e IMAP* (marcar *Habilitar el acceso IMAP para todos
los usuarios*, o al menos para estas tres cuentas).

### Problemas habituales

- **"Gmail no acepta la contraseña de aplicación..."**: la contraseña de esa
  cuenta es incorrecta o se ha revocado (por ejemplo, al cambiar la contraseña
  normal de la cuenta). Crea una nueva (paso 1) y actualiza su secret (paso 2):
  sirve a la vez para enviar y para leer.
- Gmail admite unas 15 conexiones IMAP a la vez por cuenta. Cada pantalla de la
  app abre y cierra la suya, así que no debería notarse.
- Los detalles técnicos se ven en *Edge Functions → family-inbox → Logs*.
