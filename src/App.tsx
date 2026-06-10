import React from "react";

type EntryStatus = "draft" | "needs_review" | "approved" | "corrected";
type TaxCategory = "課税10%" | "軽減8%" | "非課税" | "不課税" | "対象外" | "未設定";
type AnalysisEngine = "workers-ai" | "rules";

type JournalEntry = {
  id: string;
  date: string;
  vendor: string;
  description: string;
  amount: number;
  accountTitle: string;
  taxCategory: TaxCategory;
  participantCount: number;
  confidence: number;
  riskScore: number;
  flags: string[];
  aiComment: string;
  engine: AnalysisEngine;
  model: string;
  status: EntryStatus;
  createdAt: string;
};

type DraftInput = {
  date: string;
  vendor: string;
  description: string;
  amount: string;
  accountTitle: string;
  taxCategory: TaxCategory;
  participantCount: string;
  memo: string;
};

type AnalysisResult = {
  suggestedAccountTitle: string;
  suggestedTaxCategory: TaxCategory;
  confidence: number;
  riskScore: number;
  flags: string[];
  aiComment: string;
  engine: AnalysisEngine;
  model: string;
};

type ApiStatus = {
  state: "checking" | "online" | "offline";
  aiReady: boolean;
  dbReady: boolean;
  model: string;
};

const today = new Date().toISOString().slice(0, 10);
const STORAGE_KEY = "keiri-ai-cloudflare-workflow:mvp:v2";

const initialDraft: DraftInput = {
  date: today,
  vendor: "",
  description: "",
  amount: "",
  accountTitle: "",
  taxCategory: "未設定",
  participantCount: "1",
  memo: ""
};

const sampleEntries: JournalEntry[] = [
  {
    id: "demo-1",
    date: today,
    vendor: "東京カフェラウンジ",
    description: "月次会議後の打ち合わせ飲食代",
    amount: 28600,
    accountTitle: "会議費",
    taxCategory: "課税10%",
    participantCount: 4,
    confidence: 62,
    riskScore: 78,
    flags: ["一人あたりの会議費が高額です", "証憑の参加者メモを確認してください"],
    aiComment: "会議費として登録可能ですが、1人あたり金額が高いため監査前確認を推奨します。",
    engine: "workers-ai",
    model: "@cf/meta/llama-3.1-8b-instruct-fast",
    status: "needs_review",
    createdAt: new Date().toISOString()
  },
  {
    id: "demo-2",
    date: today,
    vendor: "JR東日本",
    description: "顧客訪問の交通費",
    amount: 1240,
    accountTitle: "旅費交通費",
    taxCategory: "課税10%",
    participantCount: 1,
    confidence: 93,
    riskScore: 12,
    flags: [],
    aiComment: "取引内容・金額・税区分に大きな違和感はありません。",
    engine: "workers-ai",
    model: "@cf/meta/llama-3.1-8b-instruct-fast",
    status: "approved",
    createdAt: new Date().toISOString()
  }
];

function yen(value: number) {
  return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" }).format(value);
}

function normalizeText(value: string) {
  return value.toLowerCase().replaceAll("　", " ");
}

