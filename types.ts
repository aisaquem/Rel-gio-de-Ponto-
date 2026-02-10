
export enum PunchType {
  ENTRY = 'ENTRADA',
  BREAK_START = 'INÍCIO PAUSA',
  BREAK_END = 'FIM PAUSA',
  EXIT = 'SAÍDA'
}

export interface PunchRecord {
  id: string;
  timestamp: number;
  type: PunchType;
  note?: string;
}

export interface DailyStats {
  date: string;
  totalMinutes: number;
  breakMinutes: number;
  expectedMinutes: number;
}

export interface UserSchedule {
  start: string;
  breakStart: string;
  breakEnd: string;
  end: string;
  enabled: boolean;
}

export interface PDFSettings {
  showCompanyInfo: boolean;
  showEmployeeInfo: boolean;
  showPeriodDetails: boolean;
  showSummary: boolean;
  showSignatures: boolean;
}

export interface UserSettings {
  dailyWorkloadMinutes: number;
  userName: string;
  // Novos campos para o relatório e UI
  role: string; // Função
  companyName: string;
  cnpj: string;
  address: string;
  ctps: string;
  admissionDate: string;
  weeklyRestDay: string;
  isDarkMode: boolean; // Modo Escuro
  schedule: UserSchedule;
  pdfSettings: PDFSettings;
}
