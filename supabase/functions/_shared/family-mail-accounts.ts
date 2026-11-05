// supabase/functions/_shared/family-mail-accounts.ts
//
// Cuenta de Gmail de cada coordinador: desde ella envía "Contactar familias" y
// es el buzón que se ve y se responde en "Correo". El coordinador de etapa usa
// la de su etapa (también los de comunión y postcomunión); el general (sin
// etapa), la del Grupo Joven, y desde Supercoordinación puede abrir cualquiera.
//
// Debe coincidir con FAMILY_EMAIL_SENDERS en components/FamilyContact.tsx.
// La contraseña de aplicación de cada cuenta va en su secret y sirve tanto para
// enviar (SMTP) como para leer (IMAP). Ver docs/contactar-familias.md.

export type Stage = "preconfirmation" | "confirmation" | "communion" | "postcommunion";

/** Los buzones. Cada etapa tiene el suyo y el general usa el del Grupo Joven. */
export type Mailbox = Stage;

export const MAILBOXES: readonly Mailbox[] = ["preconfirmation", "confirmation", "communion", "postcommunion"];

export type FamilyMailAccount = { email: string; name: string; passwordSecret: string };

export const FAMILY_MAIL_ACCOUNTS: Record<Mailbox | "global", FamilyMailAccount> = {
  preconfirmation: {
    email: "preconfirmacion@sanpas.es",
    name: "Preconfirmación San Pascual Baylón",
    passwordSecret: "SMTP_PASS_PRECONFIRMACION",
  },
  confirmation: {
    email: "confirmacion@sanpas.es",
    name: "Confirmación San Pascual Baylón",
    passwordSecret: "SMTP_PASS_CONFIRMACION",
  },
  communion: {
    email: "comunion@sanpas.es",
    name: "Comunión San Pascual Baylón",
    passwordSecret: "SMTP_PASS_COMUNION",
  },
  postcommunion: {
    email: "postcomunion@sanpas.es",
    name: "Postcomunión San Pascual Baylón",
    passwordSecret: "SMTP_PASS_POSTCOMUNION",
  },
  global: {
    email: "grupojoven@sanpas.es",
    name: "Grupo Joven San Pascual Baylón",
    passwordSecret: "SMTP_PASS_GRUPOJOVEN",
  },
};

/**
 * Google muestra la contraseña de aplicación en bloques ("abcd efgh ijkl
 * mnop"), pero los espacios no forman parte de ella: así da igual cómo se pegue.
 */
export const getAppPassword = (account: FamilyMailAccount): string =>
  (Deno.env.get(account.passwordSecret) ?? "").replace(/\s+/g, "");