function getLocalAnalysis(input: DraftInput): AnalysisResult {
  const amount = Number(input.amount || 0);
  const participants = Math.max(1, Number(input.participantCount || 1));
  const text = normalizeText(`${input.vendor} ${input.description} ${input.memo}`);

  let suggestedAccountTitle = input.accountTitle || "雑費";
  const suggestedTaxCategory: TaxCategory = input.taxCategory === "未設定" ? "課税10%" : input.taxCategory;
  const flags: string[] = [];
  let confidence = 78;
  let riskScore = 18;

  if (/交通|電車|jr|タクシー|バス|新幹線|高速|駐車|出張|訪問/.test(text)) {
    suggestedAccountTitle = "旅費交通費";
    confidence = 93;
  } else if (/会議|打ち合わせ|カフェ|レストラン|飲食|ランチ|懇親|商談/.test(text)) {
    suggestedAccountTitle = "会議費";
    confidence = 76;
  } else if (/amazon|備品|文具|コピー|キーボード|マウス|消耗|用紙|インク/.test(text)) {
    suggestedAccountTitle = "消耗品費";
    confidence = 89;
  } else if (/通信|wifi|wi-fi|携帯|スマホ|クラウド|サーバ|cloudflare|vercel|google|ドメイン/.test(text)) {
    suggestedAccountTitle = "通信費";
    confidence = 87;
  } else if (/広告|sns|チラシ|キャンペーン|マーケティング|販促/.test(text)) {
    suggestedAccountTitle = "広告宣伝費";
    confidence = 86;
  } else if (/研修|セミナー|講座|書籍|教材|資格|勉強/.test(text)) {
    suggestedAccountTitle = "研修費";
    confidence = 83;
  }

  if (input.taxCategory === "未設定") {
    flags.push("消費税区分が未設定です");
    riskScore += 24;
    confidence -= 8;
  }

  const perPerson = amount / participants;
  if (suggestedAccountTitle === "会議費" && perPerson > 5000) {
    flags.push(`一人あたりの会議費が高額です（${Math.round(perPerson).toLocaleString()}円）`);
    riskScore += 32;
    confidence -= 14;
  }

  if (amount >= 50000 && ["雑費", "会議費", "消耗品費"].includes(suggestedAccountTitle)) {
    flags.push("高額取引です。請求書・承認メモを確認してください");
    riskScore += 24;
    confidence -= 10;
  }

  if (!input.vendor.trim()) {
    flags.push("取引先が未入力です");
    riskScore += 18;
    confidence -= 10;
  }

  if (!input.description.trim()) {
    flags.push("摘要が未入力です");
    riskScore += 16;
    confidence -= 10;
  }

  if (amount <= 0) {
    flags.push("金額が未入力、または0円です");
    riskScore += 25;
    confidence -= 18;
  }

  if (suggestedAccountTitle === "雑費") {
    flags.push("勘定科目の確信度が低いため確認してください");
    riskScore += 18;
    confidence -= 8;
  }

  confidence = Math.max(8, Math.min(98, Math.round(confidence)));
  riskScore = Math.max(0, Math.min(100, Math.round(riskScore)));

  return {
    suggestedAccountTitle,
    suggestedTaxCategory,
    confidence,
    riskScore,
    flags: Array.from(new Set(flags)),
    aiComment: flags.length
      ? `登録前に${flags.length}件の確認ポイントがあります。${flags[0]}`
      : "取引内容と社内ルールを照合した結果、大きな違和感はありません。",
    engine: "rules",
    model: "local-rule-engine"
  };
}

function loadEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return sampleEntries;
    return JSON.parse(raw) as JournalEntry[];
  } catch {
    return sampleEntries;
  }
}

async function analyzeWithApi(input: DraftInput): Promise<AnalysisResult> {
  const local = getLocalAnalysis(input);

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });

    if (!response.ok) return local;
    const data = (await response.json()) as Partial<AnalysisResult>;

    return {
      suggestedAccountTitle: data.suggestedAccountTitle || local.suggestedAccountTitle,
      suggestedTaxCategory: data.suggestedTaxCategory || local.suggestedTaxCategory,
      confidence: Number(data.confidence ?? local.confidence),
      riskScore: Number(data.riskScore ?? local.riskScore),
      flags: Array.isArray(data.flags) ? data.flags : local.flags,
      aiComment: data.aiComment || local.aiComment,
      engine: data.engine === "workers-ai" ? "workers-ai" : "rules",
      model: data.model || local.model
    };
  } catch {
    return local;
  }
}

function MetricCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{note}</p>
    </div>
  );
}

function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "warn" | "danger" }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

function statusLabel(status: EntryStatus) {
  const labels: Record<EntryStatus, string> = {
    draft: "下書き",
    needs_review: "要確認",
    approved: "承認済み",
    corrected: "修正済み"
  };
  return labels[status];
}

function statusTone(status: EntryStatus): "neutral" | "good" | "warn" | "danger" {
  if (status === "approved") return "good";
  if (status === "needs_review") return "danger";
  if (status === "corrected") return "warn";
  return "neutral";
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function getCsvValue(row: Record<string, string>, candidates: string[]) {
  const normalized = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key.replaceAll(" ", "").replaceAll("　", ""), value])
  );
  for (const candidate of candidates) {
    const value = normalized[candidate.replaceAll(" ", "").replaceAll("　", "")];
    if (value) return value;
  }
  return "";
}

