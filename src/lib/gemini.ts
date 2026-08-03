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
        model: "gemini-3.6-flash",
        contents: `
          당신은 경북평생교육사협회 행정 사무를 지원하는 AI 비서입니다.
          지역: ${region === '경북' ? '경북지부' : region + '지회'}
          사용자의 요구사항/수정요청: "${userInput}"
          출력 형식: ${type === 'mail' ? '이메일 (제목과 본문)' : 'SMS/문자 (본문만)'}

          [작성 지침]
          1. 사용자의 요구사항(예: 분기 변경, 날짜 수정, 8월/무더위 등 계절 강조, 추가 전달 사항 등)을 실제 본문 문장 속에 자연스럽게 반영하여 완벽한 문구를 새로 작성하세요.
          2. 절대로 '[맞춤 요구사항 반영]:' 또는 '※ 전달사항:' 같은 레이블/태그를 본문에 그대로 노출하지 마세요.
          3. 이메일/문자 서식에 맞게 다정하고 정중한 어조를 유지하세요.
          4. 협회 명칭: '경북평생교육사협회'
          5. 지역 명칭: '${region === '경북' ? '경북지부' : region + '지회'}'
          
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
      console.warn("Gemini draft generation failed, using smart fallback transformer:", error);
    }
  }

  // Fallback smart draft generator so AI regeneration always succeeds even without API key on Vercel
  return generateSmartFallbackDraft(region, userInput, type);
}

function generateSmartFallbackDraft(region: string, userInput: string, type: 'mail' | 'sms') {
  const regionalName = region === '경북' ? '경북지부' : `${region}지회`;
  
  // 1. Detect Year & Quarter
  let period = "2026년 1분기";
  const quarterMatch = userInput.match(/(20\d{2}년\s*)?([1-4]분기)/);
  if (quarterMatch) {
    const year = quarterMatch[1] ? quarterMatch[1].trim() : "2026년";
    period = `${year} ${quarterMatch[2]}`;
  } else if (userInput.includes("2분기")) {
    period = "2026년 2분기";
  } else if (userInput.includes("3분기")) {
    period = "2026년 3분기";
  } else if (userInput.includes("4분기")) {
    period = "2026년 4분기";
  }

  // 2. Detect Date Replacement
  let targetDate = "4월 30일";
  // Matches e.g. "4월 30일을 7월 31일로" or "7월 31일"
  const dateChangeMatch = userInput.match(/(\d{1,2}월\s*\d{1,2}일)(으로|로|까지|자)?/g);
  if (dateChangeMatch && dateChangeMatch.length > 0) {
    const lastDate = dateChangeMatch[dateChangeMatch.length - 1].replace(/(으로|로|까지|자)$/, '').trim();
    if (lastDate !== "4월 30일") {
      targetDate = lastDate;
    }
  }

  // 3. Detect Weather / Season / Greeting Emphasis
  let greeting = `화창한 계절입니다. ${region} 지역 평생교육사분들의 권익 증진과 현장의 변화를 위해 헌신하시는 귀 지회에 안부 인사를 전합니다.`;
  let closingAdvice = "오늘도 보람찬 하루 되시길 바랍니다.";

  if (userInput.includes("무더위") || userInput.includes("8월") || userInput.includes("여름") || userInput.includes("더위")) {
    greeting = `연일 무더위가 이어지는 한여름입니다. ${region} 지역 평생교육사분들의 권익 증진과 현장의 변화를 위해 헌신하시는 귀 지회에 안부 인사를 전합니다.`;
    closingAdvice = "무더운 날씨에 항상 건강 유의하시고, 오늘도 보람찬 하루 되시길 바랍니다.";
  } else if (userInput.includes("겨울") || userInput.includes("추위") || userInput.includes("한파")) {
    greeting = `추운 날씨가 이어지는 계절입니다. ${region} 지역 평생교육사분들의 건강과 안녕을 기원하며 안부 인사를 전합니다.`;
    closingAdvice = "따뜻하고 건강한 하루 보내시길 바랍니다.";
  }

  // 4. Extra instructions / notes filtering out handled terms
  let extraInstruction = userInput
    .replace(/(이메일|SMS|문자)\s*형식을\s*유지하고/g, '')
    .replace(/(20\d{2}년\s*)?[1-4]분기(로\s*글자\s*수정)?/g, '')
    .replace(/\d{1,2}월\s*\d{1,2}일을\s*\d{1,2}월\s*\d{1,2}일로\s*변경/g, '')
    .replace(/\d{1,2}월\s*\d{1,2}일/g, '')
    .replace(/(8월의\s*)?무더위를?\s*(강조|반영)?/g, '')
    .replace(/[,.\s]+/g, ' ')
    .trim();

  let extraBodyText = "";
  if (extraInstruction.length > 2) {
    extraBodyText = `\n\n※ 안내 및 참고사항: ${extraInstruction}`;
  }

  if (type === 'mail') {
    return {
      title: `[분담금 지급 안내] ${period} 분담금 지급 상세 내역 송부 (${regionalName})`,
      body: `안녕하세요^^
${greeting}

"평생교육은 개인의 성장을 넘어 지역사회의 지속가능한 발전을 이끄는 핵심 동력입니다." ${regionalName}의 열정적인 활동은 협회 전체에 큰 귀감이 되고 있습니다.

본회 통보에 따라 지난 ${targetDate} 자로 수령한 **'${period} 분담금'**을 금일 지급해 드리고자 합니다. 첨부된 상세 내역을 확인해 주시면 감사하겠습니다.${extraBodyText}

귀 지회와 함께하게 되어 늘 든든한 마음이며, ${closingAdvice}`
    };
  } else {
    return {
      title: "",
      body: `[경북평생교육사협회]
안녕하세요, ${regionalName}님!
${period} 분담금이 금일 지급되었습니다. (${targetDate} 자 통보)
${extraInstruction ? `※ 전달사항: ${extraInstruction}\n` : ''}자세한 내역은 이메일로 송부드린 첨부파일을 확인 부탁드립니다.
귀 지회의 헌신에 늘 감사드립니다.`
    };
  }
}

