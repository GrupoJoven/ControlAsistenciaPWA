import React from "react";
import { Church, LogOut, Menu, User as UserIcon, X } from "lucide-react";
import { NAVIGATION_SECTIONS } from "../../src/app/navigation";
import { User } from "../../types";
import { View } from "../../types/app";

interface AppSidebarProps {
  currentUser: User;
  currentView: View;
  isSidebarOpen: boolean;
  onCloseSidebar: () => void;
  onNavigate: (view: View) => void;
  onLogout: () => void;
  onUpdateUser: (u: User) => void;
}

const AppSidebar: React.FC<AppSidebarProps> = ({
  currentUser,
  currentView,
  isSidebarOpen,
  onCloseSidebar,
  onNavigate,
  onLogout,
  onUpdateUser,
}) => {
  const handleProfilePhotoChange = (newPhoto: string) => {
      if (currentUser) {
        onUpdateUser({ ...currentUser, photo: newPhoto });
      }
  };
  return (
    <>
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-40 lg:hidden"
          onClick={onCloseSidebar}
        />
      )}

      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-72 bg-white border-r border-slate-200 flex flex-col transition-transform duration-300 transform
          lg:translate-x-0 lg:static lg:inset-auto
          ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-3 text-indigo-700 font-bold text-xl leading-tight">
            <div className="p-2 bg-indigo-100 rounded-lg">
              <Church size={24} />
            </div>
            <div>
              <p>San Pascual Baylón</p>
              <p className="text-sm font-medium text-slate-400">Valencia</p>
            </div>
          </div>

          <button
            onClick={onCloseSidebar}
            className="lg:hidden p-2 text-slate-400 hover:text-slate-600"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 px-4 space-y-1 overflow-y-auto pb-6">
          {NAVIGATION_SECTIONS.map((section) => {
            const visibleItems = section.items.filter((item) => {
              if (!item.roles) return true;
              return item.roles.includes(currentUser.role);
            });

            if (visibleItems.length === 0) return null;

            return (
              <div key={section.id}>
                <div
                  className={`mt-4 px-4 py-2 text-[10px] font-bold uppercase tracking-widest ${
                    section.accent === "coordinator"
                      ? "text-amber-600"
                      : "text-slate-400"
                  }`}
                >
                  {section.label}
                </div>

                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = currentView === item.view;
                  const isCoordinatorSection = section.accent === "coordinator";

                  return (
                    <button
                      key={item.view}
                      onClick={() => onNavigate(item.view)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                        isActive
                          ? isCoordinatorSection
                            ? "bg-amber-50 text-amber-700"
                            : "bg-indigo-50 text-indigo-700"
                          : "text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <Icon size={20} />
                      <span className="font-medium text-sm">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200">
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 overflow-hidden">
              {currentUser.photo ? (
                <img
                  src={currentUser.photo}
                  className="w-full h-full object-cover"
                />
              ) : (
                <UserIcon size={18} />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-900 truncate">
                {currentUser.name}
              </p>
              <p className="text-xs text-slate-500 truncate capitalize">
                {currentUser.role}
              </p>
            </div>

            <button
              onClick={onLogout}
              className="text-slate-400 hover:text-red-500 transition-colors"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};

export default AppSidebar;
