'use strict';

const option = (id, title, description, effects, conditionalEffect = null) => ({
  id, title, description, effects, conditionalEffect,
});

const cond = (stat, operator, value, effects, description) => ({
  stat, operator, value, effects, description,
});

const EVENTS = [
  {
    id: 'E01', stage: 'EARLY', title: '員工要求加薪',
    description: '匿名問卷意外變成聯署書，全公司都在等管理層表態。',
    options: [
      option('A', '全面加薪', '錢包受傷，但大家重新相信明天。', { money: -15, morale: 18, risk: -5 }),
      option('B', '發一次性獎金', '先把今天撐過去，明天的問題交給明天。', { money: -8, morale: 8, risk: 2 }),
      option('C', '拒絕並發勵志信', '成本最低，信件主旨是「我們是一家人」。', { money: 3, morale: -12, risk: 10 }, cond('morale', '<', 40, { risk: 10 }, '若事件開始時 Morale < 40，Risk 額外 +10。')),
    ],
  },
  {
    id: 'E02', stage: 'EARLY', title: '大客戶施壓',
    description: '最大客戶要求週一交付；今天是週五，而且他們剛改完需求。',
    options: [
      option('A', '全員加班硬做', '守住營收，燃燒同事。', { money: 12, morale: -12, risk: 7 }),
      option('B', '延期換品質', '承受違約金，保住團隊與品質。', { money: -9, morale: 5, risk: -7 }),
      option('C', '砍掉一半功能', '按時交付一個看起來像完成品的東西。', { money: 6, morale: -3, risk: 12 }),
    ],
  },
  {
    id: 'E03', stage: 'EARLY', title: '網紅炎上',
    description: '合作網紅的十年前貼文被翻出來，公司 Logo 正在熱搜第一名。',
    options: [
      option('A', '立即切割', '止血很快，合約賠償也很快。', { money: -10, morale: 3, risk: -10 }),
      option('B', '共同道歉', '一起站上記者會，至少姿勢整齊。', { money: -5, morale: -3, risk: -5 }),
      option('C', '當作沒看見', '希望網路記憶只有七秒。', { money: 4, morale: -8, risk: 14 }, cond('risk', '>=', 35, { money: -6 }, '若事件開始時 Risk ≥ 35，Money 額外 -6。')),
    ],
  },
  {
    id: 'E04', stage: 'EARLY', title: '競爭對手挖角',
    description: '對手公司開出豪華條件，茶水間突然安靜得很專業。',
    options: [
      option('A', '全面留才方案', '加薪、升職、椅子也換人體工學。', { money: -12, morale: 14, risk: -4 }),
      option('B', '只留核心員工', '效率優先，但每個人都開始猜誰是核心。', { money: -5, morale: -7, risk: 2 }),
      option('C', '祝大家前程似錦', '節省成本，也節省了很多員工。', { money: 8, morale: -13, risk: 10 }),
    ],
  },
  {
    id: 'E05', stage: 'EARLY', title: '辦公室搬遷',
    description: '租約到期，新辦公室的優點是便宜，缺點是需要兩次轉車和一次信仰。',
    options: [
      option('A', '搬去郊區', '租金下降，通勤時間上升。', { money: 12, morale: -11, risk: 2 }),
      option('B', '續租市中心', '地點完美，財務部眼神空洞。', { money: -13, morale: 9, risk: -2 }),
      option('C', '全面遠端', '省空間，但協作開始依賴貼圖。', { money: 7, morale: 3, risk: 9 }),
    ],
  },
  {
    id: 'E06', stage: 'EARLY', title: '新產品延期',
    description: '發布會已訂場地，產品卻還在「差最後一點」。',
    options: [
      option('A', '誠實延期', '承認現實，換取品質。', { money: -8, morale: 6, risk: -8 }),
      option('B', '先上測試版', '把所有客戶都變成測試人員。', { money: 8, morale: -4, risk: 11 }),
      option('C', '熬夜完成', '日期守住了，靈魂不一定。', { money: 4, morale: -13, risk: 5 }),
    ],
  },
  {
    id: 'M01', stage: 'MID', title: '廣告活動翻車',
    description: '新標語在另一種語言裡有非常不適合董事會知道的意思。',
    options: [
      option('A', '全面撤換素材', '昂貴但乾淨。', { money: -16, morale: 4, risk: -14 }),
      option('B', '自嘲式危機行銷', '把事故包裝成個性。', { money: 9, morale: 7, risk: 11 }),
      option('C', '怪罪外包商', '短期切割，長期沒人想接案。', { money: -4, morale: -8, risk: 7 }),
    ],
  },
  {
    id: 'M02', stage: 'MID', title: '系統故障',
    description: '核心系統全線停機，IT 說「很奇怪，我這邊可以」。',
    options: [
      option('A', '高價請外援', '專家按下那顆大家都不敢按的按鈕。', { money: -18, morale: 4, risk: -15 }),
      option('B', '內部搶修', '省錢，但全公司一起看進度條。', { money: -6, morale: -10, risk: 8 }, cond('risk', '>=', 50, { money: -10 }, '若事件開始時 Risk ≥ 50，Money 額外 -10。')),
      option('C', '暫時手工作業', 'Excel 成為新的核心系統。', { money: -10, morale: -6, risk: -3 }),
    ],
  },
  {
    id: 'M03', stage: 'MID', title: '投資人要求成長',
    description: '投資人希望下季成長三倍，理由是簡報上的箭頭畫得很高。',
    options: [
      option('A', '大舉投放廣告', '花錢換速度，也換來更多注意。', { money: -17, morale: 16, risk: 5 }),
      option('B', '穩健成長', '數字普通，但睡眠品質上升。', { money: 6, morale: 6, risk: -8 }),
      option('C', '美化預測數字', '試算表很漂亮，現實稍後處理。', { money: 12, morale: -5, risk: 18 }),
    ],
  },
  {
    id: 'M04', stage: 'MID', title: '核心主管離職',
    description: '核心主管寄出告別信，副本包含全公司與幾位獵頭。',
    options: [
      option('A', '重金慰留', '忠誠可以衡量，單位是月薪。', { money: -18, morale: 12, risk: -6 }),
      option('B', '內部升遷', '給新人機會，也給新人壓力。', { money: -7, morale: 9, risk: 8 }),
      option('C', '暫不補人', '組織變扁平，工作變立體。', { money: 10, morale: -16, risk: 10 }, cond('morale', '<', 40, { risk: 10 }, '若事件開始時 Morale < 40，Risk 額外 +10。')),
    ],
  },
  {
    id: 'M05', stage: 'MID', title: '客戶資料疑似外洩',
    description: '一份客戶名單出現在不該出現的論壇，檔名還叫 final_final2。',
    options: [
      option('A', '主動通報並補救', '昂貴、尷尬，但負責。', { money: -17, morale: 6, risk: -18 }),
      option('B', '先內部調查', '爭取時間，同時祈禱。', { money: -8, morale: -4, risk: 6 }),
      option('C', '否認與公司有關', '賭沒人看得懂浮水印。', { money: 7, morale: -9, risk: 20 }),
    ],
  },
  {
    id: 'M06', stage: 'MID', title: '大型合作機會',
    description: '國際品牌提出合作，合約有 83 頁，對方說都是標準條款。',
    options: [
      option('A', '全力投入', '高成本換高回報。', { money: 17, morale: -11, risk: 13 }),
      option('B', '小規模試辦', '收益有限，風險也有限。', { money: 8, morale: 3, risk: 4 }),
      option('C', '拒絕合作', '保住節奏，但錯過舞台。', { money: -6, morale: 10, risk: -7 }),
    ],
  },
  {
    id: 'L01', stage: 'LATE', title: '員工過勞',
    description: '辦公室咖啡機提出工傷申請，員工看起來也想一起簽。',
    options: [
      option('A', '全公司休整', '暫停營收，先救人。', { money: -22, morale: 24, risk: -12 }),
      option('B', '加發津貼繼續拚', '疲勞被換算成現金。', { money: -14, morale: 8, risk: 10 }),
      option('C', '舉辦抗壓講座', '要求過勞的人準時參加兩小時課程。', { money: -5, morale: -20, risk: 14 }, cond('morale', '<', 35, { risk: 10 }, '若事件開始時 Morale < 35，Risk 額外 +10。')),
    ],
  },
  {
    id: 'L02', stage: 'LATE', title: '公司尾牙預算',
    description: '大家期待尾牙，財務只期待大家不要期待。',
    options: [
      option('A', '豪華舉辦', '士氣起飛，資金降落。', { money: -24, morale: 22, risk: -5 }),
      option('B', '辦公室自助餐', '不驚喜，也不驚嚇。', { money: -10, morale: 8, risk: 1 }),
      option('C', '取消並寄感謝信', '感謝很滿，餐桌很空。', { money: 8, morale: -18, risk: 10 }),
    ],
  },
  {
    id: 'L03', stage: 'LATE', title: '新市場擴張',
    description: '顧問說新市場潛力無限；附件裡沒有提到成本也無限。',
    options: [
      option('A', '全面進軍', '可能成為傳奇，也可能成為教材。', { money: -20, morale: 10, risk: 18 }),
      option('B', '區域試點', '慢一點，但地圖還看得懂。', { money: -11, morale: 4, risk: 7 }),
      option('C', '暫緩擴張', '現金留下，夢想縮小。', { money: 13, morale: -12, risk: -9 }),
    ],
  },
  {
    id: 'L04', stage: 'LATE', title: '供應商漲價',
    description: '唯一供應商宣布漲價，並祝我們生意興隆。',
    options: [
      option('A', '接受新價格', '穩定供應，穩定失血。', { money: -22, morale: 3, risk: -8 }),
      option('B', '改找低價供應商', '規格看起來差不多，字體也差不多。', { money: 9, morale: -5, risk: 16 }),
      option('C', '自行生產', '昂貴轉型，但命運握在自己手上。', { money: -16, morale: 12, risk: 6 }),
    ],
  },
  {
    id: 'L05', stage: 'LATE', title: '媒體負面報導',
    description: '頭版稱公司文化「像一場沒人能離席的團建」。',
    options: [
      option('A', '公開改革計畫', '承認問題並付出代價。', { money: -18, morale: 18, risk: -16 }),
      option('B', '法律強硬回應', '讓律師和記者一起加班。', { money: -14, morale: -8, risk: 14 }),
      option('C', '製造新話題轉移', '用另一場火蓋住這場火。', { money: -9, morale: -6, risk: 16 }, cond('risk', '>=', 65, { risk: 6 }, '若事件開始時 Risk ≥ 65，Risk 額外 +6。')),
    ],
  },
  {
    id: 'L06', stage: 'LATE', title: '最後一筆大型訂單',
    description: '一筆足以改變公司的訂單來了，交期同樣足以改變人生。',
    options: [
      option('A', '全力接單', '資金大增，所有警報一起亮。', { money: 28, morale: -18, risk: 20 }),
      option('B', '縮小規模承接', '少賺一點，少失眠一點。', { money: 16, morale: -7, risk: 10 }),
      option('C', '拒絕訂單保命', '沒有煙火，也沒有火災。', { money: -12, morale: 14, risk: -15 }),
    ],
  },
];

