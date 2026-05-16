import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function analyzeHeaders(headers: string[], sampleData: any[]) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `
        You are an expert data analyst. I have an Excel sheet with the following headers: ${headers.join(", ")}.
        Here is some sample data (first 3 rows): ${JSON.stringify(sampleData)}

        I need to split this data by a "Region" or "Regional Division" column.
        User PRD states the target column is likely "회원구분" (4th column).
        
        Please identify:
        1. Which column (header name) is the best fit for splitting by region (likely '회원구분', '지부', or '지역')?
        2. A brief 1-sentence explanation of why you chose it.
      `,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            columnName: { type: Type.STRING },
            explanation: { type: Type.STRING }
          },
          required: ["columnName", "explanation"]
        }
      }
    });

    return JSON.parse(response.text || "{}");
  } catch (error) {
    console.error("Gemini header analysis failed:", error);
    return null;
  }
}

export async function diagnoseError(errorMessage: string) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `
        The following error occurred in a data processing application: "${errorMessage}".
        Explain the source of this error and provide a helpful 1-sentence solution in Korean (friendly tone).
      `,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            diagnosis: { type: Type.STRING },
            solution: { type: Type.STRING }
          },
          required: ["diagnosis", "solution"]
        }
      }
    });

    return JSON.parse(response.text || "{}");
  } catch (error) {
    return {
      diagnosis: "알 수 없는 오류가 발생했습니다.",
      solution: "시스템 관리자에게 문의하거나 다시 시도해 주세요."
    };
  }
}

export async function generateCustomDraft(region: string, userInput: string, type: 'mail' | 'sms') {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `
        당신은 협회 행정 사무를 지원하는 AI 비서입니다.
        지역: ${region === '경북' ? '경북지부' : region + '지회'}
        사용자의 요구사항/참고내용: "${userInput}"
        출력 형식: ${type === 'mail' ? '이메일 (제목과 본문)' : 'SMS/문자 (본문만)'}

        요구사항을 바탕으로 정중하고 따뜻한 톤으로 문구를 작성해주세요.
        협회 명칭은 '경북평생교육사협회'를 기본으로 사용하세요.
        지역 명칭을 언급할 때는 '${region === '경북' ? '지부' : '지회'}'라는 표현을 적절히 사용하세요.
        
        출력은 반드시 JSON 형식이어야 합니다.
      `,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "이메일 제목 (SMS일 경우 빈 문자열)" },
            body: { type: Type.STRING, description: "본문 내용" }
          },
          required: ["title", "body"]
        }
      }
    });

    return JSON.parse(response.text || "{}");
  } catch (error) {
    console.error("Gemini draft generation failed:", error);
    return null;
  }
}

