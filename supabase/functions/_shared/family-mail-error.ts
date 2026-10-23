// supabase/functions/_shared/family-mail-error.ts
//
// Error de "Correo" y "Contactar familias" con el código que entiende el
// frontend (components/FamilyInbox.tsx y components/FamilyContact.tsx), el
// estado HTTP y los datos extra que acompañan al mensaje.
export class FamilyMailError extends Error {
  constructor(public code: string, public status: number, public extra: Record<string, unknown> = {}) {
    super(code);
  }
}
