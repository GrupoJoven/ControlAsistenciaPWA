export type View =
  | "dashboard"
  | "school-calendar"
  | "attendance"
  | "history"
  | "group-history"
  | "students"
  | "services"
  | "incidents"
  | "coordinator-groups"
  | "coordinator-edit-groups"
  | "agenda"
  | "reports"
  | "class-days"
  | "catechists"
  | "catechist-attendance"
  | "family-contact"
  | "family-inbox"
  | "super-inbox-communion"
  | "super-inbox-postcommunion"
  | "super-inbox-preconfirmation"
  | "super-inbox-confirmation"
  | "super-coordinators"
  | "drive"
  | "account"
  | "my-account";

export type GroupCatechistLink = {
  group_id: string;
  profile_id: string;
};

export type SchoolName = {
  id: string;
  name: string;
};

export type BirthdayInfo = {
  id: string;
  name: string;
  age: number;
};

export type StudentBirthdayInfo = {
  student_id: string;
  student_name: string;
  age: number;
  group_id: string;
};