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
  const apiKey = process.env.GEMINI_API_KEY || (import.meta as any).env?.VITE_GEMINI_API_KEY || "";
  if (apiKey) {
    try {
      const client = new GoogleGenAI({ apiKey });
      const response = await client.models.generateContent({
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

      const parsed = JSON.parse(response.text || "{}");
      if (parsed && (parsed.body || parsed.title)) {
        return parsed;
      }
    } catch (error) {
      console.warn("Gemini draft generation failed, using smart fallback:", error);
    }
  }

  // Fallback smart draft generator so AI regeneration always succeeds even without API key
  const regionalName = region === '경북' ? '경북지부' : `${region}지회`;
  if (type === 'mail') {
    return {
      title: `[분담금 지급 안내] 2026년 1분기 분담금 지급 상세 내역 송부 (${regionalName})`,
      body: `안녕하세요^^
화창한 햇살이 가득한 계절입니다. ${region} 지역 평생교육사분들의 권익 증진과 현장의 변화를 위해 헌신하시는 귀 지회에 안부 인사를 전합니다.

"평생교육은 개인의 성장을 넘어 지역사회의 지속가능한 발전을 이끄는 핵심 동력입니다." ${regionalName}의 열정적인 활동은 협회 전체에 큰 귀감이 되고 있습니다.

[맞춤 요구사항 반영]: ${userInput}

본회 통보에 따라 수령한 **'2026년 1분기 분담금'**을 금일 지급해 드리고자 합니다. 첨부된 상세 내역을 확인해 주시면 감사하겠습니다.

귀 지회와 함께하게 되어 늘 든든한 마음이며, 오늘도 보람찬 하루 되시길 바랍니다.`
    };
  } else {
    return {
      title: "",
      body: `[경북평생교육사협회]
안녕하세요, ${regionalName}님!
2026년 1분기 분담금이 금일 지급되었습니다. 
※ 전달사항: ${userInput}
자세한 내역은 이메일로 송부드린 첨부파일을 확인 부탁드립니다.
귀 지회의 헌신에 늘 감사드립니다.`
    };
  }
}

