import {
  BarChart3,
  Calendar,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Key,
  Mail,
  Send,
  Settings,
  ShieldCheck,
  TriangleAlert,
  User as UserIcon,
  Users,
  Briefcase,
  HardDrive,
  Inbox,
  UserCog,
  LucideIcon,
} from "lucide-react";
import { View } from "../types/app";
import type { User } from "../../types";
import { isGlobalCoordinator, isMonitorStageUser } from "../utils/stages";


type Role = "coordinator" | "catechist";

export type NavigationSection = {
  id: string;
  label: string;
  accent?: "default" | "coordinator" | "supercoordinator";
  /**
   * Comunión y postcomunión no tienen grupos ni niños: a sus coordinadores no
   * se les muestra esta sección.
   */
  hiddenForMonitorStage?: boolean;
  items: NavigationItem[];
};

export type NavigationItem = {
  view: View;
  label: string;
  icon: LucideIcon;
  roles?: Role[];
  /** Solo para el coordinador general (coordinator sin etapa). */
  globalCoordinatorOnly?: boolean;
  /** No se le muestra a los usuarios de comunión/postcomunión. */
  hiddenForMonitorStage?: boolean;
  /**
   * Cómo se llama para ellos. La pantalla es la misma, pero lo que gestionan
   * son monitores, días de actividad y reuniones, no niños ni días lectivos.
   */
  monitorLabel?: string;
};

export const NAVIGATION_SECTIONS: NavigationSection[] = [
  {
    id: "general",
    label: "General",
    accent: "default",
    items: [
      { view: "dashboard", label: "Resumen", icon: BarChart3 },
      {
        view: "school-calendar",
        label: "Calendario escolar",
        icon: CalendarDays,
        monitorLabel: "Calendario de actividades",
      },
      { view: "drive", label: "Drive", icon: HardDrive },
    ],
  },
  {
    id: "my-group",
    label: "Mi Grupo",
    accent: "default",
    hiddenForMonitorStage: true,
    items: [
      { view: "attendance", label: "Pasar Lista", icon: CheckCircle2 },
      { view: "history", label: "Histórico", icon: CalendarDays },
      { view: "students", label: "Mis Catecúmenos", icon: Users },
      { view: "services", label: "Servicios", icon: ClipboardList },
      { view: "incidents", label: "Incidencias", icon: TriangleAlert },
    ],
  },
  {
    id: "coordination",
    label: "Coordinación",
    accent: "coordinator",
    items: [
      {
        view: "coordinator-groups",
        label: "Todos los Niños",
        icon: ShieldCheck,
        roles: ["coordinator"],
        hiddenForMonitorStage: true,
      },
      {
        view: "catechists",
        label: "Registro Catequistas",
        icon: Briefcase,
        roles: ["coordinator"],
        monitorLabel: "Registro Monitores",
      },
      {
        view: "catechist-attendance",
        label: "Asistencia Equipo",
        icon: CheckCircle2,
        roles: ["coordinator"],
        monitorLabel: "Asistencia Monitores",
      },
      {
        view: "family-contact",
        label: "Contactar familias",
        icon: Send,
        roles: ["coordinator"],
        hiddenForMonitorStage: true,
      },
      { view: "family-inbox", label: "Correo", icon: Inbox, roles: ["coordinator"] },
      {
        view: "group-history",
        label: "Histórico Grupos",
        icon: CalendarDays,
        roles: ["coordinator"],
        hiddenForMonitorStage: true,
      },
      {
        view: "coordinator-edit-groups",
        label: "Editar Grupos",
        icon: Settings,
        roles: ["coordinator"],
        hiddenForMonitorStage: true,
      },
      {
        view: "class-days",
        label: "Gestión de calendario",
        icon: CalendarDays,
        roles: ["coordinator"],
        monitorLabel: "Gestión de actividades",
      },
      {
        view: "agenda",
        label: "Gestión Agenda",
        icon: Calendar,
        roles: ["coordinator"],
        monitorLabel: "Gestión de Reuniones",
      },
    ],
  },
  {
    id: "supercoordination",
    label: "Supercoordinación",
    accent: "supercoordinator",
    items: [
      { view: "super-inbox-communion", label: "Correo de comunión", icon: Inbox, globalCoordinatorOnly: true },
      { view: "super-inbox-postcommunion", label: "Correo de postcomunión", icon: Inbox, globalCoordinatorOnly: true },
      { view: "super-inbox-preconfirmation", label: "Correo de preconfirmación", icon: Inbox, globalCoordinatorOnly: true },
      { view: "super-inbox-confirmation", label: "Correo de confirmación", icon: Inbox, globalCoordinatorOnly: true },
      { view: "super-coordinators", label: "Coordinadores", icon: UserCog, globalCoordinatorOnly: true },
    ],
  },
  {
    id: "analysis",
    label: "Análisis",
    accent: "default",
    // Los informes con IA son de niños y de catequistas.
    hiddenForMonitorStage: true,
    items: [
      { view: "reports", label: "Informes IA", icon: Mail },
    ],
  },
  {
    id: "account",
    label: "Cuenta y Seguridad",
    accent: "default",
    items: [
      { view: "account", label: "Seguridad", icon: Key },
      { view: "my-account", label: "Cuenta", icon: UserIcon },
    ],
  },
];

/**
 * El menú de un usuario concreto. Para los de comunión y postcomunión se
 * quitan las secciones y entradas que van de grupos y niños, y las que se
 * quedan cambian de nombre: lo que gestionan son monitores, días de actividad
 * y reuniones.
 */
export const getNavigationSections = (user: User): NavigationSection[] => {
  const isMonitorUser = isMonitorStageUser(user);
  const isGlobal = isGlobalCoordinator(user);

  return NAVIGATION_SECTIONS.filter(
    (section) => !(isMonitorUser && section.hiddenForMonitorStage)
  )
    .map((section) => ({
      ...section,
      items: section.items
        .filter((item) => {
          if (item.globalCoordinatorOnly && !isGlobal) return false;
          if (isMonitorUser && item.hiddenForMonitorStage) return false;
          if (!item.roles) return true;
          return item.roles.includes(user.role);
        })
        .map((item) => ({
          ...item,
          label: isMonitorUser && item.monitorLabel ? item.monitorLabel : item.label,
        })),
    }))
    .filter((section) => section.items.length > 0);
};

/** ¿Puede este usuario abrir esta pantalla? Se usa al volver del menú. */
export const canSeeView = (user: User, view: View): boolean =>
  getNavigationSections(user).some((section) =>
    section.items.some((item) => item.view === view)
  );