const MISSIONS = [
  { id: 'S01', text: '最終 Money ≥ 40', type: 'STAT', stat: 'money', operator: '>=', value: 40 },
  { id: 'S02', text: '最終 Money ≥ 50', type: 'STAT', stat: 'money', operator: '>=', value: 50 },
  { id: 'S03', text: '最終 Money ≥ 53', type: 'STAT', stat: 'money', operator: '>=', value: 53 },
  { id: 'S04', text: '最終 Morale ≥ 50', type: 'STAT', stat: 'morale', operator: '>=', value: 50 },
  { id: 'S05', text: '最終 Morale ≥ 60', type: 'STAT', stat: 'morale', operator: '>=', value: 60 },
  { id: 'S06', text: '最終 Morale ≥ 65', type: 'STAT', stat: 'morale', operator: '>=', value: 65 },
  { id: 'S07', text: '最終 Risk ≤ 50', type: 'STAT', stat: 'risk', operator: '<=', value: 50 },
  { id: 'S08', text: '最終 Risk ≤ 55', type: 'STAT', stat: 'risk', operator: '<=', value: 55 },
  { id: 'S09', text: '最終 Risk 介於 45–80（含）', type: 'RANGE', stat: 'risk', min: 45, max: 80 },
  { id: 'S10', text: '最終 Money 介於 25–70（含）', type: 'RANGE', stat: 'money', min: 25, max: 70 },
  { id: 'D01', text: '最終 Money ≥ 35 且 Morale ≥ 45', type: 'ALL_STATS', rules: [{ stat: 'money', operator: '>=', value: 35 }, { stat: 'morale', operator: '>=', value: 45 }] },
  { id: 'D02', text: '最終 Money ≥ 35 且 Risk ≤ 70', type: 'ALL_STATS', rules: [{ stat: 'money', operator: '>=', value: 35 }, { stat: 'risk', operator: '<=', value: 70 }] },
  { id: 'D03', text: '最終 Morale ≥ 45 且 Risk ≤ 65', type: 'ALL_STATS', rules: [{ stat: 'morale', operator: '>=', value: 45 }, { stat: 'risk', operator: '<=', value: 65 }] },
  { id: 'D04', text: '最終 Money ≥ 40 且 Morale ≥ 35', type: 'ALL_STATS', rules: [{ stat: 'money', operator: '>=', value: 40 }, { stat: 'morale', operator: '>=', value: 35 }] },
  { id: 'D05', text: '最終三項數值皆在 15–85（含）', type: 'ALL_RANGE', min: 15, max: 85 },
  { id: 'D06', text: '最終 Money + Morale ≥ 90', type: 'SUM', stats: ['money', 'morale'], operator: '>=', value: 90 },
  { id: 'B01', text: '最後三回合至少兩次投給最終執行方案', type: 'FINAL_CHOICE', rounds: [6, 7, 8], count: 2 },
  { id: 'B02', text: '全場至少三次投給該回合少數選項', type: 'MINORITY', count: 3 },
  {
    id: 'B03',
    text: (count) => `全場至少${count}次投給最終執行方案`,
    type: 'FINAL_CHOICE',
    rounds: [1, 2, 3, 4, 5, 6, 7, 8],
    count: 4,
    countByPlayerCount: [{ min: 4, max: 6, count: 5 }, { min: 7, max: 10, count: 4 }],
  },
  { id: 'B04', text: 'Round 6–8 至少一次投給該回合少數選項', type: 'MINORITY', rounds: [6, 7, 8], count: 1 },
];

const EVENT_BY_ID = new Map(EVENTS.map((event) => [event.id, event]));
const MISSION_BY_ID = new Map(MISSIONS.map((mission) => [mission.id, mission]));

module.exports = { EVENTS, EVENT_BY_ID, MISSIONS, MISSION_BY_ID };
