import { Group, Student, User } from "../../types";
import { GroupCatechistLink } from "../types/app";
import { normalizeSearchText } from "../utils/text";

export const getUserGroupIdsFromLinks = (
  userId: string,
  groupCatechistLinks: GroupCatechistLink[]
): string[] => {
  return groupCatechistLinks
    .filter((link) => link.profile_id === userId)
    .map((link) => link.group_id);
};

export const getMyGroups = (
  currentUser: User | null,
  groups: Group[],
  groupCatechistLinks: GroupCatechistLink[]
): Group[] => {
  if (!currentUser) return [];

  const myIds = new Set(getUserGroupIdsFromLinks(currentUser.id, groupCatechistLinks));

  return groups
    .filter((group) => myIds.has(group.id))
    .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
};

export const getGroupsWithCatechists = (
  groups: Group[],
  groupCatechistLinks: GroupCatechistLink[]
): Group[] => {
  const byGroup = new Map<string, string[]>();

  for (const link of groupCatechistLinks) {
    const arr = byGroup.get(link.group_id) ?? [];
    arr.push(link.profile_id);
    byGroup.set(link.group_id, arr);
  }

  return groups.map((group) => ({
    ...group,
    catechistIds: byGroup.get(group.id) ?? [],
  }));
};

export const getFilteredUsers = (users: User[], searchQuery: string): User[] => {
  if (!searchQuery) return users;

  return users
    .filter((user) =>
      normalizeSearchText(user.name).includes(normalizeSearchText(searchQuery))
    )
    .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
};

export const getCurrentGroupName = (
  groups: Group[],
  activeGroupId: string | null
): string => {
  return groups.find((group) => group.id === activeGroupId)?.name || "";
};

export const getActiveGroupStudents = (
  students: Student[],
  activeGroupId: string | null
): Student[] => {
  if (!activeGroupId) return [];
  return students.filter((student) => student.groupId === activeGroupId);
};

export const getMyCatecumenos = (
  students: Student[],
  activeGroupId: string | null,
  searchQuery: string
): Student[] => {
  if (!activeGroupId) return [];

  return students
    .filter(
      (student) =>
        student.groupId === activeGroupId &&
        normalizeSearchText(student.name).includes(normalizeSearchText(searchQuery))
    )
    .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
};

export const getHasAnyGroupAssigned = (
  currentUser: User | null,
  groupCatechistLinks: GroupCatechistLink[]
): boolean => {
  if (!currentUser) return false;
  return groupCatechistLinks.some((link) => link.profile_id === currentUser.id);
};

export const getWarningFlags = ({
  currentUser,
  hasAnyGroupAssigned,
  activeGroupId,
  activeGroupStudents,
}: {
  currentUser: User | null;
  hasAnyGroupAssigned: boolean;
  activeGroupId: string | null;
  activeGroupStudents: Student[];
}) => {
  const showNoGroupWarning = !!currentUser && !hasAnyGroupAssigned;
  const showNoStudentsWarning =
    !!currentUser &&
    hasAnyGroupAssigned &&
    !!activeGroupId &&
    activeGroupStudents.length === 0;

  return {
    showNoGroupWarning,
    showNoStudentsWarning,
  };
};

export const getWarningMessage = ({
  showNoGroupWarning,
  showNoStudentsWarning,
  currentGroupName,
}: {
  showNoGroupWarning: boolean;
  showNoStudentsWarning: boolean;
  currentGroupName: string;
}): string => {
  if (showNoGroupWarning) {
    return "No tienes ningún grupo asignado. Contacta con el coordinador si crees que se trata de un error.";
  }

  if (showNoStudentsWarning) {
    const name = currentGroupName || "tu grupo";
    return `En tu grupo [${name}] no hay ningún niño/a asignado. Contacta con el coordinador si crees que se trata de un error.`;
  }

  return "";
};