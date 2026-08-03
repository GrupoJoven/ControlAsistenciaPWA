
import React, { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, CheckCircle2, CalendarDays, AlertTriangle, X, Check } from 'lucide-react';
import { formatDateLocal, getTodayStr } from '../types';
import { AcademicYear } from '../src/utils/academicYear';

interface ClassDayManagerProps {
  classDays: string[];
  academicYear: AcademicYear;
  onToggle: (date: string) => void;
}

const ClassDayManager: React.FC<ClassDayManagerProps> = ({ classDays, academicYear, onToggle }) => {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [dateToConfirm, setDateToConfirm] = useState<string | null>(null);

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const monthName = currentMonth.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

  const getDaysInMonth = (date: Date) => {
    const days = [];
    const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    
    // Day of week of first day (0-6, 0=Sun) - adjust to 0=Mon
    let startDay = firstDay.getDay();
    startDay = startDay === 0 ? 6 : startDay - 1;

    // Add empty slots for days before start of month
    for (let i = 0; i < startDay; i++) {
      days.push(null);
    }

    // Add actual days
    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push(new Date(date.getFullYear(), date.getMonth(), i));
    }

    return days;
  };

  const calendarDays = getDaysInMonth(currentMonth);
  const todayStr = getTodayStr();
  
  // Días lectivos del curso académico seleccionado
  const currentAcademicYearDaysCount = useMemo(() => {
    return classDays.filter(
      day => day >= academicYear.start && day <= academicYear.end
    ).length;
  }, [classDays, academicYear]);

  const handleDayClick = (dateStr: string) => {
    const isSelected = classDays.includes(dateStr);
    if (isSelected) {
      setDateToConfirm(dateStr);
    } else {
      onToggle(dateStr);
    }
  };

  const confirmRemoval = () => {
    if (dateToConfirm) {
      onToggle(dateToConfirm);
      setDateToConfirm(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="bg-white p-6 lg:p-8 rounded-3xl border border-slate-200 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 mb-8">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-amber-50 text-amber-600 rounded-xl shrink-0">
              <CalendarDays size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Calendario Escolar</h2>
              <p className="text-slate-500 text-xs sm:text-sm">Marca los días lectivos del curso.</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3 bg-slate-50 p-1.5 sm:p-2 rounded-2xl border border-slate-100 w-full sm:w-auto justify-between sm:justify-center">
            <button 
              onClick={prevMonth}
              className="p-2 hover:bg-white hover:shadow-sm rounded-xl transition-all text-slate-400 hover:text-indigo-600"
            >
              <ChevronLeft size={20} />
            </button>
            <span className="text-sm font-bold text-slate-700 capitalize min-w-[120px] sm:min-w-[140px] text-center">{monthName}</span>
            <button 
              onClick={nextMonth}
              className="p-2 hover:bg-white hover:shadow-sm rounded-xl transition-all text-slate-400 hover:text-indigo-600"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-px bg-slate-100 border border-slate-100 rounded-2xl overflow-hidden mb-8 shadow-inner">
          {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(day => (
            <div key={day} className="bg-slate-50 py-3 text-center text-[8px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              {day}
            </div>
          ))}
          {calendarDays.map((date, i) => {
            if (!date) return <div key={`empty-${i}`} className="bg-white" />;
            
            const dateStr = formatDateLocal(date);
            const isSelected = classDays.includes(dateStr);
            const isToday = dateStr === todayStr;
            const isWeekend = date.getDay() === 0 || date.getDay() === 6;

            return (
              <button
                key={dateStr}
                onClick={() => handleDayClick(dateStr)}
                className={`
                  h-16 sm:h-24 bg-white p-1 sm:p-2 relative flex flex-col items-center justify-center transition-all group
                  ${isSelected ? 'bg-indigo-50/50' : 'hover:bg-slate-50'}
                `}
              >
                <span className={`
                  text-xs sm:text-sm font-semibold rounded-full w-6 h-6 sm:w-8 sm:h-8 flex items-center justify-center mb-0.5 sm:mb-1
                  ${isToday ? 'bg-indigo-600 text-white shadow-md' : isSelected ? 'text-indigo-700 font-bold' : isWeekend ? 'text-slate-400' : 'text-slate-700'}
                `}>
                  {date.getDate()}
                </span>
                
                {isSelected && (
                  <div className="flex flex-col items-center animate-in zoom-in duration-300">
                    <CheckCircle2 size={12} className="text-indigo-600 sm:w-[16px] sm:h-[16px]" />
                    <span className="hidden sm:block text-[8px] font-bold text-indigo-500 uppercase tracking-tighter mt-1">LECTIVO</span>
                  </div>
                )}
                
                <div className={`absolute inset-0 border-2 border-transparent transition-all pointer-events-none ${isSelected ? 'group-hover:border-indigo-200' : 'group-hover:border-slate-100'}`} />
              </button>
            );
          })}
        </div>

        <div className="bg-indigo-50 rounded-2xl p-4 sm:p-6 border border-indigo-100">
          <h4 className="text-sm font-bold text-indigo-900 mb-2 flex items-center gap-2">
            <CalendarDays size={18} />
            Resumen del Curso Pastoral
          </h4>
          <p className="text-xs sm:text-sm text-indigo-700 leading-relaxed">
            Has marcado un total de <strong>{currentAcademicYearDaysCount} días lectivos</strong> para el {academicYear.label}.
          </p>
        </div>
      </div>

      {dateToConfirm && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl p-8 space-y-6">
            <div className="flex items-center gap-4 text-amber-600">
              <div className="p-3 bg-amber-50 rounded-2xl">
                <AlertTriangle size={32} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900">Quitar día lectivo</h3>
                <p className="text-sm text-slate-500 font-medium">{new Date(dateToConfirm).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
              </div>
            </div>
            <p className="text-slate-600 text-sm leading-relaxed">
              ¿Estás seguro de que deseas desmarcar este día como lectivo?
            </p>
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button 
                onClick={() => setDateToConfirm(null)}
                className="order-2 sm:order-1 flex-1 py-3 px-4 bg-slate-100 text-slate-600 font-bold rounded-2xl hover:bg-slate-200 transition-colors flex items-center justify-center gap-2"
              >
                <X size={18} />
                Cancelar
              </button>
              <button 
                onClick={confirmRemoval}
                className="order-1 sm:order-2 flex-1 py-3 px-4 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 shadow-lg shadow-indigo-100 flex items-center justify-center gap-2 transition-all"
              >
                <Check size={18} />
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClassDayManager;
