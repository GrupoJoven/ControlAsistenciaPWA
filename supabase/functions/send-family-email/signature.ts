// supabase/functions/send-family-email/signature.ts
//
// Firma de protección de datos (RGPD/LOPDGDD) que se añade al final de TODOS los
// correos enviados desde "Contactar familias". El texto legal es literal: no lo
// reformules sin que lo revise la coordinación.

const SIGNATURE_PARAGRAPHS = [
  "De conformidad con lo establecido en el Reglamento UE 679/2016 General de Protección de Datos (en adelante, “RGPD”) y la Ley Orgánica 3/2018, de 5 de diciembre, de Protección de Datos Personales y garantía de los derechos digitales (en adelante, “LOPDGDD”), se les informa que los datos identificativos, serán tratados por el Grupo Joven de SAN PASCUAL BAYLÓN, autorizándose el tratamiento de los datos en los términos indicados.",
  "En este sentido, se informa a los interesados de que la base que legitima el tratamiento de los datos es el interés legítimo de las Partes, conforme a la LOPDGDD. Los datos personales de los firmantes serán conservados hasta que el interesado manifieste de forma expresa su deseo de supresión o limitación. Sus datos serán, por tanto, conservados debidamente, así como bloqueados/o/ en su caso/ suprimidos, siempre que no se esté realizando la actividad de tiempo libre, así como para el cumplimiento de otras obligaciones legales.",
  "En cualquier momento, los firmantes podrán ejercer los derechos que les son conferidos por la normativa aplicable en materia de protección de datos (acceso, rectificación, supresión, limitación, portabilidad, oposición y a no ser objeto de decisiones individuales automatizadas) dirigiéndose al domicilio del respectivo responsable del tratamiento, que será el Grupo Joven de SAN PASCUAL BAYLÓN, incluyendo en la comunicación la Referencia “Protección de Datos de Carácter Personal” a través de este mismo correo electrónico como canal de comunicación ( grupojoven@sanpas.es) .",
  "Si para las actividades de SAN PASCUAL BAYLÓN se tuviera la necesidad de acceder a datos de carácter personal, este se compromete y obliga a respetar y cumplir la legislación vigente en la materia y muy especialmente el RGPD, la LOPDGDD y en cualesquiera otras normas vigentes o que en el futuro puedan promulgarse sobre la materia, respecto de los datos de carácter personal que puedan ser objeto de tratamiento por parte de SAN PASCUAL BAYLÓN (conjuntamente, la “Normativa de Protección de Datos”).",
  "Este mensaje se dirige, a sus destinatarios y contiene información confidencial cuya divulgación, copia o utilización no autorizada es contraria a la ley. Si recibe este mensaje por error, le rogamos nos lo comunique de inmediato y lo elimine sin conservar copia del mismo ni de sus documentos adjuntos.",
];

const WEB_JOVEN = "http://sanpas.es";
const WEB_PARROQUIA = "https://sanpasbaylon.es/";

// Gmail llama "Sans Serif" a esta pila de fuentes y "Pequeño" a x-small (~10px).
const FONT_FAMILY = "Arial, Helvetica, sans-serif";
const SIGNATURE_FONT_SIZE = "10px";
const BODY_FONT_SIZE = "14px";

// El logo se guarda a 240px de ancho y se muestra a la mitad para que se vea
// nítido en pantallas de alta densidad.
const LOGO_WIDTH = 120;
const LOGO_HEIGHT = 117;

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Escapa el texto y convierte en enlace las URLs y los correos que contenga. */
const linkify = (text: string) =>
  escapeHtml(text).replace(
    /(https?:\/\/[^\s<]+[^\s<.,;:!?)])|([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
    (match, url) =>
      url
        ? `<a href="${url}" style="color:#1a56db">${url}</a>`
        : `<a href="mailto:${match}" style="color:#1a56db">${match}</a>`
  );

/** Texto que escribe el coordinador: respeta párrafos y saltos de línea. */
const bodyToHtml = (body: string) =>
  body
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${linkify(p).replace(/\n/g, "<br>")}</p>`)
    .join("");

export const buildFamilyEmailHtml = (body: string, logoUrl: string | null) => {
  const paragraphs = SIGNATURE_PARAGRAPHS.map(
    (p) => `<p style="margin:0 0 6px">${linkify(p)}</p>`
  ).join("");

  const logo = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}" alt="Grupo Joven San Pascual Baylón" style="display:inline-block;border:0;outline:none;text-decoration:none">`
    : "";

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:16px;background:#ffffff">
<div style="font-family:${FONT_FAMILY};font-size:${BODY_FONT_SIZE};line-height:1.5;color:#222222">${bodyToHtml(body)}</div>
<div style="font-family:${FONT_FAMILY};font-size:${SIGNATURE_FONT_SIZE};line-height:1.35;color:#444444;margin-top:24px">
<p style="margin:0 0 8px">--</p>
${paragraphs}
<div style="text-align:center;margin-top:16px">
${logo}
<p style="margin:8px 0 0">Web del joven: <a href="${WEB_JOVEN}" style="color:#1a56db">${WEB_JOVEN}</a></p>
<p style="margin:2px 0 0">Web de la parroquia: <a href="${WEB_PARROQUIA}" style="color:#1a56db">${WEB_PARROQUIA}</a></p>
</div>
</div>
</body>
</html>`;
};

/** Versión en texto plano, para los clientes de correo que no muestran HTML. */
export const buildFamilyEmailText = (body: string) =>
  [
    body.replace(/\r\n/g, "\n").trim(),
    "",
    "--",
    "",
    SIGNATURE_PARAGRAPHS.join("\n\n"),
    "",
    `Web del joven: ${WEB_JOVEN}`,
    `Web de la parroquia: ${WEB_PARROQUIA}`,
  ].join("\n");
