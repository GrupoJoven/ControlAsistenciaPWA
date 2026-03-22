import {
  BarChart3,
  Calendar,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Key,
  Mail,
  Settings,
  ShieldCheck,
  TriangleAlert,
  User,
  Users,
  Briefcase,
  HardDrive,
  LucideIcon,
} from "lucide-react";
import { View } from "../types/app";


type Role = "coordinator" | "catechist";

export type NavigationSection = {
  id: string;
  label: string;
  accent?: "default" | "coordinator";
  items: NavigationItem[];
};

export type NavigationItem = {
  view: View;
  label: string;
  icon: LucideIcon;
  roles?: Role[];
};

export const NAVIGATION_SECTIONS: NavigationSection[] = [
  {
    id: "general",
    label: "General",
    accent: "default",
    items: [
      { view: "dashboard", label: "Resumen", icon: BarChart3 },
      { view: "school-calendar", label: "Calendario escolar", icon: CalendarDays },
      { view: "drive", label: "Drive", icon: HardDrive },
    ],
  },
  {
    id: "my-group",
    label: "Mi Grupo",
    accent: "default",
    items: [
      { view: "attendance", label: "Pasar Lista", icon: CheckCircle2 },
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
      { view: "coordinator-groups", label: "Todos los Niños", icon: ShieldCheck, roles: ["coordinator"] },
      { view: "catechists", label: "Registro Catequistas", icon: Briefcase, roles: ["coordinator"] },
      { view: "catechist-attendance", label: "Asistencia Equipo", icon: CheckCircle2, roles: ["coordinator"] },
      { view: "coordinator-edit-groups", label: "Editar Grupos", icon: Settings, roles: ["coordinator"] },
      { view: "class-days", label: "Gestión de calendario", icon: CalendarDays, roles: ["coordinator"] },
      { view: "agenda", label: "Gestión Agenda", icon: Calendar, roles: ["coordinator"] },
    ],
  },
  {
    id: "analysis",
    label: "Análisis",
    accent: "default",
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
      { view: "my-account", label: "Cuenta", icon: User },
    ],
  },
];