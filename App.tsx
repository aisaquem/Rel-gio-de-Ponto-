
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { PunchType, PunchRecord, UserSettings } from './types';
import { formatTime, formatDate, minutesToReadable, calculateDailyHours, calculateMonthlyStats, exportToCSV, exportToPDF } from './utils/timeUtils';
import { getAIReview } from './services/geminiService';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface UserProfile {
  id: string;
  name: string;
}

const App: React.FC = () => {
  const [currentTime, setCurrentTime] = useState(new Date());
  
  // State for Profiles
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  
  // State for Data (dependent on currentUserId)
  const [records, setRecords] = useState<PunchRecord[]>([]);
  
  // Default settings
  const defaultSettings: UserSettings = {
    dailyWorkloadMinutes: 480, // 8 hours
    userName: 'Usuário',
    role: '',
    companyName: '',
    cnpj: '',
    address: '',
    ctps: '',
    admissionDate: '',
    weeklyRestDay: 'Domingo',
    isDarkMode: false,
    schedule: {
      start: '09:00',
      breakStart: '12:00',
      breakEnd: '13:00',
      end: '18:00',
      enabled: false
    },
    pdfSettings: {
      showCompanyInfo: true,
      showEmployeeInfo: true,
      showPeriodDetails: true,
      showSummary: true,
      showSignatures: true
    }
  };

  const [settings, setSettings] = useState<UserSettings>(defaultSettings);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isManualEntryOpen, setIsManualEntryOpen] = useState(false);
  
  // Manual Entry States
  const [manualDate, setManualDate] = useState(new Date().toISOString().split('T')[0]);
  const [manualTime, setManualTime] = useState('');
  const [manualType, setManualType] = useState<PunchType>(PunchType.ENTRY);
  
  // New Profile State
  const [newProfileName, setNewProfileName] = useState('');
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);

  const [aiReview, setAiReview] = useState<string | null>(null);
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  
  // Ref to track last notification minute to prevent duplicate alerts
  const lastNotificationTimeRef = useRef<string | null>(null);

  // --- INITIALIZATION & MIGRATION LOGIC ---
  useEffect(() => {
    const storedProfiles = localStorage.getItem('chronos_profiles');
    
    if (storedProfiles) {
      // System already has profiles
      const parsedProfiles = JSON.parse(storedProfiles);
      setProfiles(parsedProfiles);
      
      const lastActiveId = localStorage.getItem('chronos_active_user_id');
      if (lastActiveId && parsedProfiles.find((p: UserProfile) => p.id === lastActiveId)) {
        setCurrentUserId(lastActiveId);
      } else if (parsedProfiles.length > 0) {
        setCurrentUserId(parsedProfiles[0].id);
      }
    } else {
      // First time running with multi-user or migration needed
      const oldRecords = localStorage.getItem('chronos_records');
      const oldSettings = localStorage.getItem('chronos_settings');
      
      const newId = Date.now().toString();
      let initialName = 'Usuário Padrão';
      
      // If there were old settings, try to grab the name
      if (oldSettings) {
        const parsedOldSettings = JSON.parse(oldSettings);
        if (parsedOldSettings.userName) initialName = parsedOldSettings.userName;
      }

      const initialProfile: UserProfile = { id: newId, name: initialName };
      
      // Migrate data to new namespaced keys
      if (oldRecords) localStorage.setItem(`chronos_records_${newId}`, oldRecords);
      if (oldSettings) localStorage.setItem(`chronos_settings_${newId}`, oldSettings);
      
      // Save profile structure
      const initialProfiles = [initialProfile];
      localStorage.setItem('chronos_profiles', JSON.stringify(initialProfiles));
      localStorage.setItem('chronos_active_user_id', newId);
      
      setProfiles(initialProfiles);
      setCurrentUserId(newId);
    }

    // Set initial manual time
    setManualTime(new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'}));
  }, []);

  // --- LOAD USER DATA WHEN ID CHANGES ---
  useEffect(() => {
    if (!currentUserId) return;

    const userRecords = localStorage.getItem(`chronos_records_${currentUserId}`);
    const userSettings = localStorage.getItem(`chronos_settings_${currentUserId}`);
    
    if (userRecords) {
      setRecords(JSON.parse(userRecords));
    } else {
      setRecords([]);
    }
    
    if (userSettings) {
      const parsedSettings = JSON.parse(userSettings);
      // Merge with defaults to ensure schema consistency
      setSettings({
        ...defaultSettings,
        ...parsedSettings,
        schedule: { ...defaultSettings.schedule, ...(parsedSettings.schedule || {}) },
        pdfSettings: { ...defaultSettings.pdfSettings, ...(parsedSettings.pdfSettings || {}) }
      });
    } else {
      // New user default settings
      const currentProfile = profiles.find(p => p.id === currentUserId);
      setSettings({
        ...defaultSettings,
        userName: currentProfile ? currentProfile.name : 'Novo Usuário'
      });
    }
    
    // Clear previous session state
    setAiReview(null);
    localStorage.setItem('chronos_active_user_id', currentUserId);

  }, [currentUserId]);

  // --- PERSISTENCE ---
  
  // Save Records (Namespaced)
  useEffect(() => {
    if (currentUserId) {
      localStorage.setItem(`chronos_records_${currentUserId}`, JSON.stringify(records));
    }
  }, [records, currentUserId]);

  // Save Settings (Namespaced) & Update Profile Name Sync
  useEffect(() => {
    if (currentUserId) {
      localStorage.setItem(`chronos_settings_${currentUserId}`, JSON.stringify(settings));
      
      // Update profile list name if settings name changed
      setProfiles(prev => {
        const updated = prev.map(p => 
          p.id === currentUserId && p.name !== settings.userName 
            ? { ...p, name: settings.userName } 
            : p
        );
        // Only write to localstorage if changed
        if (JSON.stringify(updated) !== JSON.stringify(prev)) {
          localStorage.setItem('chronos_profiles', JSON.stringify(updated));
        }
        return updated;
      });
    }
  }, [settings, currentUserId]);

  // Dark Mode Logic
  useEffect(() => {
    if (settings.isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [settings.isDarkMode]);

  // Request Notification Permission
  const requestNotificationPermission = useCallback(async () => {
    if (!('Notification' in window)) {
      console.log('Este navegador não suporta notificações de sistema');
      return;
    }
    
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  }, []);

  // Send Notification Helper
  const sendNotification = (title: string, body: string) => {
    if (Notification.permission === 'granted' && settings.schedule.enabled) {
      new Notification(title, {
        body,
        icon: 'https://cdn-icons-png.flaticon.com/512/2928/2928752.png' // Generic clock icon fallback
      });
    }
  };

  // Clock tick & Notification Check
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTime(now);

      // Notification Logic
      if (settings.schedule.enabled) {
        const currentHM = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        
        // Prevent multiple notifications in the same minute
        if (lastNotificationTimeRef.current !== currentHM) {
          if (currentHM === settings.schedule.start) {
            sendNotification('Chronos: Hora de Entrar!', 'Bom dia! Não esqueça de registrar sua entrada.');
            lastNotificationTimeRef.current = currentHM;
          } else if (currentHM === settings.schedule.breakStart) {
            sendNotification('Chronos: Pausa', 'Hora do seu intervalo. Bom descanso!');
            lastNotificationTimeRef.current = currentHM;
          } else if (currentHM === settings.schedule.breakEnd) {
            sendNotification('Chronos: Volta da Pausa', 'Hora de retornar ao trabalho.');
            lastNotificationTimeRef.current = currentHM;
          } else if (currentHM === settings.schedule.end) {
            sendNotification('Chronos: Fim do Expediente', 'Por hoje é só! Não esqueça de registrar sua saída.');
            lastNotificationTimeRef.current = currentHM;
          }
        }
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [settings.schedule]);

  // --- PROFILE HANDLERS ---
  const handleCreateProfile = () => {
    if (!newProfileName.trim()) {
      alert("Digite um nome para o perfil.");
      return;
    }
    const newId = Date.now().toString();
    const newProfile: UserProfile = { id: newId, name: newProfileName };
    
    const updatedProfiles = [...profiles, newProfile];
    setProfiles(updatedProfiles);
    localStorage.setItem('chronos_profiles', JSON.stringify(updatedProfiles));
    
    // Initialize empty data for new user
    localStorage.setItem(`chronos_records_${newId}`, JSON.stringify([]));
    localStorage.setItem(`chronos_settings_${newId}`, JSON.stringify({
      ...defaultSettings,
      userName: newProfileName
    }));

    setNewProfileName('');
    setIsCreatingProfile(false);
    setCurrentUserId(newId); // Switch to new user
  };

  const handlePunch = (type: PunchType) => {
    const newRecord: PunchRecord = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      type
    };
    // Add and sort by timestamp descending (newest first)
    setRecords(prev => [newRecord, ...prev].sort((a, b) => b.timestamp - a.timestamp));
  };

  const handleManualEntry = () => {
    if (!manualDate || !manualTime) {
      alert("Por favor, preencha data e hora.");
      return;
    }

    const dateTimeString = `${manualDate}T${manualTime}`;
    const timestamp = new Date(dateTimeString).getTime();

    if (isNaN(timestamp)) {
      alert("Data ou hora inválida.");
      return;
    }

    const newRecord: PunchRecord = {
      id: Date.now().toString(),
      timestamp: timestamp,
      type: manualType
    };

    setRecords(prev => [...prev, newRecord].sort((a, b) => b.timestamp - a.timestamp));
    setIsManualEntryOpen(false);
  };

  const clearHistory = () => {
    if (confirm('Tem certeza que deseja limpar todo o histórico deste perfil?')) {
      setRecords([]);
      setAiReview(null);
    }
  };

  const generateAIReview = async () => {
    if (records.length === 0) {
      alert("Nenhum registro encontrado para analisar.");
      return;
    }
    setIsLoadingAI(true);
    const review = await getAIReview(records, settings.dailyWorkloadMinutes);
    setAiReview(review);
    setIsLoadingAI(false);
  };

  const getTodayRecords = () => {
    const today = new Date().setHours(0, 0, 0, 0);
    return records.filter(r => new Date(r.timestamp).setHours(0, 0, 0, 0) === today);
  };

  const todayStats = calculateDailyHours(getTodayRecords());
  const dailyBalance = todayStats.total - settings.dailyWorkloadMinutes;

  const monthlyStats = calculateMonthlyStats(records, currentTime, settings.dailyWorkloadMinutes);

  // Chart Data (Last 7 days)
  const getChartData = () => {
    const days: any[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = formatDate(d.getTime());
      const dayRecords = records.filter(r => formatDate(r.timestamp) === dateStr);
      const stats = calculateDailyHours(dayRecords);
      days.push({
        name: dateStr.split('/')[0] + '/' + dateStr.split('/')[1],
        horas: (stats.total / 60).toFixed(2),
        meta: (settings.dailyWorkloadMinutes / 60).toFixed(2)
      });
    }
    return days;
  };

  // Helper for PDF Setting Toggles
  const PDFToggle: React.FC<{label: string, checked: boolean, onChange: (v: boolean) => void}> = ({label, checked, onChange}) => (
    <div className="flex items-center justify-between py-2 border-b border-slate-50 dark:border-slate-700 last:border-0">
      <span className="text-sm text-slate-600 dark:text-slate-300">{label}</span>
      <button 
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${checked ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-600'}`}
      >
        <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : 'translate-x-1'}`}/>
      </button>
    </div>
  );

  return (
    <div className="min-h-screen pb-20 lg:pb-0 bg-slate-50 dark:bg-slate-900 transition-colors duration-300">
      {/* Header */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-4 sticky top-0 z-30 flex justify-between items-center shadow-sm transition-colors duration-300">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-lg">
            <i className="fas fa-clock text-white text-xl"></i>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-800 dark:text-white">Chronos <span className="text-indigo-600 dark:text-indigo-400">Ponto</span></h1>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors text-slate-500 dark:text-slate-400"
          >
            <i className="fas fa-cog text-lg"></i>
          </button>
          <div className="hidden md:block text-right">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{settings.userName}</p>
            <p className="text-xs text-slate-400 dark:text-slate-500">
               {profiles.length > 1 ? 'Múltiplos Perfis' : 'Ponto Digital'}
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Clock & Actions */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-xl overflow-hidden border border-slate-100 dark:border-slate-700 transition-colors duration-300">
            <div className="bg-indigo-600 dark:bg-indigo-700 px-8 py-10 text-white text-center transition-colors duration-300">
              <p className="text-indigo-100 uppercase tracking-widest text-xs font-semibold mb-2">
                {formatDate(currentTime.getTime())}
              </p>
              <h2 className="text-6xl font-light tabular-nums">
                {formatTime(currentTime).split(':')[0]}:<span className="font-bold">{formatTime(currentTime).split(':')[1]}</span>
              </h2>
              <p className="text-indigo-200 text-sm mt-2">Segundos: {formatTime(currentTime).split(':')[2]}</p>
            </div>
            
            <div className="p-8 grid grid-cols-2 gap-4">
              <PunchButton 
                onClick={() => handlePunch(PunchType.ENTRY)}
                label="Entrada"
                icon="fa-sign-in-alt"
                color="bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-900/30"
              />
              <PunchButton 
                onClick={() => handlePunch(PunchType.EXIT)}
                label="Saída"
                icon="fa-sign-out-alt"
                color="bg-rose-50 text-rose-600 hover:bg-rose-100 border-rose-100 dark:bg-rose-900/20 dark:text-rose-400 dark:border-rose-800 dark:hover:bg-rose-900/30"
              />
              <PunchButton 
                onClick={() => handlePunch(PunchType.BREAK_START)}
                label="Pausa"
                icon="fa-coffee"
                color="bg-amber-50 text-amber-600 hover:bg-amber-100 border-amber-100 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800 dark:hover:bg-amber-900/30"
              />
              <PunchButton 
                onClick={() => handlePunch(PunchType.BREAK_END)}
                label="Retorno"
                icon="fa-undo"
                color="bg-blue-50 text-blue-600 hover:bg-blue-100 border-blue-100 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800 dark:hover:bg-blue-900/30"
              />
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 shadow-lg border border-slate-100 dark:border-slate-700 transition-colors duration-300">
            <h3 className="text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider mb-4">Resumo de Hoje</h3>
            <div className="space-y-4">
              <StatRow label="Trabalhado" value={minutesToReadable(todayStats.total)} />
              <StatRow label="Pausas" value={minutesToReadable(todayStats.break)} />
              <StatRow 
                label="Saldo" 
                value={minutesToReadable(dailyBalance)} 
                color={dailyBalance >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}
              />
              <div className="pt-4 border-t border-slate-50 dark:border-slate-700">
                <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-2">
                  <div 
                    className="bg-indigo-600 dark:bg-indigo-500 h-2 rounded-full transition-all duration-1000" 
                    style={{ width: `${Math.min(100, (todayStats.total / settings.dailyWorkloadMinutes) * 100)}%` }}
                  ></div>
                </div>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-2 text-right">
                  Meta: {minutesToReadable(settings.dailyWorkloadMinutes)}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 shadow-lg border border-slate-100 dark:border-slate-700 transition-colors duration-300">
            <h3 className="text-indigo-500 dark:text-indigo-400 text-xs font-bold uppercase tracking-wider mb-4">Resumo Mensal ({currentTime.toLocaleDateString('pt-BR', {month: 'long'})})</h3>
            <div className="space-y-4">
              <StatRow label="Dias trabalhados" value={monthlyStats.daysWorkedCount.toString()} />
              <StatRow label="Total Horas" value={minutesToReadable(monthlyStats.totalWorked)} />
              <StatRow label="Total Pausas" value={minutesToReadable(monthlyStats.totalBreak)} />
              <StatRow 
                label="Saldo Geral" 
                value={minutesToReadable(monthlyStats.balance)} 
                color={monthlyStats.balance >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}
              />
            </div>
          </div>
        </div>

        {/* Right Column: History & Stats */}
        <div className="lg:col-span-8 space-y-6">
          
          {/* Chart Section */}
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 shadow-lg border border-slate-100 dark:border-slate-700 transition-colors duration-300">
             <h3 className="text-slate-800 dark:text-white font-bold mb-6 flex items-center gap-2">
               <i className="fas fa-chart-line text-indigo-500 dark:text-indigo-400"></i> Performance Semanal
             </h3>
             <div className="h-64 w-full">
               <ResponsiveContainer width="100%" height="100%">
                 <AreaChart data={getChartData()}>
                    <defs>
                      <linearGradient id="colorHours" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.1}/>
                        <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={settings.isDarkMode ? "#334155" : "#f1f5f9"} />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: settings.isDarkMode ? '#94a3b8' : '#94a3b8', fontSize: 12}} />
                    <YAxis axisLine={false} tickLine={false} tick={{fill: settings.isDarkMode ? '#94a3b8' : '#94a3b8', fontSize: 12}} />
                    <Tooltip 
                      contentStyle={{
                        borderRadius: '16px', 
                        border: 'none', 
                        boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                        backgroundColor: settings.isDarkMode ? '#1e293b' : '#fff',
                        color: settings.isDarkMode ? '#fff' : '#000'
                      }}
                    />
                    <Area type="monotone" dataKey="horas" stroke="#4f46e5" fillOpacity={1} fill="url(#colorHours)" strokeWidth={3} />
                    <Area type="monotone" dataKey="meta" stroke="#cbd5e1" fill="transparent" strokeWidth={1} strokeDasharray="5 5" />
                 </AreaChart>
               </ResponsiveContainer>
             </div>
          </div>

          {/* AI Insights Section */}
          <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-3xl p-6 border border-indigo-100 dark:border-indigo-800 relative overflow-hidden transition-colors duration-300">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <i className="fas fa-robot text-8xl text-indigo-900 dark:text-indigo-400"></i>
            </div>
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-indigo-900 dark:text-indigo-100 font-bold flex items-center gap-2">
                  <i className="fas fa-magic"></i> Insight Inteligente (Gemini)
                </h3>
                <button 
                  onClick={generateAIReview}
                  disabled={isLoadingAI}
                  className="bg-indigo-600 dark:bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-indigo-700 dark:hover:bg-indigo-500 transition-colors disabled:opacity-50"
                >
                  {isLoadingAI ? 'Analisando...' : 'Gerar Análise'}
                </button>
              </div>
              {aiReview ? (
                <div className="bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm p-4 rounded-2xl text-slate-700 dark:text-slate-200 text-sm leading-relaxed border border-white/40 dark:border-slate-700">
                  {aiReview.split('\n').map((line, i) => <p key={i} className="mb-2">{line}</p>)}
                </div>
              ) : (
                <p className="text-indigo-600/70 dark:text-indigo-300/70 text-sm italic">Clique em "Gerar Análise" para receber dicas baseadas no seu histórico.</p>
              )}
            </div>
          </div>

          {/* History List */}
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-lg border border-slate-100 dark:border-slate-700 overflow-hidden transition-colors duration-300">
            <div className="px-6 py-4 border-b border-slate-50 dark:border-slate-700 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/50">
              <h3 className="text-slate-800 dark:text-white font-bold">Histórico Recente</h3>
              <div className="flex gap-2 sm:gap-4">
                 <button 
                  onClick={() => setIsManualEntryOpen(true)}
                  className="text-xs text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 font-medium transition-colors flex items-center gap-1 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-1 rounded"
                >
                  <i className="fas fa-plus-circle"></i> Add
                </button>
                <button 
                  onClick={() => exportToCSV(records)}
                  className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium transition-colors flex items-center gap-1 bg-indigo-50 dark:bg-indigo-900/30 px-2 py-1 rounded"
                >
                  <i className="fas fa-file-csv"></i> CSV
                </button>
                <button 
                  onClick={() => exportToPDF(records, settings)}
                  className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium transition-colors flex items-center gap-1 bg-indigo-50 dark:bg-indigo-900/30 px-2 py-1 rounded"
                >
                  <i className="fas fa-file-pdf"></i> PDF
                </button>
                <button 
                  onClick={clearHistory}
                  className="text-xs text-rose-500 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 font-medium transition-colors flex items-center gap-1 bg-rose-50 dark:bg-rose-900/30 px-2 py-1 rounded"
                >
                  <i className="fas fa-trash"></i> Limpar
                </button>
              </div>
            </div>
            <div className="max-h-[400px] overflow-y-auto divide-y divide-slate-50 dark:divide-slate-700">
              {records.length === 0 ? (
                <div className="p-12 text-center">
                  <i className="fas fa-folder-open text-slate-200 dark:text-slate-600 text-4xl mb-4"></i>
                  <p className="text-slate-400 dark:text-slate-500">Nenhum registro encontrado.</p>
                </div>
              ) : (
                records.map(record => (
                  <div key={record.id} className="px-6 py-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${getPunchStyle(record.type, settings.isDarkMode)}`}>
                        <i className={`fas ${getPunchIcon(record.type)}`}></i>
                      </div>
                      <div>
                        <p className="font-semibold text-slate-700 dark:text-slate-200">{record.type}</p>
                        <p className="text-xs text-slate-400 dark:text-slate-500">{formatDate(record.timestamp)}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-slate-800 dark:text-white">{formatTime(new Date(record.timestamp))}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Manual Entry Modal */}
      {isManualEntryOpen && (
        <div className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
           <div className="bg-white dark:bg-slate-800 rounded-[32px] w-full max-w-sm shadow-2xl p-8 transform animate-in fade-in zoom-in duration-300">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-slate-800 dark:text-white">Registro Manual</h2>
                <button onClick={() => setIsManualEntryOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                  <i className="fas fa-times text-xl"></i>
                </button>
              </div>

              <div className="space-y-4">
                 <div>
                    <label className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1">Data</label>
                    <input 
                      type="date"
                      value={manualDate}
                      onChange={(e) => setManualDate(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm dark:text-white dark:[color-scheme:dark]"
                    />
                 </div>
                 <div>
                    <label className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1">Hora</label>
                    <input 
                      type="time"
                      value={manualTime}
                      onChange={(e) => setManualTime(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm dark:text-white dark:[color-scheme:dark]"
                    />
                 </div>
                 <div>
                    <label className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1">Tipo de Ponto</label>
                    <select
                      value={manualType}
                      onChange={(e) => setManualType(e.target.value as PunchType)}
                      className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm dark:text-white"
                    >
                      <option value={PunchType.ENTRY}>Entrada</option>
                      <option value={PunchType.BREAK_START}>Início Pausa</option>
                      <option value={PunchType.BREAK_END}>Fim Pausa</option>
                      <option value={PunchType.EXIT}>Saída</option>
                    </select>
                 </div>
                 <button 
                  onClick={handleManualEntry}
                  className="w-full bg-emerald-600 text-white font-bold py-3 rounded-2xl hover:bg-emerald-700 transition-all mt-4"
                >
                  Adicionar Registro
                </button>
              </div>
           </div>
        </div>
      )}

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-800 rounded-[32px] w-full max-w-lg shadow-2xl p-8 transform animate-in fade-in zoom-in duration-300 my-8">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Configurações</h2>
              <button onClick={() => setIsSettingsOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                <i className="fas fa-times text-xl"></i>
              </button>
            </div>
            
            <div className="space-y-6">
              
              {/* Profile Management Section */}
              <div className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-2xl border border-indigo-100 dark:border-indigo-800 mb-4">
                 <h3 className="text-sm font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-wider mb-3">Gerenciar Perfis</h3>
                 
                 {!isCreatingProfile ? (
                   <div className="space-y-3">
                     <div>
                       <label className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1">Perfil Ativo</label>
                       <select 
                         value={currentUserId}
                         onChange={(e) => setCurrentUserId(e.target.value)}
                         className="w-full bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                       >
                         {profiles.map(p => (
                           <option key={p.id} value={p.id}>{p.name}</option>
                         ))}
                       </select>
                     </div>
                     <button 
                       onClick={() => setIsCreatingProfile(true)}
                       className="text-sm text-indigo-600 dark:text-indigo-400 font-semibold hover:underline flex items-center gap-1"
                     >
                       <i className="fas fa-user-plus"></i> Criar Novo Perfil
                     </button>
                   </div>
                 ) : (
                   <div className="animate-in fade-in slide-in-from-top-1">
                      <label className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1">Nome do Novo Perfil</label>
                      <div className="flex gap-2">
                        <input 
                          type="text"
                          value={newProfileName}
                          onChange={(e) => setNewProfileName(e.target.value)}
                          placeholder="Ex: João Silva"
                          className="flex-1 bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                        />
                        <button 
                          onClick={handleCreateProfile}
                          className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-indigo-700"
                        >
                          Criar
                        </button>
                        <button 
                          onClick={() => setIsCreatingProfile(false)}
                          className="bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-4 py-2 rounded-xl text-sm font-bold hover:bg-slate-300 dark:hover:bg-slate-600"
                        >
                          Cancelar
                        </button>
                      </div>
                   </div>
                 )}
              </div>

              {/* Personal Info */}
              <div className="space-y-4">
                 <h3 className="text-sm font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider border-b border-indigo-100 dark:border-slate-700 pb-2">Dados do Colaborador</h3>
                 <div>
                    <label className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1">Seu Nome</label>
                    <input 
                      type="text"
                      value={settings.userName}
                      onChange={(e) => setSettings({...settings, userName: e.target.value})}
                      className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                      placeholder="Nome completo"
                    />
                 </div>
                 <div>
                    <label className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1">Função</label>
                    <input 
                      type="text"
                      value={settings.role}
                      onChange={(e) => setSettings({...settings, role: e.target.value})}
                      className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                      placeholder="Ex: Desenvolvedor, Analista..."
                    />
                 </div>
                 <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1">CTPS</label>
                        <input 
                          type="text"
                          value={settings.ctps}
                          onChange={(e) => setSettings({...settings, ctps: e.target.value})}
                          className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                          placeholder="Nº e Série"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1">Data de Admissão</label>
                        <input 
                          type="date"
                          value={settings.admissionDate}
                          onChange={(e) => setSettings({...settings, admissionDate: e.target.value})}
                          className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white dark:[color-scheme:dark]"
                        />
                    </div>
                 </div>
              </div>

              {/* Company Info */}
              <div className="space-y-4">
                 <h3 className="text-sm font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider border-b border-indigo-100 dark:border-slate-700 pb-2">Dados da Empresa</h3>
                 <div>
                    <label className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1">Nome da Empresa</label>
                    <input 
                      type="text"
                      value={settings.companyName}
                      onChange={(e) => setSettings({...settings, companyName: e.target.value})}
                      className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                      placeholder="Razão Social"
                    />
                 </div>
                 <div>
                    <label className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1">CNPJ</label>
                    <input 
                      type="text"
                      value={settings.cnpj}
                      onChange={(e) => setSettings({...settings, cnpj: e.target.value})}
                      className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                      placeholder="00.000.000/0000-00"
                    />
                 </div>
                 <div>
                    <label className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1">Endereço Completo</label>
                    <input 
                      type="text"
                      value={settings.address}
                      onChange={(e) => setSettings({...settings, address: e.target.value})}
                      className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                      placeholder="Rua, Número, Bairro, Cidade - UF"
                    />
                 </div>
              </div>
              
              {/* Work Details */}
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider border-b border-indigo-100 dark:border-slate-700 pb-2">Jornada e Exportação</h3>
                
                <div>
                  <label className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-2">Carga Horária Diária</label>
                  <div className="flex gap-4">
                    <div className="flex-1">
                       <div className="flex gap-2">
                        <input 
                          type="number"
                          min="0"
                          max="23"
                          value={Math.floor(settings.dailyWorkloadMinutes / 60)}
                          onChange={(e) => {
                            const h = Math.max(0, parseInt(e.target.value) || 0);
                            const m = settings.dailyWorkloadMinutes % 60;
                            setSettings({...settings, dailyWorkloadMinutes: h * 60 + m});
                          }}
                          className="flex-1 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-2xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all dark:text-white"
                        />
                        <div className="bg-slate-100 dark:bg-slate-600 flex items-center px-4 rounded-2xl text-slate-500 dark:text-slate-300 font-medium">h</div>
                       </div>
                    </div>
                    <div className="flex-1">
                       <div className="flex gap-2">
                        <input 
                          type="number"
                          min="0"
                          max="59"
                          value={settings.dailyWorkloadMinutes % 60}
                          onChange={(e) => {
                            const h = Math.floor(settings.dailyWorkloadMinutes / 60);
                            const m = Math.min(59, Math.max(0, parseInt(e.target.value) || 0));
                            setSettings({...settings, dailyWorkloadMinutes: h * 60 + m});
                          }}
                          className="flex-1 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-2xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all dark:text-white"
                        />
                        <div className="bg-slate-100 dark:bg-slate-600 flex items-center px-4 rounded-2xl text-slate-500 dark:text-slate-300 font-medium">min</div>
                       </div>
                    </div>
                  </div>
                </div>

                <div>
                    <label className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1">Dia de Descanso Semanal</label>
                    <select 
                      value={settings.weeklyRestDay}
                      onChange={(e) => setSettings({...settings, weeklyRestDay: e.target.value})}
                      className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm dark:text-white"
                    >
                      <option value="Domingo">Domingo</option>
                      <option value="Segunda-feira">Segunda-feira</option>
                      <option value="Terça-feira">Terça-feira</option>
                      <option value="Quarta-feira">Quarta-feira</option>
                      <option value="Quinta-feira">Quinta-feira</option>
                      <option value="Sexta-feira">Sexta-feira</option>
                      <option value="Sábado">Sábado</option>
                      <option value="Sábado e Domingo">Sábado e Domingo</option>
                      <option value="Escala de Revezamento">Escala de Revezamento</option>
                    </select>
                 </div>

                 {/* PDF Export Options */}
                 <div>
                   <label className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-2">Personalização do PDF</label>
                   <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-3 border border-slate-200 dark:border-slate-600">
                     <PDFToggle 
                       label="Dados da Empresa" 
                       checked={settings.pdfSettings.showCompanyInfo}
                       onChange={(v) => setSettings({...settings, pdfSettings: {...settings.pdfSettings, showCompanyInfo: v}})}
                     />
                     <PDFToggle 
                       label="Dados do Funcionário" 
                       checked={settings.pdfSettings.showEmployeeInfo}
                       onChange={(v) => setSettings({...settings, pdfSettings: {...settings.pdfSettings, showEmployeeInfo: v}})}
                     />
                     <PDFToggle 
                       label="Detalhes (Mês/Ano/Descanso)" 
                       checked={settings.pdfSettings.showPeriodDetails}
                       onChange={(v) => setSettings({...settings, pdfSettings: {...settings.pdfSettings, showPeriodDetails: v}})}
                     />
                     <PDFToggle 
                       label="Resumo Geral (Cálculos)" 
                       checked={settings.pdfSettings.showSummary}
                       onChange={(v) => setSettings({...settings, pdfSettings: {...settings.pdfSettings, showSummary: v}})}
                     />
                     <PDFToggle 
                       label="Campo para Assinatura" 
                       checked={settings.pdfSettings.showSignatures}
                       onChange={(v) => setSettings({...settings, pdfSettings: {...settings.pdfSettings, showSignatures: v}})}
                     />
                   </div>
                 </div>

                <div className="border-t border-slate-100 dark:border-slate-700 pt-4">
                  {/* Modo Escuro Toggle */}
                  <div className="flex items-center justify-between mb-4">
                    <label className="text-sm font-semibold text-slate-600 dark:text-slate-300">Modo Escuro</label>
                    <button 
                      onClick={() => setSettings({...settings, isDarkMode: !settings.isDarkMode})}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${settings.isDarkMode ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-600'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.isDarkMode ? 'translate-x-6' : 'translate-x-1'}`}/>
                    </button>
                  </div>

                  <div className="flex items-center justify-between mb-4">
                    <label className="text-sm font-semibold text-slate-600 dark:text-slate-300">Notificações e Horário Fixo</label>
                    <button 
                      onClick={() => {
                         if (!settings.schedule.enabled) requestNotificationPermission();
                         setSettings({
                           ...settings,
                           schedule: { ...settings.schedule, enabled: !settings.schedule.enabled }
                         });
                      }}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${settings.schedule.enabled ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-600'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.schedule.enabled ? 'translate-x-6' : 'translate-x-1'}`}/>
                    </button>
                  </div>

                  {settings.schedule.enabled && (
                    <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2">
                      <div>
                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Entrada</label>
                        <input 
                          type="time" 
                          value={settings.schedule.start}
                          onChange={(e) => setSettings({...settings, schedule: {...settings.schedule, start: e.target.value}})}
                          className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm dark:text-white dark:[color-scheme:dark]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Saída</label>
                        <input 
                          type="time" 
                          value={settings.schedule.end}
                          onChange={(e) => setSettings({...settings, schedule: {...settings.schedule, end: e.target.value}})}
                          className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm dark:text-white dark:[color-scheme:dark]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Início Pausa</label>
                        <input 
                          type="time" 
                          value={settings.schedule.breakStart}
                          onChange={(e) => setSettings({...settings, schedule: {...settings.schedule, breakStart: e.target.value}})}
                          className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm dark:text-white dark:[color-scheme:dark]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Fim Pausa</label>
                        <input 
                          type="time" 
                          value={settings.schedule.breakEnd}
                          onChange={(e) => setSettings({...settings, schedule: {...settings.schedule, breakEnd: e.target.value}})}
                          className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm dark:text-white dark:[color-scheme:dark]"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
              
              <button 
                onClick={() => setIsSettingsOpen(false)}
                className="w-full bg-indigo-600 text-white font-bold py-4 rounded-2xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 dark:shadow-none"
              >
                Salvar Configurações
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Sticky Bar */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 px-6 py-4 flex justify-between items-center z-40">
        <button onClick={() => handlePunch(PunchType.ENTRY)} className="flex flex-col items-center gap-1 text-emerald-600 dark:text-emerald-400">
          <i className="fas fa-sign-in-alt"></i>
          <span className="text-[10px] font-bold">ENTRADA</span>
        </button>
        <button onClick={() => handlePunch(PunchType.BREAK_START)} className="flex flex-col items-center gap-1 text-amber-600 dark:text-amber-400">
          <i className="fas fa-coffee"></i>
          <span className="text-[10px] font-bold">PAUSA</span>
        </button>
        <button onClick={() => handlePunch(PunchType.EXIT)} className="flex flex-col items-center gap-1 text-rose-600 dark:text-rose-400">
          <i className="fas fa-sign-out-alt"></i>
          <span className="text-[10px] font-bold">SAÍDA</span>
        </button>
        <button onClick={() => setIsSettingsOpen(true)} className="flex flex-col items-center gap-1 text-slate-400 dark:text-slate-500">
          <i className="fas fa-cog"></i>
          <span className="text-[10px] font-bold">MENU</span>
        </button>
      </div>
    </div>
  );
};

// Sub-components
const PunchButton: React.FC<{onClick: () => void, label: string, icon: string, color: string}> = ({onClick, label, icon, color}) => (
  <button 
    onClick={onClick}
    className={`${color} flex flex-col items-center justify-center p-4 rounded-2xl border transition-all duration-200 active:scale-95 group`}
  >
    <i className={`fas ${icon} text-xl mb-2 transition-transform group-hover:scale-110`}></i>
    <span className="text-xs font-bold uppercase tracking-tighter">{label}</span>
  </button>
);

const StatRow: React.FC<{label: string, value: string, color?: string}> = ({label, value, color}) => (
  <div className="flex justify-between items-center">
    <span className="text-sm text-slate-500 dark:text-slate-400 font-medium">{label}</span>
    <span className={`text-sm font-bold ${color || 'text-slate-800 dark:text-slate-200'}`}>{value}</span>
  </div>
);

const getPunchStyle = (type: PunchType, isDark: boolean = false) => {
  if (isDark) {
    switch (type) {
      case PunchType.ENTRY: return 'bg-emerald-900/30 text-emerald-400';
      case PunchType.EXIT: return 'bg-rose-900/30 text-rose-400';
      case PunchType.BREAK_START: return 'bg-amber-900/30 text-amber-400';
      case PunchType.BREAK_END: return 'bg-blue-900/30 text-blue-400';
    }
  }
  switch (type) {
    case PunchType.ENTRY: return 'bg-emerald-100 text-emerald-600';
    case PunchType.EXIT: return 'bg-rose-100 text-rose-600';
    case PunchType.BREAK_START: return 'bg-amber-100 text-amber-600';
    case PunchType.BREAK_END: return 'bg-blue-100 text-blue-600';
  }
};

const getPunchIcon = (type: PunchType) => {
  switch (type) {
    case PunchType.ENTRY: return 'fa-sign-in-alt';
    case PunchType.EXIT: return 'fa-sign-out-alt';
    case PunchType.BREAK_START: return 'fa-mug-hot';
    case PunchType.BREAK_END: return 'fa-play';
  }
};

export default App;
