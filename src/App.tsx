import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  FileUp, 
  Settings, 
  Play, 
  AlertCircle, 
  CheckCircle2, 
  Terminal, 
  Download, 
  Database,
  Filter,
  Users,
  Mail,
  Copy,
  Layers,
  MessageSquare,
  Calculator,
  BarChart3,
  TrendingUp,
  Receipt,
  Search,
  Calendar,
  History,
  Trash2,
  Edit3,
  Save,
  X
} from 'lucide-react';
import { parseFullWorkbook, splitWorkbookByRegion, downloadRegionalWorkbooks, WorkbookData, SplitResult } from './lib/excel';
import { analyzeHeaders, diagnoseError, generateCustomDraft } from './lib/gemini';
import { calculateSettlement, SettlementTotal, BRANCH_INFO } from './lib/settlement';
import { MOCK_HISTORY, SettlementHistoryEntry } from './lib/history';
import { getSupabase } from './lib/supabase';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface LogEntry {
  type: 'info' | 'error' | 'success';
  message: string;
  timestamp: string;
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [workbookData, setWorkbookData] = useState<WorkbookData | null>(null);
  const [detectedRegions, setDetectedRegions] = useState<string[]>([]);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [splitColumn, setSplitColumn] = useState<string | null>(null);
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [errorDiagnosis, setErrorDiagnosis] = useState<{ diagnosis: string, solution: string } | null>(null);
  const [results, setResults] = useState<SplitResult[] | null>(null);
  const [activeEmailRegion, setActiveEmailRegion] = useState<string | null>(null);
  const [activeMessageType, setActiveMessageType] = useState<'mail' | 'sms'>('mail');
  const [activeTab, setActiveTab] = useState<'splitter' | 'manual' | 'auto' | 'dashboard'>('splitter');
  
  // Dashboard / History State
  const [history, setHistory] = useState<SettlementHistoryEntry[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [manualPeriod, setManualPeriod] = useState("2026년 2분기");
  const [autoPeriod, setAutoPeriod] = useState("2026년 2분기");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<SettlementHistoryEntry | null>(null);
  
  // Dashboard Action
  const addToHistory = async (settlement: SettlementTotal, period: string) => {
    if (!settlement) {
      addLog("정산 데이터가 없습니다.", "error");
      return;
    }

    const gumi = settlement.results.find(r => r.region === '구미');
    const sangju = settlement.results.find(r => r.region === '상주');
    const gyeongju = settlement.results.find(r => r.region === '경주');

    const newEntry: SettlementHistoryEntry = {
      id: crypto.randomUUID?.() || Math.random().toString(36).substr(2, 9) + Date.now().toString(36),
      period: period,
      total: settlement.totalDistributed,
      gyeongbuk: settlement.totalGyeongbukIncome,
      gumi: gumi?.finalPayment || 0,
      sangju: sangju?.finalPayment || 0,
      gyeongju: gyeongju?.finalPayment || 0,
      createdat: new Date().toISOString()
    };

    // Update local state and UI immediately for responsiveness
    setHistory(prev => [newEntry, ...prev]);
    addLog(`'${period}' 정산 내역이 대시보드에 업데이트되었습니다.`, 'success');
    
    // Switch to dashboard first so user can see progress
    setActiveTab('dashboard');

    // Save to Supabase in background
    const supabase = getSupabase();
    if (supabase) {
      try {
        const { error } = await supabase.from('settlement_history').insert([newEntry]);
        if (error) {
          console.error("Supabase insert error details:", error);
          throw error;
        }
        addLog(`클라우드 데이터베이스(Supabase)에 성공적으로 저장되었습니다.`, 'success');
      } catch (err: any) {
        console.error("Supabase insert error:", err);
        const isAuthError = err.message?.includes("403") || err.code === '42501' || err.status === 403;
        addLog(`DB 저장 실패: ${err.message || '네트워크 오류'}`, 'error');
        
        if (isAuthError) {
          addLog("권한 오류(RLS) 발생: Supabase 'Authentication' -> 'Policies' 메뉴에서 'settlement_history' 테이블에 INSERT 권한(anon 역할용)을 추가해주세요.", "info");
        } else if (err.message === 'Failed to fetch') {
          addLog("네트워크 오류: Supabase URL이 정확한지 확인해주세요. (https://xxx.supabase.co 형식)", "info");
        }
      }
    } else {
      const url = import.meta.env.VITE_SUPABASE_URL;
      const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
      
      if (!url || !key) {
        addLog("Supabase 설정이 감지되지 않았습니다. 만약 Vercel/GitHub에 배포하셨다면 Settings -> Environment Variables에서 VITE_SUPABASE_URL과 VITE_SUPABASE_ANON_KEY를 추가하고 재배포해야 합니다.", "info");
      } else if (url && (url.includes("supabase.com") || !url.startsWith("http"))) {
        addLog("Supabase URL 형식이 잘못되었습니다. 'Project Settings -> API'에 있는 https://xxx.supabase.co 형태의 URL을 사용해주세요.", "error");
      } else {
        addLog("Supabase 연동이 준비되지 않았습니다. (Settings 메뉴에서 설정을 확인해주세요)", "info");
      }
    }
  };

  const deleteHistoryEntry = async (id: string) => {
    if (!confirm("이 정산 내역을 정말로 삭제하시겠습니까?")) return;
    
    setIsDeletingId(id);
    // Remove from Supabase
    const supabase = getSupabase();
    if (supabase) {
      try {
        const { error } = await supabase.from('settlement_history').delete().eq('id', id);
        if (error) {
          console.error("Supabase delete error details:", error);
          throw error;
        }
        addLog("클라우드 데이터베이스에서 내역이 삭제되었습니다.", 'info');
      } catch (err: any) {
        console.error("Supabase delete error:", err);
        const isAuthError = err.message?.includes("403") || err.code === '42501' || err.status === 403;
        addLog(`DB 삭제 실패: ${err.message || '네트워크 오류'}`, 'error');
        if (isAuthError) {
          addLog("권한 오류: Supabase RLS Policies에서 DELETE 권한을 'anon' 역할에 허용했는지 확인해주세요.", "info");
        }
      }
    }

    setHistory(prev => prev.filter(entry => entry.id !== id));
    addLog("정산 내역이 화면에서 삭제되었습니다.", 'info');
    setIsDeletingId(null);
  };

  const startEditing = (entry: SettlementHistoryEntry) => {
    setEditingId(entry.id);
    setEditForm({ ...entry });
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditForm(null);
  };

  const saveEdit = async () => {
    if (!editForm) return;

    // Save to Supabase
    const supabase = getSupabase();
    if (supabase) {
      try {
        const { error } = await supabase
          .from('settlement_history')
          .update(editForm)
          .eq('id', editForm.id);
        if (error) {
          console.error("Supabase update error:", error);
          throw error;
        }
        addLog(`'${editForm.period}' 내역이 클라우드에 업데이트되었습니다.`, 'success');
      } catch (err: any) {
        addLog(`DB 업데이트 실패: ${err.message}`, 'error');
        if (err.message.includes("403") || err.message.includes("policy")) {
          addLog("팁: Supabase의 RLS Policies에서 UPDATE 권한을 확인해주세요.", "info");
        }
        // Even if DB fails, update local state to keep UI working
      }
    }

    setHistory(prev => prev.map(entry => entry.id === editForm.id ? editForm : entry));
    setEditingId(null);
    setEditForm(null);
    addLog(`'${editForm.period}' 정산 내역이 수정되었습니다.`, 'success');
  };
  
  // Manual Settlement State
  const [manualCounts, setManualCounts] = useState<Record<string, number>>({
    '경북': 96,
    '구미': 28,
    '상주': 23,
    '경주': 163
  });
  
  // Auto Settlement State
  const [autoSettlementFile, setAutoSettlementFile] = useState<File | null>(null);
  const [autoSettlementData, setAutoSettlementData] = useState<SettlementTotal | null>(null);
  
  // Branch Info State (Editable)
  const [branchInfo, setBranchInfo] = useState<Record<string, { account: string, email: string }>>(BRANCH_INFO);
  const [editingBranch, setEditingBranch] = useState<string | null>(null);
  const [branchEditForm, setBranchEditForm] = useState<{ account: string, email: string } | null>(null);

  const startEditingBranch = (region: string) => {
    setEditingBranch(region);
    setBranchEditForm({ ...branchInfo[region] });
  };

  const saveBranchEdit = () => {
    if (editingBranch && branchEditForm) {
      setBranchInfo(prev => ({
        ...prev,
        [editingBranch]: branchEditForm
      }));
      setEditingBranch(null);
      setBranchEditForm(null);
      addLog(`${editingBranch}지회의 송금 정보가 수정되었습니다.`, 'success');
    }
  };
  
  const [customRequirement, setCustomRequirement] = useState("");
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
  const [customDrafts, setCustomDrafts] = useState<Record<string, { title: string, body: string }>>({});

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  // Load history from Supabase
  useEffect(() => {
    const fetchHistory = async () => {
      const supabase = getSupabase();
      if (!supabase) {
        setHistory(MOCK_HISTORY);
        return;
      }

      setIsLoadingHistory(true);
      try {
        const { data, error } = await supabase
          .from('settlement_history')
          .select('*')
          .order('createdat', { ascending: false });

        if (error) throw error;
        if (data && data.length > 0) {
          setHistory(data as SettlementHistoryEntry[]);
        } else {
          setHistory(MOCK_HISTORY);
        }
      } catch (err: any) {
        const errorMessage = err.message === 'Failed to fetch' 
          ? 'Supabase URL이 잘못되었거나 네트워크 연결이 원활하지 않습니다. https://xxx.supabase.co 형태의 API URL을 입력했는지 확인해주세요.'
          : err.message;
        
        console.error('Error fetching history:', err.message);
        addLog(`데이터베이스 연동 실패: ${errorMessage}`, 'error');
        setHistory(MOCK_HISTORY);
      } finally {
        setIsLoadingHistory(false);
      }
    };

    fetchHistory();
  }, []);

  const addLog = (message: string, type: 'info' | 'error' | 'success' = 'info') => {
    setLogs(prev => [...prev, {
      message,
      type,
      timestamp: new Date().toLocaleTimeString()
    }]);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    addLog(`${label}를 클립보드에 복사했습니다.`, 'success');
  };

  const getMailDraft = (region: string) => {
    const regionalName = region === '경북' ? '경북지부' : `${region}지회`;
    const title = `[분담금 지급 안내] 2026년 1분기 분담금 지급 상세 내역 송부 (${regionalName})`;
    const body = `안녕하세요^^
화창한 햇살이 가득한 계절입니다. ${region} 지역 평생교육사분들의 권익 증진과 현장의 변화를 위해 헌신하시는 귀 지회에 안부 인사를 전합니다.

"평생교육은 개인의 성장을 넘어 지역사회의 지속가능한 발전을 이끄는 핵심 동력입니다." ${regionalName}의 열정적인 활동은 협회 전체에 큰 귀감이 되고 있습니다.

본회 통보에 따라 지난 4월 30일 자로 수령한 **'2026년 1분기 분담금'**을 금일 지급해 드리고자 합니다. 첨부된 상세 내역을 확인해 주시면 감사하겠습니다.

귀 지회와 함께하게 되어 늘 든든한 마음이며, 오늘도 보람찬 하루 되시길 바랍니다.`;
    return { title, body };
  };

  const handleDraftRegenerate = async () => {
    if (!activeEmailRegion || !customRequirement) return;
    
    try {
      setIsGeneratingDraft(true);
      addLog(`${activeEmailRegion} 지회용 맞춤 문구 생성 중...`, 'info');
      const draft = await generateCustomDraft(activeEmailRegion, customRequirement, activeMessageType);
      if (draft) {
        setCustomDrafts(prev => ({
          ...prev,
          [`${activeEmailRegion}_${activeMessageType}`]: draft
        }));
        addLog(`${activeEmailRegion} 지회용 맞춤 문구가 재생성되었습니다.`, 'success');
      }
    } catch (err: any) {
      addLog(`문구 생성 오류: ${err.message}`, 'error');
    } finally {
      setIsGeneratingDraft(false);
    }
  };

  const getSmsDraft = (region: string) => {
    const regionalName = region === '경북' ? '경북지부' : `${region}지회`;
    return `[경북평생교육사협회]
안녕하세요, ${regionalName}님!
2026년 1분기 분담금이 금일 지급되었습니다. 
자세한 내역은 이메일로 송부드린 첨부파일을 확인 부탁드립니다.
귀 지회의 헌신에 늘 감사드립니다.`;
  };

  const getActiveDraft = (region: string) => {
    const custom = customDrafts[`${region}_${activeMessageType}`];
    if (custom) return custom;
    
    if (activeMessageType === 'mail') return getMailDraft(region);
    return { title: "", body: getSmsDraft(region) };
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setResults(null);
    setErrorDiagnosis(null);
    addLog(`파일 업로드 확인: ${selectedFile.name}`);
    
    // Suggest period from filename
    const suggestedPeriod = selectedFile.name.substring(0, selectedFile.name.lastIndexOf('.')) || selectedFile.name;
    setAutoPeriod(suggestedPeriod);
    setManualPeriod(suggestedPeriod);

    try {
      setIsAnalyzing(true);
      const data = await parseFullWorkbook(selectedFile);
      setWorkbookData(data);
      
      const firstSheet = data.sheets[0];
      addLog(`${data.sheets.length}개의 시트를 감지했습니다: ${data.sheets.map(s => s.name).join(', ')}`);
      
      const analysis = await analyzeHeaders(firstSheet.headers, firstSheet.rows.slice(0, 3));
      
      // Force "회원구분" if found, otherwise use AI suggestion
      const prdColumn = firstSheet.headers.find(h => String(h).includes("회원구분"));
      const finalColumn = prdColumn || analysis?.columnName || firstSheet.headers[3];

      setSplitColumn(finalColumn);
      setAiExplanation(analysis?.explanation || "PRD 규칙에 따라 '회원구분' 열을 감지했습니다.");
      addLog(`기준열 설정: '${finalColumn}'`, 'success');
      
      // Find all unique regions across all sheets
      const allRegionsSet = new Set<string>();
      data.sheets.forEach(sheet => {
        sheet.rows.forEach(row => {
          const region = String(row[finalColumn] || "").trim();
          if (region && region !== finalColumn) allRegionsSet.add(region);
        });
      });
      
      const regions = Array.from(allRegionsSet).sort();
      setDetectedRegions(regions);
      setSelectedRegions(regions);
      addLog(`총 ${regions.length}개의 지역(${regions.join(', ')}) 데이터를 확인했습니다.`);
    } catch (err: any) {
      addLog(`파일 분석 중 오류: ${err.message}`, 'error');
      const diagnosis = await diagnoseError(err.message);
      setErrorDiagnosis(diagnosis);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const executeSplit = async () => {
    if (!file || !splitColumn || !workbookData) return;

    try {
      setIsProcessing(true);
      addLog("지역별 파일 분리 프로세스를 시작합니다...");
      
      const splitResults = splitWorkbookByRegion(workbookData, splitColumn);
      const filteredResults = splitResults.filter(r => selectedRegions.includes(r.region));
      
      setResults(filteredResults);
      addLog(`${filteredResults.length}개의 지역별 파일이 생성되었습니다.`, 'success');
      
      downloadRegionalWorkbooks(filteredResults, file.name);
      addLog("모든 파일 다운로드가 시작되었습니다.", 'success');
    } catch (err: any) {
      addLog(`처리 중 치명적 오류: ${err.message}`, 'error');
      const diagnosis = await diagnoseError(err.message);
      setErrorDiagnosis(diagnosis);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReflectToSettlement = () => {
    if (!results) return;

    addLog("데이터 분리 결과를 정산 시스템에 반영합니다...");
    
    const counts: Record<string, number> = { '경북': 0, '구미': 0, '상주': 0, '경주': 0 };
    
    results.forEach(res => {
      const totalCountForRegion = res.validation.reduce((acc, v) => acc + (v.resultCount || 0), 0);
      const region = res.region;
      
      // We look for keyword matches based on PRD
      if (region.includes("구미")) counts['구미'] += totalCountForRegion;
      else if (region.includes("상주")) counts['상주'] += totalCountForRegion;
      else if (region.includes("경주")) counts['경주'] += totalCountForRegion;
      else if (region.includes("경북")) counts['경북'] += totalCountForRegion;
      else {
        // Handle other regions if they exist in state but not explicitly in these hardcoded ones
        if (counts[region] !== undefined) counts[region] += totalCountForRegion;
        else counts[region] = totalCountForRegion;
      }
    });

    setManualCounts(counts);
    const settlement = calculateSettlement(counts);
    setAutoSettlementData(settlement);
    
    addLog(`총 ${results.length}개 지회의 인원 데이터가 정산 메뉴로 전송되었습니다.`, 'success');
    setActiveTab('manual');
  };

  const handleAutoSettlementUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setAutoSettlementFile(selectedFile);
    addLog(`정산 파일 업로드: ${selectedFile.name}`);
    
    // Requirement: Suggest period from filename
    // Example: "2026-1분기-정산.xlsx" -> "2026-1분기-정산"
    const suggestedPeriod = selectedFile.name.substring(0, selectedFile.name.lastIndexOf('.')) || selectedFile.name;
    setAutoPeriod(suggestedPeriod);
    setManualPeriod(suggestedPeriod);

    try {
      const data = await parseFullWorkbook(selectedFile);
      const counts: Record<string, number> = { '경북': 0, '구미': 0, '상주': 0, '경주': 0 };
      
      // Determine columns
      const firstSheet = data.sheets[0];
      const regionCol = firstSheet.headers.find(h => String(h).includes("회원구분")) || firstSheet.headers[3];

      data.sheets.forEach(sheet => {
        sheet.rows.forEach(row => {
          const regionValue = String(row[regionCol] || "").trim();
          if (regionValue.includes("구미")) counts['구미']++;
          else if (regionValue.includes("상주")) counts['상주']++;
          else if (regionValue.includes("경주")) counts['경주']++;
          else if (regionValue.includes("경북")) counts['경북']++;
        });
      });

      const settlement = calculateSettlement(counts);
      setAutoSettlementData(settlement);
      
      // Requirement: Update manual counts so Manual tab reflects these results
      setManualCounts(counts);

      addLog(`자동 정산 완료: 총 ${settlement.totalDistributed.toLocaleString()}원 분배 대상`, 'success');
      addLog(`결과가 '수동 정산' 탭에도 반영되었습니다.`, 'info');
    } catch (err: any) {
      addLog(`정산 분석 오류: ${err.message}`, 'error');
    }
  };

  const manualSettlement = calculateSettlement(manualCounts);

  const toggleRegion = (region: string) => {
    setSelectedRegions(prev => 
      prev.includes(region) ? prev.filter(r => r !== region) : [...prev, region]
    );
  };

  const filteredHistory = history.filter(entry => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    
    // Search in period names
    if (entry.period.toLowerCase().includes(q)) return true;
    
    // Search in branch names strictly if they have amounts
    if (q === "경북" || q === "경북지부") return entry.gyeongbuk > 0;
    if (q === "구미" || q === "구미지회") return entry.gumi > 0;
    if (q === "상주" || q === "상주지회") return entry.sangju > 0;
    if (q === "경주" || q === "경주지회") return entry.gyeongju > 0;
    
    return false;
  });

  return (
    <div className="min-h-screen pb-12">
      {/* Header */}
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-600 rounded-lg text-white shadow-lg shadow-indigo-100">
            <Database size={24} />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-none">K-ALE 정산 마스터</h1>
            <p className="text-xs text-slate-500 font-medium">Gyeongbuk Association Administration System</p>
          </div>
        </div>
        
        <nav className="hidden md:flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
          <button 
            onClick={() => setActiveTab('splitter')}
            className={cn(
              "px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2",
              activeTab === 'splitter' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
            <Layers size={14} /> 데이터 분리
          </button>
          <button 
            onClick={() => setActiveTab('manual')}
            className={cn(
              "px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2",
              activeTab === 'manual' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
            <Calculator size={14} /> 수동 정산
          </button>
          <button 
            onClick={() => setActiveTab('auto')}
            className={cn(
              "px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2",
              activeTab === 'auto' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
             <BarChart3 size={14} /> 자동 정산
          </button>
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={cn(
              "px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2",
              activeTab === 'dashboard' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
             <History size={14} /> 정산 대시보드
          </button>
        </nav>

        <div className="flex items-center gap-2">
          <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded-full font-semibold border border-indigo-100">
            v3.0 Release
          </span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 pt-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Main Content (Increased width from 7 to 8) */}
        <div className="lg:col-span-12 xl:col-span-8 space-y-8">
          
          {activeTab === 'splitter' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
              {/* Step 1: Upload */}
              <section className="space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px] font-bold">1</div>
                  <h2 className="font-semibold text-slate-800">통합 엑셀 파일 업로드</h2>
                </div>
                
                <label className={cn(
                  "relative flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-2xl transition-all cursor-pointer overflow-hidden group",
                  file ? "border-indigo-400 bg-indigo-50/30" : "border-slate-300 bg-white hover:border-indigo-400 hover:bg-slate-50"
                )}>
                  <input type="file" className="hidden" accept=".xlsx, .xls" onChange={handleFileUpload} />
                  <AnimatePresence mode="wait">
                    {isAnalyzing ? (
                      <motion.div 
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="flex flex-col items-center gap-3"
                      >
                        <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
                        <p className="text-sm font-medium text-slate-600">모든 시트의 데이터를 분석 중입니다...</p>
                      </motion.div>
                    ) : file ? (
                      <motion.div 
                        initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                        className="flex flex-col items-center gap-2 text-center px-6"
                      >
                        <div className="p-3 bg-emerald-100 text-emerald-600 rounded-2xl mb-2">
                          <CheckCircle2 size={32} />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-900">{file.name}</p>
                          <p className="text-xs text-slate-500 font-medium">{(file.size / 1024).toFixed(1)} KB • {workbookData?.sheets.length}개 시트 감지</p>
                        </div>
                        <div className="mt-4 flex flex-wrap justify-center gap-2">
                          {workbookData?.sheets.map(s => (
                            <div key={s.name} className="px-2 py-0.5 bg-white border border-slate-200 rounded text-[10px] text-slate-600 font-bold">
                              {s.name}
                            </div>
                          ))}
                        </div>
                        <button 
                          onClick={(e) => { e.preventDefault(); setFile(null); setWorkbookData(null); setDetectedRegions([]); setResults(null); }}
                          className="mt-6 px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-[10px] font-black rounded-lg transition-all active:scale-95 uppercase tracking-wider shadow-sm"
                        >
                          다른 파일 선택하기
                        </button>
                      </motion.div>
                    ) : (
                      <div className="flex flex-col items-center gap-3">
                        <div className="p-4 bg-slate-100 rounded-full text-slate-400 group-hover:text-indigo-400 transition-colors group-hover:bg-indigo-50">
                          <FileUp size={32} />
                        </div>
                        <div className="text-center">
                          <p className="text-sm font-bold text-slate-900">원본 파일을 드래그하거나 선택하세요</p>
                          <p className="text-xs text-slate-500 mt-1">통합된 월별 데이터가 포함된 엑셀 파일</p>
                        </div>
                      </div>
                    )}
                  </AnimatePresence>
                </label>

                {/* AI Diagnosis */}
                {splitColumn && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                    className="p-4 bg-white border border-indigo-100 rounded-xl flex items-start gap-4 shadow-sm"
                  >
                    <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                      <Layers size={20} />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-sm font-bold text-indigo-900">데이터 구조 분석 결과</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-bold uppercase tracking-tighter">지역 기준열</span>
                        <span className="text-sm font-bold text-indigo-600 font-mono">[{splitColumn}]</span>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* Data Preview Section */}
                {workbookData && workbookData.sheets.length > 0 && (
                  <motion.div 
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="bg-white border rounded-xl overflow-hidden shadow-sm"
                  >
                    <div className="px-4 py-3 bg-slate-50 border-b flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-600">파일 내용 미리보기 (첫 번째 시트)</span>
                      <div className="text-[10px] font-bold text-slate-400">상위 5개 항목만 표시</div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-50/50">
                          <tr>
                            {workbookData.sheets[0].headers.slice(0, 5).map((h, i) => (
                              <th key={i} className={cn(
                                "px-4 py-2 text-[10px] uppercase font-bold text-slate-400 border-b",
                                h === splitColumn ? "text-indigo-600 bg-indigo-50/50" : ""
                              )}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {workbookData.sheets[0].rows.slice(0, 5).map((row, i) => (
                            <tr key={i} className="hover:bg-slate-50 transition-colors">
                              {workbookData.sheets[0].headers.slice(0, 5).map((h, j) => (
                                <td key={j} className={cn(
                                  "px-4 py-2 text-xs border-b border-slate-100 font-medium",
                                  h === splitColumn ? "font-bold text-indigo-600" : "text-slate-600"
                                )}>
                                  {String(row[h] || "-")}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </motion.div>
                )}
              </section>

              {/* Step 2: Regions Selection */}
              <AnimatePresence>
                {detectedRegions.length > 0 && (
                  <motion.section 
                    initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                    className="space-y-4"
                  >
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px] font-bold">2</div>
                        <h2 className="font-semibold text-slate-800">지회별 파일 생성 대상 설정</h2>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => setSelectedRegions(detectedRegions)} className="text-[10px] bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded font-bold text-slate-600 transition-colors">전체 선택</button>
                        <button onClick={() => setSelectedRegions([])} className="text-[10px] bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded font-bold text-slate-600 transition-colors">해제</button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                      {detectedRegions.map(region => (
                        <button
                          key={region}
                          onClick={() => toggleRegion(region)}
                          className={cn(
                            "p-3 rounded-xl border text-sm font-bold transition-all text-left flex items-center justify-between gap-2 group",
                            selectedRegions.includes(region) 
                              ? "bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-100" 
                              : "bg-white border-slate-200 text-slate-600 hover:border-indigo-400 hover:bg-slate-50"
                          )}
                        >
                          <span className="truncate">{region}</span>
                          {selectedRegions.includes(region) ? (
                            <CheckCircle2 size={14} className="flex-shrink-0" />
                          ) : (
                            <div className="w-3 h-3 rounded-full border border-slate-300 group-hover:border-indigo-400" />
                          )}
                        </button>
                      ))}
                    </div>
                    
                    <div className="flex justify-end pt-4">
                      <button
                        disabled={selectedRegions.length === 0 || isProcessing}
                        onClick={executeSplit}
                        className={cn(
                          "flex items-center gap-2 bg-indigo-600 text-white px-10 py-4 rounded-2xl font-bold shadow-xl shadow-indigo-200 transition-all active:scale-95 disabled:opacity-50 disabled:grayscale",
                          isProcessing ? "cursor-not-allowed" : "hover:bg-indigo-700 hover:-translate-y-1"
                        )}
                      >
                        {isProcessing ? (
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                            <span>파일 생성 중...</span>
                          </div>
                        ) : (
                          <>
                            <Play size={20} fill="currentColor" />
                            <span>지역별 개별 파일 추출 시작</span>
                          </>
                        )}
                      </button>
                    </div>
                  </motion.section>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {activeTab === 'manual' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
              <div className="bg-indigo-50 border border-indigo-200 p-5 rounded-3xl flex items-start gap-4 mb-2 shadow-sm">
                <div className="p-2 bg-indigo-100 text-indigo-600 rounded-xl">
                  <FileUp size={24} />
                </div>
                <div>
                  <p className="text-sm font-bold text-indigo-900">데이터 입력 안내</p>
                  <p className="text-xs text-indigo-700 leading-relaxed mt-1">
                    수동 정산 탭은 데이터를 직접 입력하거나, <b>'자동 정산'</b> 탭에서 업로드된 엑셀 데이터를 자동으로 불러올 수 있습니다. <br/>
                    대량의 데이터를 처리하시려면 먼저 <b>자동 정산 탭에서 파일을 업로드</b> 하세요.
                  </p>
                </div>
              </div>

              <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-xl shadow-slate-200/50">
                <div className="flex items-center gap-4 mb-8 border-b pb-6">
                  <div className="p-3 bg-rose-50 text-rose-600 rounded-2xl">
                    <Calculator size={28} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900 tracking-tight">수동 분담금 통합 계산기</h2>
                    <p className="text-sm text-slate-500 font-medium">지역별 회원 수를 입력하여 최종 지급액을 즉시 산출합니다.</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="col-span-full md:col-span-2 space-y-3 pb-4 border-b">
                    <label className="text-sm font-bold text-slate-700 flex items-center justify-between">
                      <span>정산 기간 설정</span>
                      <span className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest">Settlement Period</span>
                    </label>
                    <div className="relative group">
                      <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-indigo-400 transition-colors" size={18} />
                      <input 
                        type="text"
                        value={manualPeriod}
                        onChange={(e) => setManualPeriod(e.target.value)}
                        placeholder="예: 2026년 2분기"
                        className="w-full pl-12 pr-6 py-4 bg-indigo-50/30 border border-indigo-100 rounded-2xl font-bold text-lg focus:bg-white focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 transition-all outline-none"
                      />
                    </div>
                  </div>
                  {Object.keys(manualCounts).map(region => (
                    <div key={region} className="space-y-3">
                      <label className="text-sm font-bold text-slate-700 flex items-center justify-between">
                        <span>{region === '경북' ? '경북지부' : region + '지회'} 회원 수</span>
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Input count</span>
                      </label>
                      <div className="relative group">
                        <Users className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-indigo-400 transition-colors" size={18} />
                        <input 
                          type="number"
                          value={manualCounts[region]}
                          onChange={(e) => setManualCounts(prev => ({ ...prev, [region]: parseInt(e.target.value) || 0 }))}
                          className="w-full pl-12 pr-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-xl text-rose-600 focus:bg-white focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 transition-all outline-none"
                        />
                        <span className="absolute right-6 top-1/2 -translate-y-1/2 font-bold text-slate-400">명</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-12 p-8 bg-indigo-900 rounded-3xl text-white shadow-2xl shadow-indigo-200 relative overflow-hidden">
                   <TrendingUp className="absolute -right-4 -bottom-4 text-white/5 w-48 h-48" />
                   <div className="relative z-10 space-y-6">
                      <div className="flex items-center justify-between border-b border-white/10 pb-4">
                        <span className="text-sm font-bold text-white/70">지협 총 분담금 수입액</span>
                        <span className="text-3xl font-black">{manualSettlement.totalDistributed.toLocaleString()}원</span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                         <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                            <p className="text-[10px] font-bold text-indigo-300 uppercase mb-1">본부 분담률 (30%)</p>
                            <p className="text-lg font-bold">-{manualSettlement.results.reduce((acc, r) => acc + r.hqShare, 0).toLocaleString()}원</p>
                         </div>
                         <div className="p-4 bg-emerald-500/10 rounded-2xl border border-emerald-500/20">
                            <p className="text-[10px] font-bold text-emerald-300 uppercase mb-1">경북지부 최종 수입</p>
                            <p className="text-lg font-bold text-emerald-400">{manualSettlement.totalGyeongbukIncome.toLocaleString()}원</p>
                         </div>
                      </div>
                      
                      <button 
                        onClick={() => addToHistory(manualSettlement, manualPeriod)}
                        className="w-full py-4 bg-white text-indigo-600 rounded-2xl font-black text-lg shadow-xl shadow-black/20 hover:bg-slate-50 transition-all active:scale-95 flex items-center justify-center gap-2"
                      >
                         <History size={20} /> 대시보드에 적용하기
                      </button>
                   </div>
                </div>
              </div>

              {/* Individual Branch Results */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                 {manualSettlement.results.filter(r => r.region !== '경북').map(r => (
                   <motion.div 
                     key={r.region}
                     whileHover={{ y: -4 }}
                     className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm"
                   >
                     <div className="flex items-center justify-between mb-4">
                        <span className="text-sm font-bold text-slate-900">{r.region}지회</span>
                        <span className="text-xs bg-slate-100 px-2 py-1 rounded-lg font-bold text-slate-500">{r.count}명</span>
                     </div>
                     <div className="space-y-2">
                        <div className="flex justify-between text-xs text-slate-500">
                           <span>수입액 (수수료 제외)</span>
                           <span className="font-medium">{r.revenue.toLocaleString()}원</span>
                        </div>
                        <div className="flex justify-between text-xs text-slate-500">
                           <span>지부 공제액 (20%)</span>
                           <span className="font-medium">-{r.branchFeeToParent.toLocaleString()}원</span>
                        </div>
                        <div className="pt-2 border-t mt-2 flex justify-between items-end">
                           <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-tighter">최종 지급액</span>
                           <span className="text-lg font-black text-indigo-600">{r.finalPayment.toLocaleString()}원</span>
                        </div>
                     </div>
                   </motion.div>
                 ))}
              </div>

              {/* Branch Account Info */}
              <div className="bg-white p-6 rounded-3xl border border-slate-200">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    <Database size={16} className="text-indigo-600" /> 지회별 송금 정보
                  </h3>
                  <p className="text-[10px] text-slate-400 font-bold uppercase">Editable branch info</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                   {(Object.entries(branchInfo) as [string, { account: string, email: string }][]).map(([region, info]) => (
                     <div key={region} className={cn(
                       "p-4 rounded-xl border transition-all",
                       editingBranch === region ? "bg-indigo-50 border-indigo-200 ring-4 ring-indigo-50" : "bg-slate-50 border-slate-100"
                     )}>
                        <div className="flex justify-between items-start mb-2">
                           <span className="text-xs font-bold text-slate-900">{region}지회</span>
                           <div className="flex items-center gap-1">
                             {editingBranch === region ? (
                               <>
                                 <button onClick={saveBranchEdit} className="p-1 px-2 bg-indigo-600 text-white rounded text-[10px] font-bold">저장</button>
                                 <button onClick={() => setEditingBranch(null)} className="p-1 px-2 bg-slate-200 text-slate-600 rounded text-[10px] font-bold">취소</button>
                               </>
                             ) : (
                               <button 
                                 onClick={() => startEditingBranch(region)}
                                 className="p-1 text-slate-400 hover:text-indigo-600 transition-colors"
                                 title="정보 수정"
                               >
                                 <Edit3 size={14} />
                               </button>
                             )}
                           </div>
                        </div>
                        
                        {editingBranch === region && branchEditForm ? (
                          <div className="space-y-2">
                            <input 
                              type="text" 
                              value={branchEditForm.account}
                              onChange={e => setBranchEditForm({...branchEditForm, account: e.target.value})}
                              className="w-full px-2 py-1.5 text-[11px] border rounded bg-white"
                              placeholder="계좌 정보 입력"
                            />
                            <input 
                              type="text" 
                              value={branchEditForm.email}
                              onChange={e => setBranchEditForm({...branchEditForm, email: e.target.value})}
                              className="w-full px-2 py-1.5 text-[11px] border rounded bg-white"
                              placeholder="이메일 주소 입력"
                            />
                          </div>
                        ) : (
                          <div className="flex justify-between items-center group">
                            <p className="text-[11px] text-slate-600 font-medium truncate pr-2">{info.account}</p>
                            <button 
                              onClick={() => copyToClipboard(info.account, `${region} 계좌`)}
                              className="p-1.5 text-slate-400 hover:text-indigo-600 transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <Copy size={12} />
                            </button>
                          </div>
                        )}
                     </div>
                   ))}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'auto' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
              <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-xl shadow-slate-200/50">
                <div className="flex items-center gap-4 mb-8 border-b pb-6">
                  <div className="p-3 bg-amber-50 text-amber-600 rounded-2xl">
                    <BarChart3 size={28} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900 tracking-tight">자동 엑셀 정산 분석기</h2>
                    <p className="text-sm text-slate-500 font-medium">회원 명부가 담긴 엑셀을 업로드하면 지회별 지급액을 자동 산출합니다.</p>
                  </div>
                </div>

                <label className={cn(
                  "relative flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-3xl transition-all cursor-pointer overflow-hidden group mb-8",
                  autoSettlementFile ? "border-amber-400 bg-amber-50/20" : "border-slate-300 bg-slate-50 hover:border-amber-400 hover:bg-amber-50/10"
                )}>
                  <input type="file" className="hidden" accept=".xlsx, .xls" onChange={handleAutoSettlementUpload} />
                  {autoSettlementFile ? (
                    <div className="text-center px-6">
                        <Receipt className="mx-auto mb-3 text-amber-500" size={40} />
                        <p className="text-sm font-bold text-slate-900">{autoSettlementFile.name}</p>
                        <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mt-1">분석 완료 • 정산 데이터 생성됨</p>
                    </div>
                  ) : (
                    <div className="text-center">
                        <FileUp className="mx-auto mb-3 text-slate-300 group-hover:text-amber-400 transition-colors" size={40} />
                        <p className="text-sm font-bold text-slate-900">정산용 엑셀 파일을 업로드하세요</p>
                        <p className="text-xs text-slate-400 mt-1">회원구분(지역) 열이 포함된 원본 데이터</p>
                    </div>
                  )}
                </label>

                {autoSettlementData && (
                  <div className="space-y-6">
                    <div className="p-6 bg-slate-50 rounded-3xl border border-slate-200 mb-6 space-y-4">
                       <label className="text-sm font-bold text-slate-700 flex items-center justify-between">
                          <span>정산 기간 설정</span>
                          <span className="text-[10px] text-amber-600 font-bold uppercase tracking-widest">Settlement Period</span>
                       </label>
                       <div className="relative group">
                          <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-amber-400 transition-colors" size={18} />
                          <input 
                            type="text"
                            value={autoPeriod}
                            onChange={(e) => setAutoPeriod(e.target.value)}
                            placeholder="예: 2026년 2분기"
                            className="w-full pl-12 pr-6 py-4 bg-white border border-slate-200 rounded-2xl font-bold text-lg focus:ring-4 focus:ring-amber-50 focus:border-amber-400 transition-all outline-none"
                          />
                       </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                       {autoSettlementData.results.map(r => (
                         <div key={r.region} className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                            <div className="flex justify-between items-center mb-2">
                               <span className="text-xs font-bold text-slate-700">{r.region}</span>
                               <span className="text-[10px] font-bold text-slate-400">{r.count}명</span>
                            </div>
                            <div className="text-lg font-black text-slate-900">
                               {r.finalPayment === 0 ? r.afterHq.toLocaleString() : r.finalPayment.toLocaleString()}원
                            </div>
                         </div>
                       ))}
                    </div>

                    <div className="p-8 bg-amber-600 rounded-3xl text-white shadow-xl shadow-amber-200 flex flex-col md:flex-row justify-between items-center gap-6">
                       <div className="space-y-1 text-center md:text-left">
                          <p className="text-xs font-bold text-amber-100 uppercase tracking-widest">전체 총 지출 (지회 지급 + 지부 수익)</p>
                          <p className="text-4xl font-black">{autoSettlementData.totalDistributed.toLocaleString()}원</p>
                       </div>
                       <div className="h-px w-full md:h-12 md:w-px bg-white/20" />
                       <div className="space-y-1 text-center md:text-right">
                          <p className="text-xs font-bold text-amber-100 uppercase tracking-widest">경북지부 최종 이익 합계</p>
                          <p className="text-3xl font-black text-amber-200">{autoSettlementData.totalGyeongbukIncome.toLocaleString()}원</p>
                       </div>
                    </div>

                    <button 
                      onClick={() => addToHistory(autoSettlementData, autoPeriod)}
                      className="w-full py-5 bg-amber-600 text-white rounded-3xl font-black text-xl shadow-xl shadow-amber-100 hover:bg-amber-700 transition-all active:scale-95 flex items-center justify-center gap-3"
                    >
                        <History size={24} /> 정산 데이터를 대시보드에 반영
                    </button>

                    {/* Branch Account Info for Auto */}
                    <div className="bg-slate-50 p-6 rounded-3xl border border-slate-200">
                      <h3 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
                        <Database size={16} className="text-amber-600" /> 지회별 송금 정보
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {(Object.entries(branchInfo) as [string, { account: string, email: string }][]).map(([region, info]) => (
                          <div key={region} className="p-3 bg-white rounded-xl border border-slate-100 flex justify-between items-center">
                              <div className="space-y-1">
                                <p className="text-xs font-bold text-slate-900">{region}지회</p>
                                <p className="text-[10px] text-slate-500">{info.account}</p>
                              </div>
                              <button 
                                onClick={() => copyToClipboard(info.account, `${region} 계좌`)}
                                className="p-2 text-slate-400 hover:text-amber-600 transition-colors"
                              >
                                <Copy size={14} />
                              </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === 'dashboard' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
              <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-xl shadow-slate-200/50">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8 border-b pb-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
                      <History size={28} />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-slate-900 tracking-tight">정산 데이터 히스토리</h2>
                      <p className="text-sm text-slate-500 font-medium">과거 분담금 지급 내역을 한눈에 파악하고 관리합니다.</p>
                    </div>
                  </div>
                  
                  <div className="relative w-full md:w-80">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input 
                      type="text"
                      placeholder="기간, 분기, 지역명 검색..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:bg-white focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 transition-all outline-none"
                    />
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50/50">
                        <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b">기간 (분기)</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b text-right">합계 (원)</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b text-right">경북지부</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b text-right">구미지회</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b text-right">상주지회</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b text-right">경주지회</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b text-center">관리</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredHistory.map((entry) => (
                        <tr key={entry.id} className="group hover:bg-slate-50/80 transition-colors">
                          <td className="px-6 py-5 border-b border-slate-100">
                             <div className="flex items-center gap-2">
                               <Calendar size={14} className="text-slate-400" />
                               {editingId === entry.id ? (
                                 <input 
                                   type="text"
                                   className="bg-white border rounded px-2 py-1 text-sm font-bold w-full"
                                   value={editForm?.period}
                                   onChange={e => setEditForm(prev => prev ? { ...prev, period: e.target.value } : null)}
                                 />
                               ) : (
                                 <span className="text-sm font-bold text-slate-900">{entry.period}</span>
                               )}
                             </div>
                          </td>
                          <td className="px-6 py-5 border-b border-slate-100 text-right">
                             {editingId === entry.id ? (
                               <input 
                                 type="number"
                                 className="bg-white border rounded px-2 py-1 text-sm font-black text-indigo-600 w-24 text-right"
                                 value={editForm?.total}
                                 onChange={e => setEditForm(prev => prev ? { ...prev, total: parseInt(e.target.value) || 0 } : null)}
                               />
                             ) : (
                               <span className="text-sm font-black text-indigo-600">{entry.total.toLocaleString()}</span>
                             )}
                          </td>
                          <td className="px-6 py-5 border-b border-slate-100 text-right">
                             {editingId === entry.id ? (
                               <input 
                                 type="number"
                                 className="bg-white border rounded px-2 py-1 text-sm font-medium text-slate-600 w-24 text-right"
                                 value={editForm?.gyeongbuk}
                                 onChange={e => setEditForm(prev => prev ? { ...prev, gyeongbuk: parseInt(e.target.value) || 0 } : null)}
                               />
                             ) : (
                               <span className="text-sm font-medium text-slate-600">{entry.gyeongbuk.toLocaleString()}</span>
                             )}
                          </td>
                          <td className="px-6 py-5 border-b border-slate-100 text-right">
                             {editingId === entry.id ? (
                               <input 
                                 type="number"
                                 className="bg-white border rounded px-2 py-1 text-sm font-medium text-slate-600 w-24 text-right"
                                 value={editForm?.gumi}
                                 onChange={e => setEditForm(prev => prev ? { ...prev, gumi: parseInt(e.target.value) || 0 } : null)}
                               />
                             ) : (
                               <span className="text-sm font-medium text-slate-600">{entry.gumi.toLocaleString()}</span>
                             )}
                          </td>
                          <td className="px-6 py-5 border-b border-slate-100 text-right">
                             {editingId === entry.id ? (
                               <input 
                                 type="number"
                                 className="bg-white border rounded px-2 py-1 text-sm font-medium text-slate-600 w-24 text-right"
                                 value={editForm?.sangju}
                                 onChange={e => setEditForm(prev => prev ? { ...prev, sangju: parseInt(e.target.value) || 0 } : null)}
                               />
                             ) : (
                               <span className="text-sm font-medium text-slate-600">{entry.sangju.toLocaleString()}</span>
                             )}
                          </td>
                          <td className="px-6 py-5 border-b border-slate-100 text-right">
                             {editingId === entry.id ? (
                               <input 
                                 type="number"
                                 className="bg-white border rounded px-2 py-1 text-sm font-medium text-slate-600 w-24 text-right"
                                 value={editForm?.gyeongju}
                                 onChange={e => setEditForm(prev => prev ? { ...prev, gyeongju: parseInt(e.target.value) || 0 } : null)}
                               />
                             ) : (
                               <span className="text-sm font-medium text-slate-600">{entry.gyeongju.toLocaleString()}</span>
                             )}
                          </td>
                          <td className="px-6 py-5 border-b border-slate-100">
                             <div className="flex justify-center gap-2">
                               {editingId === entry.id ? (
                                 <>
                                   <button onClick={saveEdit} className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors" title="저장">
                                     <Save size={16} />
                                   </button>
                                   <button onClick={cancelEditing} className="p-2 text-slate-400 hover:bg-slate-100 rounded-lg transition-colors" title="취소">
                                     <X size={16} />
                                   </button>
                                 </>
                               ) : (
                                 <>
                                   <button onClick={() => startEditing(entry)} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="수정">
                                     <Edit3 size={16} />
                                   </button>
                                   <button 
                                     onClick={() => deleteHistoryEntry(entry.id)} 
                                     className={cn(
                                       "p-2 rounded-lg transition-colors",
                                       isDeletingId === entry.id ? "text-slate-300 animate-pulse" : "text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                                     )} 
                                     disabled={isDeletingId === entry.id}
                                     title="삭제"
                                   >
                                     {isDeletingId === entry.id ? (
                                       <div className="w-4 h-4 border-2 border-slate-300 border-t-rose-500 rounded-full animate-spin" />
                                     ) : (
                                       <Trash2 size={16} />
                                     )}
                                   </button>
                                 </>
                               )}
                             </div>
                          </td>
                        </tr>
                      ))}
                      {filteredHistory.length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-6 py-20 text-center text-slate-400">
                             <div className="flex flex-col items-center gap-3">
                                <Search size={32} className="opacity-20" />
                                <p className="text-sm font-medium">검색 결과가 없습니다.</p>
                             </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Trend Summary Cards */}
                <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-4">
                   <div className="p-4 bg-slate-900 rounded-2xl text-white relative overflow-hidden flex items-center justify-between">
                      <div className="relative z-10">
                        <p className="text-[9px] font-bold text-indigo-300 uppercase tracking-widest mb-0.5">평균 분기 수입</p>
                        <p className="text-lg font-black leading-none">
                          {history.length > 0 ? Math.round(history.reduce((acc, curr) => acc + curr.total, 0) / history.length).toLocaleString() : 0}원
                        </p>
                      </div>
                      <TrendingUp className="text-white/5 w-12 h-12" />
                   </div>
                   <div className="p-4 bg-indigo-600 rounded-2xl text-white relative overflow-hidden flex items-center justify-between">
                      <div className="relative z-10">
                        <p className="text-[9px] font-bold text-indigo-100 uppercase tracking-widest mb-0.5">최근 정산일</p>
                        <p className="text-lg font-black leading-none">
                          {history.length > 0 ? new Date(history[0].createdat).toLocaleDateString().replace(/\.$/, '') : "-"}
                        </p>
                      </div>
                      <Users className="text-white/5 w-12 h-12" />
                   </div>
                   <div className="p-4 bg-white rounded-2xl border border-slate-200 relative overflow-hidden flex items-center justify-between">
                      <div className="relative z-10">
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">총 누적 정산액</p>
                        <p className="text-lg font-black text-slate-900 leading-none">
                          {history.reduce((acc, curr) => acc + curr.total, 0).toLocaleString()}원
                        </p>
                      </div>
                      <BarChart3 className="text-slate-50 w-12 h-12" />
                   </div>
                </div>
              </div>
            </motion.div>
          )}

        </div>

        {/* Right Column: Console & Status (Always Visible) */}
        <div className="lg:col-span-12 xl:col-span-4 space-y-6">
          
          <div className="bg-slate-900 rounded-2xl p-6 shadow-2xl flex flex-col h-[500px] border border-slate-800">
            <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2 text-indigo-400">
                <Terminal size={16} />
                <span className="text-[10px] font-bold uppercase tracking-[0.2em]">Process Console v2.0</span>
              </div>
              <div className="flex gap-1.5 font-mono text-[9px] text-slate-500 font-bold">
                SRDS-PRO
              </div>
            </div>

            <div 
              ref={scrollRef}
              className="flex-1 overflow-y-auto space-y-2 console-text pr-2 custom-scrollbar"
            >
              {logs.length === 0 ? (
                <div className="text-slate-600 h-full flex flex-col items-center justify-center text-center px-8 gap-4">
                  <div className="p-4 bg-slate-800/50 rounded-full">
                    <Database size={32} className="text-slate-700" />
                  </div>
                  <p className="text-[10px] font-medium leading-relaxed">준비 완료. 첨부파일 분석 및<br/>자동화 프로세스 대기 중...</p>
                </div>
              ) : (
                logs.map((log, i) => (
                  <div key={i} className="flex gap-2 leading-relaxed">
                    <span className="text-[9px] text-slate-600 mt-0.5 tabular-nums flex-shrink-0 font-bold">[{log.timestamp}]</span>
                    <span className={cn(
                      "flex-1 break-all text-[10px]",
                      log.type === 'error' ? 'text-rose-400' : 
                      log.type === 'success' ? 'text-emerald-400' : 'text-slate-300'
                    )}>
                      {log.message}
                    </span>
                  </div>
                ))
              )}
              {isProcessing && (
                <div className="flex gap-3 animate-pulse">
                   <span className="text-[10px] text-slate-600 mt-1 tabular-nums font-bold">WORKING</span>
                   <span className="text-indigo-400">지회별 데이터 필터링 및 시트명 생성 중...</span>
                </div>
              )}
            </div>
          </div>

          {/* AI Error Diagnosis Card */}
          <AnimatePresence>
            {errorDiagnosis && (
              <motion.div 
                initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
                className="glass p-5 rounded-2xl border-rose-200 bg-rose-50/50"
              >
                <div className="flex items-start gap-4">
                  <div className="p-2 bg-rose-100 text-rose-600 rounded-lg">
                    <AlertCircle size={20} />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-sm font-bold text-rose-900">지능형 오류 진단 결과</h3>
                    <p className="text-sm text-rose-800 leading-relaxed font-medium">{errorDiagnosis.diagnosis}</p>
                    <div className="pt-2 flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold text-rose-500 uppercase tracking-wider bg-rose-100/50 w-max px-1.5 py-0.5 rounded">Action Item</span>
                      <p className="text-sm text-rose-950 font-bold">💡 {errorDiagnosis.solution}</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Success Statistics */}
          <AnimatePresence>
            {results && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="bg-emerald-50 border border-emerald-100 rounded-2xl p-6"
              >
                <div className="flex items-center justify-between mb-4 border-b border-emerald-100 pb-3">
                  <h3 className="text-sm font-bold text-emerald-900 flex items-center gap-2">
                    <Download size={16} />
                    다운로드 리스트 ({results.length}건)
                  </h3>
                  <div className="text-[10px] font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full uppercase">Ready</div>
                </div>
                <div className="space-y-4">
                  {results.slice(0, 6).map(res => (
                    <div key={res.region} className="bg-white p-3 rounded-xl border border-emerald-100 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-emerald-400" />
                          <span className="text-xs font-bold text-slate-800">{res.region}지회</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 size={12} className="text-emerald-500" />
                          <span className="text-[10px] font-bold text-emerald-600 uppercase">Verified</span>
                        </div>
                      </div>
                      
                      <div className="bg-slate-50 rounded-lg overflow-hidden border border-slate-100">
                        <table className="w-full text-left text-[10px]">
                          <thead className="bg-slate-100/50 border-b border-slate-200">
                            <tr>
                              <th className="px-2 py-1.5 font-bold text-slate-500">시트명</th>
                              <th className="px-2 py-1.5 font-bold text-slate-500 text-right">원본</th>
                              <th className="px-2 py-1.5 font-bold text-emerald-600 text-right">추출</th>
                            </tr>
                          </thead>
                          <tbody>
                            {res.validation.map((v, idx) => (
                              <tr key={idx} className="border-b border-slate-100 last:border-0 hover:bg-white transition-colors">
                                <td className="px-2 py-1.5 text-slate-600 font-medium">{v.sheetName}</td>
                                <td className="px-2 py-1.5 text-slate-400 text-right">{v.originalCount}</td>
                                <td className="px-2 py-1.5 text-emerald-600 font-bold text-right">{v.resultCount}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot className="bg-emerald-50/30">
                            <tr>
                              <td className="px-2 py-1.5 font-bold text-emerald-700">합계</td>
                              <td colSpan={2} className="px-2 py-1.5 text-right font-black text-emerald-600">
                                {res.validation.reduce((acc, v) => acc + (v.resultCount || 0), 0)}명
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  ))}
                  {results.length > 6 && (
                    <p className="text-[10px] text-center text-slate-500 font-bold pt-2 border-t border-emerald-100/50 uppercase tracking-widest">
                      And {results.length - 6} more regional files verified and generated
                    </p>
                  )}
                </div>

                <div className="pt-6 mt-4 border-t border-emerald-100">
                   <button 
                     onClick={handleReflectToSettlement}
                     className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black text-sm shadow-xl shadow-emerald-100 hover:bg-emerald-700 transition-all active:scale-95 flex items-center justify-center gap-2"
                   >
                      <TrendingUp size={18} /> 정산 메뉴에 결과 반영하기
                   </button>
                   <p className="text-[10px] text-emerald-600 font-bold text-center mt-3 uppercase tracking-tighter">
                     분리된 인원 데이터를 정산 계산기에 자동 입력합니다
                   </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </div>

        {/* Bottom Section: Email Tools */}
        <AnimatePresence>
          {results && results.length > 0 && (
            <motion.section 
              initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }}
              className="lg:col-span-12 space-y-6 pt-12"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-bold shadow-lg shadow-indigo-100">3</div>
                <div>
                  <h2 className="font-bold text-xl text-slate-900 tracking-tight">협회 소통 도구 (이메일 및 문자 발송)</h2>
                  <p className="text-sm text-slate-500 font-medium">분리된 파일을 지회에 안내할 때 사용할 수 있는 표준 문구입니다.</p>
                </div>
              </div>

              <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-2xl shadow-indigo-100/50">
                <div className="flex border-b overflow-x-auto scrollbar-hide bg-slate-50/80 p-2 gap-1">
                  {results.map(res => (
                    <button
                      key={res.region}
                      onClick={() => setActiveEmailRegion(res.region)}
                      className={cn(
                        "px-6 py-3 text-xs font-bold whitespace-nowrap transition-all rounded-xl",
                        activeEmailRegion === res.region 
                          ? "text-indigo-600 bg-white shadow-sm ring-1 ring-slate-200" 
                          : "text-slate-500 hover:text-slate-700 hover:bg-white/50"
                      )}
                    >
                      {res.region}
                    </button>
                  ))}
                </div>

                <div className="p-8">
                  {activeEmailRegion ? (
                    <div className="space-y-8">
                      {/* Message Type Tabs */}
                      <div className="flex gap-4 p-1 bg-slate-100 rounded-2xl w-max border border-slate-200">
                        <button 
                          onClick={() => setActiveMessageType('mail')}
                          className={cn(
                            "flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all",
                            activeMessageType === 'mail' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                          )}
                        >
                          <Mail size={16} /> 이메일 문구
                        </button>
                        <button 
                          onClick={() => setActiveMessageType('sms')}
                          className={cn(
                            "flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all",
                            activeMessageType === 'sms' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                          )}
                        >
                          <MessageSquare size={16} /> SMS/문자 문구
                        </button>
                      </div>

                      <div className="flex flex-col md:flex-row md:items-end gap-6 p-6 bg-indigo-50/50 rounded-2xl border border-indigo-100">
                        <div className="flex-1 space-y-2">
                          <label className="text-xs font-bold text-indigo-900 flex items-center gap-2">
                            <Settings size={14} /> 맞춤 문구 생성 요구사항 (선택사항)
                          </label>
                          <textarea 
                            value={customRequirement}
                            onChange={(e) => setCustomRequirement(e.target.value)}
                            placeholder="예: '이번에는 행사 안내도 같이 넣어줘', '더 격발한 어조로 바꿔줘' 등"
                            className="w-full h-20 p-3 bg-white border border-indigo-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all resize-none"
                          />
                        </div>
                        <button 
                          onClick={handleDraftRegenerate}
                          disabled={!customRequirement || isGeneratingDraft}
                          className="px-6 py-4 bg-indigo-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-50 disabled:grayscale transition-all flex items-center gap-2"
                        >
                          {isGeneratingDraft ? (
                            <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                          ) : <Play size={16} fill="currentColor" />}
                          AI 문구 재생성
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                        {activeMessageType === 'mail' ? (
                          <>
                            <div className="space-y-4">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] bg-slate-100 px-2 py-1 rounded">Subject</span>
                                <button 
                                  onClick={() => copyToClipboard(getActiveDraft(activeEmailRegion).title, '제목')}
                                  className="text-xs text-indigo-600 font-bold flex items-center gap-1.5 hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors border border-indigo-100"
                                >
                                  <Copy size={12} /> 제목 복사
                                </button>
                              </div>
                              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-base font-bold text-slate-800 leading-snug">
                                {getActiveDraft(activeEmailRegion).title}
                              </div>
                              <div className="mt-8 p-4 bg-indigo-50/50 rounded-2xl border border-indigo-100">
                                <h4 className="text-xs font-bold text-indigo-900 mb-2 flex items-center gap-2">
                                   <Filter size={14} /> 작성 팁
                                </h4>
                                <ul className="text-xs text-indigo-800/80 space-y-1 font-medium list-disc ml-4">
                                  <li>방금 다운로드된 <b>{activeEmailRegion}</b> 전용 파일을 첨부하세요.</li>
                                  <li>지회별 인원수 통계에 따라 수납액을 다시 확인해 주세요.</li>
                                </ul>
                              </div>
                            </div>

                            <div className="space-y-4">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] bg-slate-100 px-2 py-1 rounded">Body Content</span>
                                <button 
                                  onClick={() => copyToClipboard(getActiveDraft(activeEmailRegion).body, '본문')}
                                  className="text-xs text-indigo-600 font-bold flex items-center gap-1.5 hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors border border-indigo-100"
                                >
                                  <Copy size={12} /> 본문 전체 복사
                                </button>
                              </div>
                              <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed min-h-[350px] font-medium shadow-inner shadow-slate-200/20">
                                {getActiveDraft(activeEmailRegion).body}
                              </div>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="space-y-4">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] bg-slate-100 px-2 py-1 rounded">SMS / MMS</span>
                                <button 
                                  onClick={() => copyToClipboard(getActiveDraft(activeEmailRegion).body, '문자 내용')}
                                  className="text-xs text-indigo-600 font-bold flex items-center gap-1.5 hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors border border-indigo-100"
                                >
                                  <Copy size={12} /> 내용 복사
                                </button>
                              </div>
                              <div className="bg-slate-900 p-6 rounded-3xl border border-slate-700 text-sm text-emerald-400 whitespace-pre-wrap leading-relaxed min-h-[250px] font-mono shadow-2xl relative overflow-hidden">
                                <div className="absolute top-0 left-0 w-full h-1 bg-indigo-500" />
                                {getActiveDraft(activeEmailRegion).body}
                              </div>
                            </div>
                            <div className="space-y-4 flex flex-col justify-center">
                              <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200">
                                <h4 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                                  <MessageSquare className="text-indigo-600" size={18} /> 문자 발송 가이드
                                </h4>
                                <p className="text-xs text-slate-600 leading-relaxed font-medium">
                                  • 이메일 발송 직후 지회 담당자에게 알림용으로 발송하세요.<br/>
                                  • [경북평생교육사협회] 머리말을 유지하여 신뢰도를 높이세요.<br/>
                                  • 스마트폰 테더링이나 협회 문자 발송 시스템을 활용해 한번에 복사해서 사용하세요.
                                </p>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-20 text-slate-300 gap-6">
                      <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center border border-slate-100">
                        <Mail size={40} strokeWidth={1} />
                      </div>
                      <div className="text-center">
                        <p className="text-base font-bold text-slate-400">지회를 선택해주세요</p>
                        <p className="text-sm font-medium mt-1">해당 지회명에 맞춘 개인화된 메일 문구가 생성됩니다.</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

      </main>
      
      {/* Footer Info */}
      <footer className="max-w-6xl mx-auto px-6 mt-20 pt-12 border-t border-slate-200">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 text-center md:text-left">
          <div className="space-y-3">
            <div className="flex items-center justify-center md:justify-start gap-2 text-indigo-600 font-bold text-sm">
              <div className="p-1.5 bg-indigo-50 rounded-lg"><Users size={16} /></div>
              <span>PRD 준수 데이터 관리</span>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed font-medium">
              통합 시트에서 '회원구분' 열을 기준으로 데이터를 추출하고, 각 지회별로 독립된 워크북 파일을 자동 생성합니다.
            </p>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-center md:justify-start gap-2 text-indigo-600 font-bold text-sm">
              <div className="p-1.5 bg-indigo-100/50 rounded-lg"><Filter size={16} /></div>
              <span>Multi-Sheet 필터링</span>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed font-medium">
              1월, 2월, 3월 등 파일 내 모든 시트를 순회하며 지정된 지역의 행만 골라내어 구조를 보존한 채 분리합니다.
            </p>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-center md:justify-start gap-2 text-indigo-600 font-bold text-sm">
              <div className="p-1.5 bg-indigo-100/50 rounded-lg"><CheckCircle2 size={16} /></div>
              <span>자동 시트명 업데이트</span>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed font-medium">
              필터링된 결과값에 따라 인원수를 계산하여 '1월 결제내역(12명)'과 같이 시트 이름을 자동 갱신합니다.
            </p>
          </div>
        </div>
        <div className="mt-12 pt-8 border-t border-slate-100 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-loose">
            © 2026 SRDS PRO • Built for Association Administration Efficiency
          </p>
          <div className="flex gap-4">
            <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1"><Terminal size={10} /> v2.4.0</span>
            <span className="text-[10px] font-bold text-indigo-500 flex items-center gap-1 uppercase tracking-tighter">Powered by Gemini 3.0</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
