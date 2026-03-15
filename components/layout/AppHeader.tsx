import React from "react";
import { Menu, Search } from "lucide-react";
import { VIEW_TITLES } from "../../src/app/viewTitles";
import { Group } from "../../types";
import { View } from "../../src/types/app";

interface AppHeaderProps {
  currentView: View;
  currentGroupName: string;
  myGroups: Group[];
  activeGroupId: string | null;
  onChangeActiveGroup: (groupId: string | null) => void;
  onOpenSidebar: () => void;
  isSearchView: boolean;
  searchQuery: string;
  onSearchChange: (value: string) => void;
}

const AppHeader: React.FC<AppHeaderProps> = ({
  currentView,
  currentGroupName,
  myGroups,
  activeGroupId,
  onChangeActiveGroup,
  onOpenSidebar,
  isSearchView,
  searchQuery,
  onSearchChange,
}) => {
  const title =
    currentView === "students"
      ? currentGroupName || VIEW_TITLES[currentView]
      : VIEW_TITLES[currentView];

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30 px-4 lg:px-8 py-3 lg:py-4 flex items-center justify-between min-h-[64px]">
      <div className="flex items-center gap-3 lg:gap-4 flex-1 min-w-0">
        <button
          onClick={onOpenSidebar}
          className="lg:hidden p-2 bg-slate-100 rounded-lg text-slate-600 hover:bg-slate-200 transition-colors shrink-0"
        >
          <Menu size={20} />
        </button>

        <h1 className="text-[15px] sm:text-lg lg:text-xl font-semibold text-slate-800 leading-tight line-clamp-2 max-h-[3rem]">
          {title}
        </h1>

        <div>
          {myGroups.length > 1 && (
            <select
              className="px-3 py-2 bg-slate-100 rounded-xl text-sm"
              value={activeGroupId ?? ""}
              onChange={(e) => onChangeActiveGroup(e.target.value || null)}
            >
              {myGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="hidden sm:flex items-center gap-4 ml-4">
        {isSearchView && (
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              size={18}
            />
            <input
              type="text"
              placeholder="Buscar..."
              className="pl-10 pr-4 py-2 bg-slate-100 border-none rounded-full text-sm focus:ring-2 focus:ring-indigo-500 w-48 lg:w-64 transition-all"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
        )}
      </div>
    </header>
  );
};

export default AppHeader;