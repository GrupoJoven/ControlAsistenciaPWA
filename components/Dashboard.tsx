
import React, { useMemo } from 'react';
import { 
  Users, 
  Church, 
  BookOpen, 
  AlertCircle,
  TrendingUp,
  Award,
  Calendar,
  ChevronRight
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Student, calculateAttendanceWeight, ParishEvent, calculateStudentRate, getTodayStr, AttendanceRecord } from '../types';
import { AcademicYear, getAcademicYearCutoff } from '../src/utils/academicYear';

interface DashboardProps {
  students: Student[];
  events: ParishEvent[];
  onManageAgenda?: () => void;
  classDays: string[];
  academicYear: AcademicYear;
}

const Dashboard: React.FC<DashboardProps> = ({ students, events, onManageAgenda, classDays, academicYear }) => {
  const today = getTodayStr();
  const cutoff = getAcademicYearCutoff(academicYear);

  const todayRecords = students.map(s => s.attendanceHistory.find(h => h.date === today)).filter(Boolean) as AttendanceRecord[];

  const stats = {
    total: students.length,
    attendedCatechism: todayRecords.filter(r => r.catechism === 'present' || r.catechism === 'late').length,
    attendedMass: todayRecords.filter(r => r.mass === 'present' || r.mass === 'late').length,
    atRisk: students.filter(s => calculateStudentRate(s, classDays, academicYear) < 60).length,
  };

  // Filter and sort only future events
  const upcomingEvents = useMemo(() => {
    const nowTs = Date.now();

    return events
      .filter(event => new Date(event.date).getTime() >= nowTs)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [events]);

  // Monthly chart data based on the selected academic year class days
  const chartData = useMemo(() => {
    const nStudents = students.length;

    // Último mes a representar: el actual si el curso está en marcha, o agosto
    // si ya se cerró.
    const cutoffMonthIdx = Number(cutoff.slice(5, 7)) - 1;

    // Si no hay alumnos, evita divisiones raras
    if (nStudents === 0) {
      const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
      return [
        { name: 'Sep', participación: 0 },
        { name: monthNames[cutoffMonthIdx], participación: 0 }
      ];
    }

    // 1) Días lectivos del curso ya pasados
    const pastClassDays = classDays.filter(
      d => d >= academicYear.start && d <= cutoff
    );

    const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  
    // 2) Acumuladores mensuales
    // monthTotals[month] = { totalWeight: suma pesos, nDays: nº días lectivos considerados }
    const monthTotals: Record<string, { totalWeight: number; nDays: number }> = {};
  
    // 3) Recorremos días y sumamos peso de TODO el grupo (ausentes/no-registro = 0)
    pastClassDays.forEach(day => {
      let totalDayWeight = 0;
  
      students.forEach(student => {
        const record = student.attendanceHistory.find(h => h.date === day);
        if (record) {
          totalDayWeight += calculateAttendanceWeight(record);
        }
        // Si no hay record: suma 0 (implícito)
      });
  
      const d = new Date(day);
      const monthKey = monthNames[d.getMonth()];
  
      if (!monthTotals[monthKey]) monthTotals[monthKey] = { totalWeight: 0, nDays: 0 };
      monthTotals[monthKey].totalWeight += totalDayWeight;
      monthTotals[monthKey].nDays += 1; // contamos el día lectivo aunque haya sido 0
    });
  
    // 4) Construimos secuencia académica Sep->Ago, pero cortamos en el mes tope
    const yearSequence = [8, 9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7]; // Sep..Ago

    const dataForChart: { name: string; participación: number }[] = [];
  
    for (const mIdx of yearSequence) {
      const mName = monthNames[mIdx];
      const m = monthTotals[mName];
  
      if (m && m.nDays > 0) {
        // Media mensual ponderada por alumnos y días:
        const avg = (m.totalWeight / (nStudents * m.nDays)) * 100;
        dataForChart.push({ name: mName, participación: Math.round(avg) });
      } else {
        // Si prefieres mostrar 0 en meses sin datos, descomenta:
        // dataForChart.push({ name: mName, participación: 0 });
        // Si prefieres ocultarlos (como ahora), no haces nada.
      }
  
      if (mIdx === cutoffMonthIdx) break;
    }

    return dataForChart.length > 0 ? dataForChart : [
      { name: 'Sep', participación: 0 },
      { name: monthNames[cutoffMonthIdx], participación: 0 }
    ];
  }, [students, classDays, academicYear, cutoff]);

  return (
    <div className="space-y-6 lg:space-y-8">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
        <div className="bg-white p-4 lg:p-6 rounded-2xl border border-slate-200 shadow-sm border-b-4 border-b-indigo-500">
          <div className="flex items-center justify-between mb-3 lg:mb-4">
            <div className="p-1.5 lg:p-2 bg-indigo-50 text-indigo-600 rounded-lg">
              <Users size={20} />
            </div>
          </div>
          <p className="text-slate-500 text-[10px] lg:text-xs font-bold uppercase tracking-wider">Total Niños</p>
          <h3 className="text-xl lg:text-3xl font-bold text-slate-900 mt-1">{stats.total}</h3>
        </div>

        <div className="bg-white p-4 lg:p-6 rounded-2xl border border-slate-200 shadow-sm border-b-4 border-b-blue-500">
          <div className="flex items-center justify-between mb-3 lg:mb-4">
            <div className="p-1.5 lg:p-2 bg-blue-50 text-blue-600 rounded-lg">
              <BookOpen size={20} />
            </div>
          </div>
          <p className="text-slate-500 text-[10px] lg:text-xs font-bold uppercase tracking-wider">Catequesis Hoy</p>
          <h3 className="text-xl lg:text-3xl font-bold text-slate-900 mt-1">{stats.attendedCatechism}</h3>
        </div>

        <div className="bg-white p-4 lg:p-6 rounded-2xl border border-slate-200 shadow-sm border-b-4 border-b-amber-500">
          <div className="flex items-center justify-between mb-3 lg:mb-4">
            <div className="p-1.5 lg:p-2 bg-amber-50 text-amber-600 rounded-lg">
              <Church size={20} />
            </div>
          </div>
          <p className="text-slate-500 text-[10px] lg:text-xs font-bold uppercase tracking-wider">Misa Hoy</p>
          <h3 className="text-xl lg:text-3xl font-bold text-slate-900 mt-1">{stats.attendedMass}</h3>
        </div>

        <div className="bg-white p-4 lg:p-6 rounded-2xl border border-slate-200 shadow-sm border-b-4 border-b-red-500">
          <div className="flex items-center justify-between mb-3 lg:mb-4">
            <div className="p-1.5 lg:p-2 bg-red-50 text-red-600 rounded-lg">
              <AlertCircle size={20} />
            </div>
          </div>
          <p className="text-slate-500 text-[10px] lg:text-xs font-bold uppercase tracking-wider">Baja Asistencia</p>
          <h3 className="text-xl lg:text-3xl font-bold text-slate-900 mt-1">{stats.atRisk}</h3>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
        <div className="lg:col-span-2 bg-white p-5 lg:p-8 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 lg:mb-8 gap-3">
            <div>
              <h3 className="text-lg font-bold text-slate-800">Participación Media</h3>
              <p className="text-slate-500 text-xs lg:text-sm">Curso {new Date(academicYear.start).getFullYear()} - {new Date(academicYear.end).getFullYear()}</p>
            </div>
            <div className="flex items-center gap-2 self-start text-[10px] font-bold text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-full">
              <TrendingUp size={14} />
              Datos Lectivos
            </div>
          </div>
          <div className="h-48 lg:h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorPart" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 10}} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 10}} unit="%" domain={[0, 100]} width={30} />
                <Tooltip 
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  formatter={(value: number) => [`${value}%`, 'Participación']}
                />
                <Area type="monotone" dataKey="participación" stroke="#4f46e5" strokeWidth={3} fill="url(#colorPart)" connectNulls />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 lg:p-8 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
          <h3 className="text-lg font-bold text-slate-800 mb-6">Próximos Eventos</h3>
          <div className="space-y-4 flex-1">
            {upcomingEvents.length > 0 ? upcomingEvents.map(event => (
              <div key={event.id} className="p-4 bg-indigo-50 rounded-xl border border-indigo-100 flex items-start gap-3">
                <div className="p-2 bg-white text-indigo-600 rounded-lg shadow-sm shrink-0">
                  <Award size={20} />
                </div>
                <div className="min-w-0">
                  <h4 className="font-semibold text-indigo-900 text-sm truncate">{event.title}</h4>
                  <p className="text-indigo-700 text-xs mt-0.5">
                    {new Date(event.date).toLocaleString('es-ES', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>
            )) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Calendar className="text-slate-200 mb-3" size={32} />
                <p className="text-slate-400 text-xs italic">No hay futuros eventos programados</p>
              </div>
            )}
          </div>
          {onManageAgenda && (
            <button 
              onClick={onManageAgenda}
              className="w-full mt-6 py-3 px-4 bg-indigo-700 text-white rounded-xl text-xs lg:text-sm font-bold hover:bg-indigo-800 transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-100"
            >
              Agenda Parroquial
              <ChevronRight size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