async function readCsvFile(file: File) {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return null;

  const headers = parseCsvLine(lines[0]);
  const values = parseCsvLine(lines[1]);
  const row: Record<string, string> = {};
  headers.forEach((header, index) => {
    row[header] = values[index] || "";
  });
  return row;
}

export default function App() {
  const [entries, setEntries] = React.useState<JournalEntry[]>(loadEntries);
  const [draft, setDraft] = React.useState<DraftInput>(initialDraft);
  const [analysis, setAnalysis] = React.useState<AnalysisResult>(() => getLocalAnalysis(initialDraft));
  const [isAnalyzing, setIsAnalyzing] = React.useState(false);
  const [filter, setFilter] = React.useState<"all" | "needs_review" | "approved">("all");
  const [apiStatus, setApiStatus] = React.useState<ApiStatus>({
    state: "checking",
    aiReady: false,
    dbReady: false,
    model: ""
  });
  const [toast, setToast] = React.useState("AI判定を使う場合は、別ターミナルで npm run api:dev:ai を起動します。正式公開後は1つのURLで動きます。");

  const apiOnline = apiStatus.state === "online";

  React.useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }, [entries]);

  React.useEffect(() => {
    let ignore = false;
    const handle = window.setTimeout(async () => {
      setIsAnalyzing(true);
      const next = await analyzeWithApi(draft);
      if (!ignore) {
        setAnalysis(next);
        setIsAnalyzing(false);
      }
    }, 420);

    return () => {
      ignore = true;
      window.clearTimeout(handle);
    };
  }, [draft]);

  React.useEffect(() => {
    async function checkApi() {
      try {
        const response = await fetch("/api/health");
        if (!response.ok) throw new Error("API offline");
        const data = await response.json() as Partial<ApiStatus> & { model?: string };
        setApiStatus({
          state: "online",
          aiReady: Boolean(data.aiReady),
          dbReady: Boolean(data.dbReady),
          model: String(data.model || "")
        });
      } catch {
        setApiStatus({ state: "offline", aiReady: false, dbReady: false, model: "" });
      }
    }

    checkApi();
  }, []);

  React.useEffect(() => {
    async function loadFromApi() {
      if (!apiOnline || !apiStatus.dbReady) return;
      try {
        const response = await fetch("/api/entries");
        const data = await response.json() as { entries?: JournalEntry[] };
        if (Array.isArray(data.entries)) {
          setEntries(data.entries);
          setToast(data.entries.length ? "D1に保存済みの仕訳を読み込みました。" : "D1に接続中です。まだ保存済み仕訳はありません。");
        }
      } catch {
        setToast("D1の読み込みに失敗したため、ブラウザ内データで続行します。");
      }
    }

    loadFromApi();
  }, [apiOnline, apiStatus.dbReady]);

  const total = entries.reduce((sum, item) => sum + item.amount, 0);
  const reviewCount = entries.filter((item) => item.status === "needs_review").length;
  const approvedCount = entries.filter((item) => item.status === "approved").length;
  const aiCount = entries.filter((item) => item.engine === "workers-ai").length;
  const averageRisk = entries.length
    ? Math.round(entries.reduce((sum, item) => sum + item.riskScore, 0) / entries.length)
    : 0;

  const filteredEntries = entries.filter((item) => {
    if (filter === "all") return true;
    return item.status === filter;
  });

  function updateDraft<K extends keyof DraftInput>(key: K, value: DraftInput[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function createEntry() {
    const amount = Number(draft.amount || 0);
    const participants = Math.max(1, Number(draft.participantCount || 1));
    const next: JournalEntry = {
      id: crypto.randomUUID(),
      date: draft.date || today,
      vendor: draft.vendor.trim() || "未入力",
      description: draft.description.trim() || "摘要未入力",
      amount,
      accountTitle: analysis.suggestedAccountTitle,
      taxCategory: analysis.suggestedTaxCategory,
      participantCount: participants,
      confidence: analysis.confidence,
      riskScore: analysis.riskScore,
      flags: analysis.flags,
      aiComment: analysis.aiComment,
      engine: analysis.engine,
      model: analysis.model,
      status: analysis.flags.length ? "needs_review" : "approved",
      createdAt: new Date().toISOString()
    };

    if (apiOnline && apiStatus.dbReady) {
      try {
        const response = await fetch("/api/entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next)
        });
        const data = await response.json() as { entry?: JournalEntry };
        if (response.ok && data.entry) {
          setEntries((prev) => [data.entry as JournalEntry, ...prev]);
          setDraft(initialDraft);
          setToast("AI判定結果をD1へ保存しました。");
          return;
        }
      } catch {
        setToast("D1保存に失敗したため、ブラウザ内に一時保存しました。");
      }
    }

    setEntries((prev) => [next, ...prev]);
    setDraft(initialDraft);
    setToast("ブラウザ内に一時保存しました。D1接続後に正式保存できます。");
  }

  async function updateStatus(id: string, status: EntryStatus) {
    setEntries((prev) => prev.map((item) => (item.id === id ? { ...item, status } : item)));

    if (apiOnline && apiStatus.dbReady) {
      try {
        await fetch(`/api/entries/${id}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status })
        });
      } catch {
        setToast("状態更新は画面上のみ反映されています。API接続を確認してください。");
      }
    }
  }

  async function deleteEntry(id: string) {
    setEntries((prev) => prev.filter((item) => item.id !== id));

    if (apiOnline && apiStatus.dbReady) {
      try {
        await fetch(`/api/entries/${id}`, { method: "DELETE" });
      } catch {
        setToast("削除は画面上のみ反映されています。API接続を確認してください。");
      }
    }
  }

  async function applyUpload(file: File) {
    const lower = file.name.toLowerCase();

    if (lower.endsWith(".csv")) {
      const row = await readCsvFile(file);
      if (row) {
        setDraft((prev) => ({
          ...prev,
          date: getCsvValue(row, ["日付", "取引日", "date"]) || prev.date,
          vendor: getCsvValue(row, ["取引先", "支払先", "vendor", "店名"]) || prev.vendor,
          description: getCsvValue(row, ["摘要", "内容", "description", "メモ"]) || prev.description,
          amount: getCsvValue(row, ["金額", "amount", "税込金額"]).replace(/[¥￥,]/g, "") || prev.amount,
          taxCategory: (getCsvValue(row, ["税区分", "消費税区分", "taxCategory"]) as TaxCategory) || prev.taxCategory,
          memo: `CSV「${file.name}」の1行目からドラフトを作成`
        }));
        setToast("CSVの1行目から仕訳ドラフトを作成しました。AIが保存前チェックを行います。");
        return;
      }
    }

    const fakeVendor = file.name.replace(/\.[^.]+$/, "").replaceAll("_", " ");
    setDraft((prev) => ({
      ...prev,
      vendor: fakeVendor,
      description: "アップロード証憑から作成した仕訳ドラフト",
      amount: prev.amount || "12000",
      accountTitle: "",
      taxCategory: "未設定",
      memo: `ファイル名「${file.name}」から仮ドラフトを作成。画像/PDFのOCRは次フェーズでR2＋Vision AIに拡張予定。`
    }));
    setToast("証憑ファイル名から仮ドラフトを作成しました。画像/PDFのOCRは次フェーズの拡張ポイントです。");
  }

  function exportCsv() {
    const header = ["日付", "取引先", "摘要", "金額", "勘定科目", "税区分", "AI確信度", "リスク", "AIエンジン", "状態", "フラグ"];
    const rows = entries.map((item) => [
      item.date,
      item.vendor,
      item.description,
      String(item.amount),
      item.accountTitle,
      item.taxCategory,
      String(item.confidence),
      String(item.riskScore),
      item.engine === "workers-ai" ? "Workers AI" : "ルール補助",
      statusLabel(item.status),
      item.flags.join(" / ")
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "keiri-ai-workflow-export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="app-shell">
      <section className="hero-section">
        <div className="hero-copy">
          <div className="eyebrow">AI x Cloudflare 経理ワークフロー MVP</div>
          <h1>登録前にミスを止める、AI経理チェックアプリ</h1>
          <p>
            Workers AIが勘定科目・消費税区分・異常値を判定し、D1に仕訳を保存。
            全件チェックではなく、要注意フラグだけを監査キューに集約します。
          </p>
          <div className="hero-actions">
            <a href="#input" className="primary-link">仕訳を作成する</a>
            <button type="button" className="secondary-button" onClick={exportCsv}>CSV出力</button>
          </div>
        </div>
        <div className="hero-panel">
          <div className="panel-topline">
            <span className={`status-dot ${apiStatus.state}`}></span>
            API: {apiStatus.state === "checking" ? "確認中" : apiStatus.state === "online" ? "接続中" : "ローカル判定"}
          </div>
          <div className="big-number">80%</div>
          <p>監査前の修正作業削減を目標にしたAI搭載MVP</p>
          <div className="mini-status-grid">
            <Pill tone={apiStatus.aiReady ? "good" : "warn"}>AI {apiStatus.aiReady ? "ON" : "OFF"}</Pill>
            <Pill tone={apiStatus.dbReady ? "good" : "warn"}>D1 {apiStatus.dbReady ? "ON" : "OFF"}</Pill>
            <Pill tone={analysis.engine === "workers-ai" ? "good" : "neutral"}>
              判定: {analysis.engine === "workers-ai" ? "Workers AI" : "ルール補助"}
            </Pill>
          </div>
        </div>
      </section>

      <section className="notice-card">
        {toast}
      </section>

      <section className="metric-grid" aria-label="業務指標">
        <MetricCard label="登録済み仕訳" value={`${entries.length}件`} note={`合計 ${yen(total)}`} />
        <MetricCard label="AI判定済み" value={`${aiCount}件`} note="Workers AIで分析した仕訳" />
        <MetricCard label="要注意フラグ" value={`${reviewCount}件`} note="税理士・管理者は対象だけ確認" />
        <MetricCard label="平均リスク" value={`${averageRisk}/100`} note={`承認済み ${approvedCount}件`} />
      </section>

      <section className="three-pillars">
        <article>
          <span className="icon-bubble">AI</span>
          <h2>AI自動判定</h2>
          <p>取引先・摘要・金額から、勘定科目と税区分をWorkers AIで提案します。</p>
        </article>
        <article>
          <span className="icon-bubble">!</span>
          <h2>保存前ブロック</h2>
          <p>税区分未設定、高額会議費、摘要不足などを登録前に検知します。</p>
        </article>
        <article>
          <span className="icon-bubble">D1</span>
          <h2>監査キュー保存</h2>
          <p>D1に仕訳とAI判定結果を保存し、要確認だけを絞り込みます。</p>
        </article>
      </section>

      <section className="workspace" id="input">
        <div className="input-panel card">
          <div className="section-heading">
            <p>Step 1</p>
            <h2>証憑・取引情報を入力</h2>
          </div>

          <label className="upload-box">
            <input
              type="file"
              accept=".csv,.pdf,.png,.jpg,.jpeg"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) applyUpload(file);
              }}
            />
            <strong>領収書・請求書・CSVをアップロード</strong>
            <span>CSVは1行目からドラフト化。画像/PDFはファイル名から仮ドラフト化します。</span>
          </label>

          <div className="form-grid">
            <label>
              日付
              <input type="date" value={draft.date} onChange={(event) => updateDraft("date", event.target.value)} />
            </label>
            <label>
              取引先
              <input value={draft.vendor} onChange={(event) => updateDraft("vendor", event.target.value)} placeholder="例：JR東日本" />
            </label>
            <label className="wide-field">
              摘要
              <input value={draft.description} onChange={(event) => updateDraft("description", event.target.value)} placeholder="例：顧客訪問の交通費" />
            </label>
            <label>
              金額
              <input type="number" min="0" value={draft.amount} onChange={(event) => updateDraft("amount", event.target.value)} placeholder="12000" />
            </label>
            <label>
              参加人数
              <input type="number" min="1" value={draft.participantCount} onChange={(event) => updateDraft("participantCount", event.target.value)} />
            </label>
            <label>
              手入力の勘定科目
              <input value={draft.accountTitle} onChange={(event) => updateDraft("accountTitle", event.target.value)} placeholder="空欄ならAI推定" />
            </label>
            <label>
              消費税区分
              <select value={draft.taxCategory} onChange={(event) => updateDraft("taxCategory", event.target.value as TaxCategory)}>
                <option>未設定</option>
                <option>課税10%</option>
                <option>軽減8%</option>
                <option>非課税</option>
                <option>不課税</option>
                <option>対象外</option>
              </select>
            </label>
            <label className="wide-field">
              補足メモ
              <input value={draft.memo} onChange={(event) => updateDraft("memo", event.target.value)} placeholder="例：社内承認済み、参加者4名、月次会議後の商談" />
            </label>
          </div>
        </div>

        <div className="ai-panel card">
          <div className="section-heading">
            <p>Step 2</p>
            <h2>AI判定と保存前チェック</h2>
          </div>

          <div className="engine-box">
            <span className={`engine-dot ${analysis.engine === "workers-ai" ? "online" : "offline"}`}></span>
            {analysis.engine === "workers-ai" ? "Workers AIで判定中" : "ローカルルール補助で判定中"}
          </div>

          <div className="suggestion-card">
            <div>
              <span>推奨勘定科目</span>
              <strong>{analysis.suggestedAccountTitle}</strong>
            </div>
            <div>
              <span>推奨税区分</span>
              <strong>{analysis.suggestedTaxCategory}</strong>
            </div>
          </div>

          <div className="score-row">
            <div>
              <span>AI確信度</span>
              <strong>{analysis.confidence}%</strong>
            </div>
            <div>
              <span>リスク</span>
              <strong>{analysis.riskScore}/100</strong>
            </div>
          </div>

          <div className="comment-box">
            {isAnalyzing ? "AIが確認中..." : analysis.aiComment}
          </div>

          <div className="flag-list">
            {analysis.flags.length === 0 ? (
              <Pill tone="good">登録可能</Pill>
            ) : (
              analysis.flags.map((flag) => <Pill key={flag} tone="danger">{flag}</Pill>)
            )}
          </div>

          <button className="save-button" type="button" onClick={createEntry} disabled={isAnalyzing}>
            {analysis.flags.length ? "要確認として登録" : "承認済みで登録"}
          </button>
          <p className="model-note">Model: {analysis.model}</p>
        </div>
      </section>

      <section className="card table-card">
        <div className="table-header">
          <div className="section-heading">
            <p>Step 3</p>
            <h2>ピンポイント監査キュー</h2>
          </div>
          <div className="filter-buttons">
            <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>全件</button>
            <button className={filter === "needs_review" ? "active" : ""} onClick={() => setFilter("needs_review")}>要確認</button>
            <button className={filter === "approved" ? "active" : ""} onClick={() => setFilter("approved")}>承認済み</button>
          </div>
        </div>

        <div className="entry-list">
          {filteredEntries.length === 0 ? (
            <div className="empty-state">該当する仕訳はまだありません。</div>
          ) : (
            filteredEntries.map((item) => (
              <article className="entry-row" key={item.id}>
                <div className="entry-main">
                  <div className="entry-title-row">
                    <h3>{item.vendor}</h3>
                    <Pill tone={statusTone(item.status)}>{statusLabel(item.status)}</Pill>
                    <Pill tone={item.engine === "workers-ai" ? "good" : "neutral"}>{item.engine === "workers-ai" ? "Workers AI" : "ルール補助"}</Pill>
                  </div>
                  <p>{item.date} / {item.description}</p>
                  <div className="entry-tags">
                    <Pill>{item.accountTitle}</Pill>
                    <Pill>{item.taxCategory}</Pill>
                    <Pill tone={item.riskScore >= 60 ? "danger" : item.riskScore >= 35 ? "warn" : "good"}>リスク {item.riskScore}</Pill>
                    <Pill>AI {item.confidence}%</Pill>
                  </div>
                  {item.flags.length > 0 && (
                    <ul className="flag-notes">
                      {item.flags.map((flag) => <li key={flag}>{flag}</li>)}
                    </ul>
                  )}
                  <p className="entry-comment">{item.aiComment}</p>
                </div>
                <div className="entry-side">
                  <strong>{yen(item.amount)}</strong>
                  <button onClick={() => updateStatus(item.id, "approved")}>承認</button>
                  <button onClick={() => updateStatus(item.id, "corrected")}>修正済み</button>
                  <button className="ghost-danger" onClick={() => deleteEntry(item.id)}>削除</button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
