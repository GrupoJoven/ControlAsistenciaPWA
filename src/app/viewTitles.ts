import { View } from "../types/app";
import type { User } from "../../types";
import { MonitorStage, isMonitorStageUser } from "../utils/stages";
import { getMonitorStageConfig } from "../utils/monitors";

export const VIEW_TITLES: Record<View, string> = {
  dashboard: "Dashboard Parroquial",
  "school-calendar": "Calendario escolar",
  attendance: "Control de Asistencia",
  history: "Histórico de asistencia",
  "group-history": "Histórico grupos",
  students: "Mis Catecúmenos",
  services: "Servicios",
  incidents: "Gestión de incidencias",
  "coordinator-groups": "Gestión Integral de Niños",
  catechists: "Registro de Catequistas",
  "catechist-attendance": "Asistencia del Equipo",
  "family-contact": "Contactar familias",
  "family-inbox": "Correo",
  "super-inbox-communion": "Correo de comunión",
  "super-inbox-postcommunion": "Correo de postcomunión",
  "super-inbox-preconfirmation": "Correo de preconfirmación",
  "super-inbox-confirmation": "Correo de confirmación",
  "super-coordinators": "Coordinadores de etapa",
  "coordinator-edit-groups": "Administración de Grupos",
  agenda: "Planificador de Eventos",
  reports: "Informes pastorales con IA",
  "class-days": "Calendario de Días Lectivos",
  drive: "Drive Grupo Joven",
  account: "Seguridad de la Cuenta",
  "my-account": "Mi Cuenta",
};

/** Títulos de las pantallas compartidas, vistas desde comunión o postcomunión. */
const monitorTitles = (stage: MonitorStage): Partial<Record<View, string>> => {
  const config = getMonitorStageConfig(stage);
  const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

  return {
    dashboard: `Resumen de ${config.label.toLowerCase()}`,
    "school-calendar": "Calendario de actividades",
    catechists: config.teamLabel,
    "catechist-attendance": `Asistencia de ${config.teamLabel.toLowerCase()}`,
    "class-days": capitalize(config.dayLabelPlural),
    agenda: `${capitalize(config.meetingLabelPlural)} de ${config.label.toLowerCase()}`,
    "family-inbox": `Correo de ${config.label.toLowerCase()}`,
  };
};

export const getViewTitle = (view: View, user: User | null): string => {
  if (user && isMonitorStageUser(user)) {
    const titles = monitorTitles(user.stage as MonitorStage);
    return titles[view] ?? VIEW_TITLES[view];
  }

  return VIEW_TITLES[view];
};
