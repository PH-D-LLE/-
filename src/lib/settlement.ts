
export interface SettlementResult {
  region: string;
  count: number;
  revenue: number;
  hqShare: number;
  afterHq: number;
  branchFeeToParent: number;
  finalPayment: number;
}

export interface SettlementTotal {
  results: SettlementResult[];
  totalGyeongbukIncome: number;
  totalDistributed: number;
}

export const SETTLEMENT_CONFIG = {
  MEMBERSHIP_FEE: 10000,
  CMS_FEE: 500,
  HQ_SHARE_RATE: 0.3,
  BRANCH_SHARE_RATE: 0.2,
};

export const BRANCH_INFO = {
  '구미': { account: "농협 351-1137-4503-53", email: "theknock_official@naver.com" },
  '상주': { account: "농협 351-1309-5216-73", email: "sangjups0831@naver.com" },
  '경주': { account: "농협 351-1399-6043-23", email: "gyeongju0831@naver.com" },
  '경북': { account: "농협 301-0124-1714-31", email: "gbale0217@naver.com" },
};

export function calculateSettlement(counts: Record<string, number>): SettlementTotal {
  const { MEMBERSHIP_FEE, CMS_FEE, HQ_SHARE_RATE, BRANCH_SHARE_RATE } = SETTLEMENT_CONFIG;
  
  const results: SettlementResult[] = [];
  let totalParentIncome = 0;
  let totalDistributedAcrossAll = 0;

  // We process branches first, then Gyeongbuk
  const regions = Object.keys(counts);
  
  regions.forEach(region => {
    const count = counts[region] || 0;
    const revenue = count * (MEMBERSHIP_FEE - CMS_FEE);
    const hqShare = revenue * HQ_SHARE_RATE;
    const afterHq = revenue - hqShare;
    
    let branchFeeToParent = 0;
    let finalPayment = 0;

    if (region !== '경북') {
      branchFeeToParent = afterHq * BRANCH_SHARE_RATE;
      finalPayment = afterHq - branchFeeToParent;
      totalParentIncome += branchFeeToParent;
    } else {
      // Gyeongbuk (Parent) keeps its own afterHq fully, PLUS the branch fees collected above
      finalPayment = 0; // It's the receiver, not paid out like a sub-branch
      totalParentIncome += afterHq;
    }

    results.push({
      region,
      count,
      revenue,
      hqShare,
      afterHq,
      branchFeeToParent,
      finalPayment
    });

    totalDistributedAcrossAll += afterHq;
  });

  return {
    results,
    totalGyeongbukIncome: totalParentIncome,
    totalDistributed: totalDistributedAcrossAll
  };
}
