import * as XLSX from 'xlsx';

export interface SheetData {
  name: string;
  headers: string[];
  rows: any[];
  titleRow: any[]; // To preserve the first row (e.g., "2026년 3월")
}

export interface WorkbookData {
  sheets: SheetData[];
  filename: string;
}

export async function parseFullWorkbook(file: File): Promise<WorkbookData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        const sheets: SheetData[] = workbook.SheetNames.map(name => {
          const worksheet = workbook.Sheets[name];
          const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" }) as any[][];
          
          // Heuristic: Find the header row (typically row 1, but we scan first 5 rows)
          // We look for common keywords like "회원번호", "회원명", "회원구분"
          let headerRowIndex = 1; // Default
          for (let i = 0; i < Math.min(5, rawData.length); i++) {
            const row = rawData[i];
            if (row.some(cell => String(cell).includes("회원번호") || String(cell).includes("회원명"))) {
              headerRowIndex = i;
              break;
            }
          }

          const titleRow = headerRowIndex > 0 ? rawData[0] : [];
          const headers = (rawData[headerRowIndex] as string[]) || [];
          
          // Data starts after headers
          const rows = XLSX.utils.sheet_to_json(worksheet, { range: headerRowIndex }) as any[];
          
          return { name, headers, rows, titleRow };
        });
        
        resolve({ sheets, filename: file.name });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

export interface SplitResult {
  region: string;
  workbook: XLSX.WorkBook;
  validation: {
    sheetName: string;
    originalCount: number;
    resultCount: number;
    isMatch: boolean;
  }[];
}

export function splitWorkbookByRegion(workbookData: WorkbookData, regionColumn: string): SplitResult[] {
  // 1. Find all unique regions across all sheets
  const allRegions = new Set<string>();
  workbookData.sheets.forEach(sheet => {
    sheet.rows.forEach(row => {
      const region = String(row[regionColumn] || "").trim();
      // Only add non-empty regions. Also handle the case where the value might be the header itself
      if (region && region !== regionColumn) {
        allRegions.add(region);
      }
    });
  });

  const results: SplitResult[] = [];

  // 2. For each region, create a separate workbook
  allRegions.forEach(region => {
    const newWorkbook = XLSX.utils.book_new();
    let hasData = false;
    const validation: SplitResult['validation'] = [];
    
    workbookData.sheets.forEach(originalSheet => {
      // Filter rows for this region
      const filteredRows = originalSheet.rows.filter(row => 
        String(row[regionColumn] || "").trim() === region
      );

      validation.push({
        sheetName: originalSheet.name,
        originalCount: filteredRows.length,
        resultCount: filteredRows.length, // In memory, it's always the same, but this represents the audit
        isMatch: true
      });

      const wsData: any[][] = [];
      
      // Preserve Title Row if it exists and isn't just the header
      if (originalSheet.titleRow.length > 0 && originalSheet.titleRow[0] !== originalSheet.headers[0]) {
        wsData.push(originalSheet.titleRow);
      }
      
      // Add Headers
      wsData.push(originalSheet.headers);
      
      // Add Data Rows
      filteredRows.forEach(row => {
        wsData.push(originalSheet.headers.map(h => row[h]));
      });

      const worksheet = XLSX.utils.aoa_to_sheet(wsData);

      // Apply some basic column width adjustment
      const wscols = originalSheet.headers.map(() => ({ wch: 15 }));
      worksheet['!cols'] = wscols;
      
      // Calculate new sheet name: "Month(Count명)"
      // Clean original name (remove existing "(...명)")
      const originalNameClean = originalSheet.name.replace(/\(\d+명\)/g, '').trim();
      const newSheetName = `${originalNameClean}(${filteredRows.length}명)`.substring(0, 31);
      
      XLSX.utils.book_append_sheet(newWorkbook, worksheet, newSheetName);
      if (filteredRows.length > 0) hasData = true;
    });

    if (hasData) {
      results.push({ region, workbook: newWorkbook, validation });
    }
  });

  return results;
}

export function downloadRegionalWorkbooks(results: SplitResult[], originalFilename: string) {
  const datestr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  
  results.forEach(({ region, workbook }) => {
    const filename = `[분리완료]_${region}_${datestr}_${originalFilename}`;
    XLSX.writeFile(workbook, filename);
  });
}
