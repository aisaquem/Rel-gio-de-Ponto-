
import { GoogleGenAI } from "@google/genai";
import { PunchRecord } from "../types";

export const getAIReview = async (records: PunchRecord[], workload: number) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const recordsSummary = records.map(r => 
    `${new Date(r.timestamp).toLocaleString('pt-BR')}: ${r.type}`
  ).join('\n');

  const prompt = `
    Analise os seguintes registros de ponto eletrônico de um colaborador.
    Carga horária diária esperada: ${workload} minutos.
    
    Registros:
    ${recordsSummary}
    
    Por favor, forneça um breve resumo (máximo 3 parágrafos) em português:
    1. Total de horas trabalhadas no período.
    2. Se houve atrasos ou horas extras significativas.
    3. Sugestões de melhoria no padrão de pausas ou horários.
    Mantenha um tom profissional e motivacional.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    return response.text;
  } catch (error) {
    console.error("Erro na análise Gemini:", error);
    return "Não foi possível gerar a análise inteligente no momento.";
  }
};
