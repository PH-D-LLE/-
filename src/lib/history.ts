
export interface SettlementHistoryEntry {
  id: string;
  period: string;
  total: number;
  gyeongbuk: number;
  gumi: number;
  sangju: number;
  gyeongju: number;
  createdAt: string;
}

export const MOCK_HISTORY: SettlementHistoryEntry[] = [];
