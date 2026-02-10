
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { PunchRecord, PunchType, UserSettings } from "../types";

export const formatTime = (date: Date): string => {
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

export const formatDate = (timestamp: number): string => {
  return new Date(timestamp).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
};

export const minutesToReadable = (totalMinutes: number): string => {
  const hours = Math.floor(Math.abs(totalMinutes) / 60);
  const minutes = Math.floor(Math.abs(totalMinutes) % 60);
  const sign = totalMinutes < 0 ? '-' : '';
  return `${sign}${hours}h ${minutes}m`;
};

export const calculateDailyHours = (records: any[]) => {
  if (records.length === 0) return { total: 0, break: 0 };
  
  let totalMinutes = 0;
  let breakMinutes = 0;
  let entryTime: number | null = null;
  let breakStartTime: number | null = null;

  records.sort((a, b) => a.timestamp - b.timestamp).forEach(record => {
    switch (record.type) {
      case 'ENTRADA':
        entryTime = record.timestamp;
        break;
      case 'INÍCIO PAUSA':
        breakStartTime = record.timestamp;
        if (entryTime) {
          totalMinutes += (record.timestamp - entryTime) / 60000;
          entryTime = null;
        }
        break;
      case 'FIM PAUSA':
        if (breakStartTime) {
          breakMinutes += (record.timestamp - breakStartTime) / 60000;
          breakStartTime = null;
        }
        entryTime = record.timestamp;
        break;
      case 'SAÍDA':
        if (entryTime) {
          totalMinutes += (record.timestamp - entryTime) / 60000;
          entryTime = null;
        }
        break;
    }
  });

  return { total: totalMinutes, break: breakMinutes };
};

export const calculateMonthlyStats = (records: PunchRecord[], currentMonthDate: Date, dailyWorkload: number) => {
  const targetMonth = currentMonthDate.getMonth();
  const targetYear = currentMonthDate.getFullYear();

  // Filter for current month
  const monthRecords = records.filter(r => {
      const d = new Date(r.timestamp);
      return d.getMonth() === targetMonth && d.getFullYear() === targetYear;
  });

  // Group by day to calculate daily hours correctly
  const days: {[key: string]: PunchRecord[]} = {};
  monthRecords.forEach(r => {
      const dayKey = new Date(r.timestamp).toLocaleDateString();
      if (!days[dayKey]) days[dayKey] = [];
      days[dayKey].push(r);
  });

  let totalWorked = 0;
  let totalBreak = 0;
  let daysWorkedCount = 0;

  Object.values(days).forEach(dayRecords => {
      const stats = calculateDailyHours(dayRecords);
      totalWorked += stats.total;
      totalBreak += stats.break;
      // Count day as worked if there is any worked time
      if (stats.total > 0) daysWorkedCount++;
  });

  // Balance calculation: Total Worked - (Days Worked * Daily Goal)
  const balance = totalWorked - (daysWorkedCount * dailyWorkload);

  return { totalWorked, totalBreak, balance, daysWorkedCount };
};

// Helper para agrupar registros por dia para CSV e PDF
const groupRecordsByDay = (records: PunchRecord[], targetMonth: number, targetYear: number) => {
  const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const groupedData = [];

  for (let i = 1; i <= daysInMonth; i++) {
    const dayDate = new Date(targetYear, targetMonth, i);
    
    // Filtrar registros do dia
    const dayRecords = records.filter(r => {
      const d = new Date(r.timestamp);
      return d.getDate() === i && d.getMonth() === targetMonth && d.getFullYear() === targetYear;
    });
    dayRecords.sort((a, b) => a.timestamp - b.timestamp);

    // Encontrar batidas
    const entrada = dayRecords.find(r => r.type === PunchType.ENTRY);
    const almocoSaida = dayRecords.find(r => r.type === PunchType.BREAK_START);
    const almocoVolta = dayRecords.find(r => r.type === PunchType.BREAK_END);
    const saida = dayRecords.find(r => r.type === PunchType.EXIT);
    
    // Calcular total do dia
    const stats = calculateDailyHours(dayRecords);

    groupedData.push({
      day: i.toString().padStart(2, '0'),
      dateFull: dayDate.toLocaleDateString('pt-BR'),
      entrada: entrada ? new Date(entrada.timestamp).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'}) : '',
      almocoSaida: almocoSaida ? new Date(almocoSaida.timestamp).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'}) : '',
      almocoVolta: almocoVolta ? new Date(almocoVolta.timestamp).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'}) : '',
      saida: saida ? new Date(saida.timestamp).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'}) : '',
      totalHoras: minutesToReadable(stats.total)
    });
  }
  return groupedData;
};

export const exportToCSV = (records: any[]) => {
  if (records.length === 0) {
    alert("Sem registros para exportar.");
    return;
  }

  // Determinar o mês/ano baseados no último registro ou data atual
  const lastRecordDate = records.length > 0 ? new Date(records[0].timestamp) : new Date();
  const groupedData = groupRecordsByDay(records, lastRecordDate.getMonth(), lastRecordDate.getFullYear());

  const headers = ['Data', 'Entrada', 'Saída Almoço', 'Volta Almoço', 'Saída', 'Total Horas'];
  const csvContent = [
    headers.join(','),
    ...groupedData.map((d: any) => {
      // Filtrar apenas linhas que tem algum registro ou retornar todas? 
      // O padrão CSV geralmente espera dados brutos, mas o pedido foi "modelo da imagem", então vamos retornar todos os dias do mês ou só os trabalhados.
      // Vamos retornar apenas dias com dados para não ficar um CSV gigante vazio se for o caso, ou manter fiel ao espelho.
      // Para CSV, melhor retornar tudo para conferência.
      return `${d.dateFull},${d.entrada},${d.almocoSaida},${d.almocoVolta},${d.saida},${d.totalHoras}`;
    })
  ].join('\n');

  const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `folha_ponto_${lastRecordDate.toISOString().split('T')[0].slice(0, 7)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const exportToPDF = (records: PunchRecord[], settings: UserSettings) => {
  const doc = new jsPDF();
  
  // Configuração global
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  const pageWidth = doc.internal.pageSize.getWidth(); // ~210mm
  const pageHeight = doc.internal.pageSize.getHeight(); // ~297mm
  const margin = 10;
  const contentWidth = pageWidth - (margin * 2);
  
  let currentY = 15;

  // --- TÍTULO ---
  doc.text("FOLHA DE PONTO INDIVIDUAL DE TRABALHO", pageWidth / 2, currentY, { align: "center" });
  currentY += 5;

  // --- CABEÇALHO (GRID) ---
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  const rowHeight = 7;

  // Format Admission Date
  let admissionDateFormatted = "";
  if (settings.admissionDate) {
    const [year, month, day] = settings.admissionDate.split('-');
    if (year && month && day) {
      admissionDateFormatted = `${day}/${month}/${year}`;
    } else {
      admissionDateFormatted = settings.admissionDate;
    }
  }

  // Linha 1: Empregador (Esq) | CEI/CNPJ (Dir)
  // CNPJ ocupa aprox 1/3 do final
  const cnpjWidth = 60;
  const empNameWidth = contentWidth - cnpjWidth;
  
  doc.rect(margin, currentY, empNameWidth, rowHeight);
  doc.text(`EMPREGADOR: ${settings.companyName.toUpperCase()}`, margin + 2, currentY + 5);
  
  doc.rect(margin + empNameWidth, currentY, cnpjWidth, rowHeight);
  doc.text(`CEI / CNPJ Nº: ${settings.cnpj}`, margin + empNameWidth + 2, currentY + 5);
  
  currentY += rowHeight;

  // Linha 2: Endereço (Full)
  doc.rect(margin, currentY, contentWidth, rowHeight);
  doc.text(`ENDEREÇO: ${settings.address.toUpperCase()}`, margin + 2, currentY + 5);
  
  currentY += rowHeight;

  // Linha 3: Empregado (Esq) | CTPS (Meio) | Admissão (Dir)
  const admWidth = 45;
  const ctpsWidth = 50;
  const nameWidth = contentWidth - admWidth - ctpsWidth;

  doc.rect(margin, currentY, nameWidth, rowHeight);
  doc.text(`EMPREGADO(A): ${settings.userName.toUpperCase()}`, margin + 2, currentY + 5);

  doc.rect(margin + nameWidth, currentY, ctpsWidth, rowHeight);
  doc.text(`CTPS Nº E SÉRIE: ${settings.ctps}`, margin + nameWidth + 2, currentY + 5);

  doc.rect(margin + nameWidth + ctpsWidth, currentY, admWidth, rowHeight);
  doc.text(`DATA DE ADMISSÃO: ${admissionDateFormatted}`, margin + nameWidth + ctpsWidth + 2, currentY + 5);

  currentY += rowHeight;

  // Linha 4: Função | Horário de Trabalho
  const funcWidth = 80;
  const hoursWidth = contentWidth - funcWidth;

  doc.rect(margin, currentY, funcWidth, rowHeight);
  doc.text(`FUNÇÃO: ${settings.role ? settings.role.toUpperCase() : ''}`, margin + 2, currentY + 5);

  const workHours = settings.schedule.enabled 
    ? `${settings.schedule.start} às ${settings.schedule.end}`
    : "";
  doc.rect(margin + funcWidth, currentY, hoursWidth, rowHeight);
  doc.text(`HORÁRIO DE TRABALHO DE SEG. A SEXTA FEIRA: ${workHours}`, margin + funcWidth + 2, currentY + 5);

  currentY += rowHeight;

  // Linha 5: Horário Sábados | Descanso Semanal | Mês | Ano
  // 4 colunas
  const colW = contentWidth / 4;
  
  // Data de Referência (Mês/Ano)
  const lastRecordDate = records.length > 0 ? new Date(records[0].timestamp) : new Date();
  const monthStr = lastRecordDate.toLocaleDateString('pt-BR', { month: 'long' }).toUpperCase();
  const yearStr = lastRecordDate.getFullYear().toString();

  doc.rect(margin, currentY, colW, rowHeight);
  doc.text(`HORÁRIO AOS SÁBADOS:`, margin + 2, currentY + 5);
  
  doc.rect(margin + colW, currentY, colW, rowHeight);
  doc.text(`DESCANSO SEMANAL: ${settings.weeklyRestDay.toUpperCase()}`, margin + colW + 2, currentY + 5);

  doc.rect(margin + colW * 2, currentY, colW, rowHeight);
  doc.text(`MÊS: ${monthStr}`, margin + colW * 2 + 2, currentY + 5);

  doc.rect(margin + colW * 3, currentY, colW, rowHeight);
  doc.text(`ANO: ${yearStr}`, margin + colW * 3 + 2, currentY + 5);

  currentY += rowHeight + 2; // Pequeno espaço antes da tabela

  // --- TABELA DE PONTOS ---
  
  const groupedData = groupRecordsByDay(records, lastRecordDate.getMonth(), lastRecordDate.getFullYear());

  const tableBody = groupedData.map(d => [
    d.day,
    d.entrada,
    d.almocoSaida,
    d.almocoVolta,
    d.saida,
    '', // Extras Entrada (Manual)
    '', // Extras Saída (Manual)
    ''  // Assinatura
  ]);

  autoTable(doc, {
    startY: currentY,
    head: [
      [
        { content: 'DIAS\nMÊS', rowSpan: 2, styles: { valign: 'middle', halign: 'center' } },
        { content: 'ENTRADA\nMANHÃ', rowSpan: 2, styles: { valign: 'middle', halign: 'center' } },
        { content: 'ALMOÇO', colSpan: 2, styles: { halign: 'center', valign: 'middle' } },
        { content: 'SAÍDA\nTARDE', rowSpan: 2, styles: { valign: 'middle', halign: 'center' } },
        { content: 'EXTRAS', colSpan: 2, styles: { halign: 'center', valign: 'middle' } },
        { content: 'ASSINATURA', rowSpan: 2, styles: { valign: 'middle', halign: 'center' } }
      ],
      [
        { content: 'SAÍDA', styles: { halign: 'center' } },
        { content: 'RETORNO', styles: { halign: 'center' } },
        { content: 'ENTRADA', styles: { halign: 'center' } },
        { content: 'SAÍDA', styles: { halign: 'center' } }
      ]
    ],
    body: tableBody,
    theme: 'plain',
    styles: {
      fontSize: 8,
      cellPadding: 1,
      lineColor: [0, 0, 0],
      lineWidth: 0.1,
      textColor: [0, 0, 0],
      minCellHeight: 6
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      lineWidth: 0.1,
      lineColor: [0, 0, 0]
    },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center', fontStyle: 'bold' }, // Dias
      1: { cellWidth: 20, halign: 'center' }, // Entrada
      2: { cellWidth: 20, halign: 'center' }, // Saída Almoço
      3: { cellWidth: 20, halign: 'center' }, // Retorno Almoço
      4: { cellWidth: 20, halign: 'center' }, // Saída
      5: { cellWidth: 20, halign: 'center' }, // Extra 1
      6: { cellWidth: 20, halign: 'center' }, // Extra 2
      7: { cellWidth: 'auto' } // Assinatura
    },
    margin: { left: margin, right: margin }
  });

  // --- RODAPÉ ---
  const finalY = (doc as any).lastAutoTable.finalY;
  
  // Se não couber na página, adiciona nova página
  if (finalY > pageHeight - 50) {
    doc.addPage();
    currentY = 20;
  } else {
    currentY = finalY; // Remove o gap, junta as tabelas como na imagem
  }

  // A imagem mostra o rodapé "colado" na tabela, vamos desenhar manualmente as linhas para parecer uma continuação
  
  const footerRowHeight = 5;
  const leftBoxWidth = 110; // Largura do resumo
  const rightBoxWidth = contentWidth - leftBoxWidth; // Largura do visto

  // Título do Rodapé
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  
  // Caixa Esquerda (Resumo)
  // Cabeçalho Resumo
  doc.rect(margin, currentY, leftBoxWidth, footerRowHeight);
  doc.text("RESUMO GERAL", margin + (leftBoxWidth/2), currentY + 3.5, { align: "center" });
  
  // Caixa Direita (Visto)
  // Cabeçalho Visto
  doc.rect(margin + leftBoxWidth, currentY, rightBoxWidth, footerRowHeight);
  doc.text("VISTO DA FISCALIZAÇÃO", margin + leftBoxWidth + (rightBoxWidth/2), currentY + 3.5, { align: "center" });

  currentY += footerRowHeight;
  
  // Linhas do Resumo
  const rows = [
    { sign: "+", label: "Dias / Horas Normais", currency: "R$" },
    { sign: "+", label: "H. Extras / Adicionais (Verso)", currency: "R$" },
    { sign: "(-)", label: "Faltas no Mês", currency: "R$" },
    { sign: "=", label: "Sub-Total / Base de Cálculo", currency: "R$" },
    { sign: "(-)", label: "% INSS", currency: "R$" },
    { sign: "(-)", label: "Outros Descontos (Verso)", currency: "R$" },
    { sign: "+", label: "Salário Família", currency: "R$" },
    { sign: "", label: "Total Líquido a Receber", currency: "R$" } // Última linha
  ];

  const summaryHeight = rows.length * footerRowHeight;
  
  // Desenhar bordas externas das caixas de conteúdo
  doc.rect(margin, currentY, leftBoxWidth, summaryHeight); // Caixa conteúdo resumo
  doc.rect(margin + leftBoxWidth, currentY, rightBoxWidth, summaryHeight); // Caixa conteúdo visto (vazia)

  // Preencher linhas do resumo
  doc.setFont("helvetica", "normal");
  rows.forEach((row, i) => {
    const y = currentY + (i * footerRowHeight);
    
    // Coluna Símbolo (largura 8)
    doc.rect(margin, y, 8, footerRowHeight);
    doc.text(row.sign, margin + 4, y + 3.5, { align: 'center' });

    // Coluna Texto
    doc.rect(margin + 8, y, leftBoxWidth - 28, footerRowHeight); // 110 - 8 - 20
    doc.text(row.label, margin + 10, y + 3.5);

    // Coluna Moeda (largura 20)
    doc.rect(margin + leftBoxWidth - 20, y, 20, footerRowHeight);
    doc.text(row.currency, margin + leftBoxWidth - 18, y + 3.5);
  });

  // Salvar
  const fileName = `folha_ponto_${monthStr.toLowerCase().replace('ç','c')}_${yearStr}.pdf`;
  doc.save(fileName);
};
