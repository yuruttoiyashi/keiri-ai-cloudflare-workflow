/// <reference types="@cloudflare/workers-types" />

type TaxCategory = "課税10%" | "軽減8%" | "非課税" | "不課税" | "対象外" | "未設定";
type EntryStatus = "draft" | "needs_review" | "approved" | "corrected";
type AnalysisEngine = "workers-ai" | "rules";

type Env = {
  DB?: D1Database;
  AI?: Ai;
  ASSETS?: Fetcher;
};

type DraftInput = {
  date?: string;
  vendor?: string;
  description?: string;
  amount?: string | number;
  accountTitle?: string;
  taxCategory?: TaxCategory;
  participantCount?: string | number;
  memo?: string;
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

const AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function normalizeText(value = "") {
  return value.toLowerCase().replaceAll("　", " ");
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeTaxCategory(value: unknown, fallback: TaxCategory): TaxCategory {
  const allowed: TaxCategory[] = ["課税10%", "軽減8%", "非課税", "不課税", "対象外", "未設定"];
  return allowed.includes(value as TaxCategory) ? value as TaxCategory : fallback;
}

function fallbackAnalyze(input: DraftInput): AnalysisResult {
  const amount = Number(input.amount || 0);
  const participants = Math.max(1, Number(input.participantCount || 1));
  const text = normalizeText(`${input.vendor || ""} ${input.description || ""} ${input.memo || ""}`);

  let suggestedAccountTitle = input.accountTitle || "雑費";
  let suggestedTaxCategory: TaxCategory = input.taxCategory && input.taxCategory !== "未設定" ? input.taxCategory : "課税10%";
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
  } else if (/通信|wifi|wi-fi|携帯|スマホ|クラウド|サーバ|cloudflare|vercel|google|domain|ドメイン/.test(text)) {
    suggestedAccountTitle = "通信費";
    confidence = 87;
  } else if (/広告|sns|チラシ|キャンペーン|マーケティング|販促/.test(text)) {
    suggestedAccountTitle = "広告宣伝費";
    confidence = 86;
  } else if (/研修|セミナー|講座|書籍|教材|資格|勉強/.test(text)) {
    suggestedAccountTitle = "研修費";
    confidence = 83;
  } else if (/郵便|切手|レターパック|宅配|配送|送料/.test(text)) {
    suggestedAccountTitle = "通信費";
    confidence = 80;
  } else if (/家賃|賃料|オフィス|レンタル/.test(text)) {
    suggestedAccountTitle = "地代家賃";
    confidence = 82;
  }

  if (!input.taxCategory || input.taxCategory === "未設定") {
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

  if (!String(input.vendor || "").trim()) {
    flags.push("取引先が未入力です");
    riskScore += 18;
    confidence -= 10;
  }

  if (!String(input.description || "").trim()) {
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

  confidence = clamp(Math.round(confidence), 8, 98);
  riskScore = clamp(Math.round(riskScore), 0, 100);

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

function safeJsonParse<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text
    .replace(/```json/gi, "```")
    .replace(/```/g, "")
    .trim();

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  const candidate = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toStringArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  return value.map((item) => String(item)).filter(Boolean).slice(0, 8);
}

async function analyzeWithWorkersAI(input: DraftInput, env: Env): Promise<AnalysisResult> {
  const fallback = fallbackAnalyze(input);
  if (!env.AI) return fallback;

  const systemPrompt = [
    "あなたは日本の中小企業向けの経理業務改善AIです。",
    "目的は、経理担当者が仕訳登録前にミスを自己完結できるようにすることです。",
    "税務・会計の最終判断ではなく、保存前チェックの候補を返してください。",
    "必ずJSONだけを返してください。Markdown、説明文、コードブロックは禁止です。"
  ].join("\n");

  const userPrompt = [
    "次の取引を分析してください。",
    "出力JSONの型:",
    JSON.stringify({
      suggestedAccountTitle: "勘定科目候補",
      suggestedTaxCategory: "課税10% | 軽減8% | 非課税 | 不課税 | 対象外 | 未設定",
      confidence: "0-100の整数",
      riskScore: "0-100の整数。高いほど確認が必要",
      flags: ["保存前に確認すべき短い指摘"],
      aiComment: "経理担当者向けの短い助言"
    }),
    "判定ルールの例:",
    "- 交通費、JR、タクシー、訪問は旅費交通費になりやすい",
    "- 会議、打ち合わせ、飲食は会議費候補。ただし一人あたり5,000円超は確認",
    "- Amazon、備品、文具は消耗品費候補",
    "- 通信、クラウド、サーバ、Cloudflare、Vercelは通信費候補",
    "- 税区分が未設定なら必ずフラグ",
    "- 高額な雑費・会議費・消耗品費は証憑と承認メモ確認",
    `取引入力: ${JSON.stringify(input)}`,
    `ルールベース事前判定: ${JSON.stringify(fallback)}`
  ].join("\n");

  try {
    const rawResult = await env.AI.run(AI_MODEL, {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.1,
      max_tokens: 700,
      response_format: {
        type: "json_object"
      }
    } as unknown as AiTextGenerationInput);

    const responseText = typeof rawResult === "string"
      ? rawResult
      : typeof (rawResult as { response?: unknown }).response === "string"
        ? String((rawResult as { response: unknown }).response)
        : JSON.stringify(rawResult);

    const parsed = extractJsonObject(responseText);
    if (!parsed) throw new Error("AI response did not contain JSON");

    const flags = toStringArray(parsed.flags, fallback.flags);
    const confidence = clamp(Math.round(Number(parsed.confidence ?? fallback.confidence)), 1, 99);
    const riskScore = clamp(Math.round(Number(parsed.riskScore ?? fallback.riskScore)), 0, 100);

    return {
      suggestedAccountTitle: String(parsed.suggestedAccountTitle || fallback.suggestedAccountTitle),
      suggestedTaxCategory: normalizeTaxCategory(parsed.suggestedTaxCategory, fallback.suggestedTaxCategory),
      confidence,
      riskScore,
      flags,
      aiComment: String(parsed.aiComment || fallback.aiComment),
      engine: "workers-ai",
      model: AI_MODEL
    };
  } catch (error) {
    return {
      ...fallback,
      aiComment: `${fallback.aiComment}（Workers AIの応答を取得できなかったため、ローカルルールで判定中）`
    };
  }
}

function rowToEntry(row: Record<string, unknown>): JournalEntry {
  return {
    id: String(row.id),
    date: String(row.date),
    vendor: String(row.vendor),
    description: String(row.description),
    amount: Number(row.amount || 0),
    accountTitle: String(row.accountTitle || row.account_title || "雑費"),
    taxCategory: normalizeTaxCategory(row.taxCategory || row.tax_category, "未設定"),
    participantCount: Number(row.participantCount || row.participant_count || 1),
    confidence: Number(row.confidence || 0),
    riskScore: Number(row.riskScore || row.risk_score || 0),
    flags: safeJsonParse<string[]>(String(row.flags || "[]"), []),
    aiComment: String(row.aiComment || row.ai_comment || ""),
    engine: row.engine === "workers-ai" ? "workers-ai" : "rules",
    model: String(row.model || "local-rule-engine"),
    status: ["draft", "needs_review", "approved", "corrected"].includes(String(row.status))
      ? String(row.status) as EntryStatus
      : "draft",
    createdAt: String(row.createdAt || row.created_at || new Date().toISOString())
  };
}

async function getEntries(env: Env) {
  if (!env.DB) return json({ ok: false, error: "D1 DB binding is not configured", entries: [] }, 503);

  const { results } = await env.DB.prepare(
    `SELECT id, date, vendor, description, amount, account_title AS accountTitle,
            tax_category AS taxCategory, participant_count AS participantCount,
            confidence, risk_score AS riskScore, flags, ai_comment AS aiComment,
            engine, model, status, created_at AS createdAt
       FROM journal_entries
      ORDER BY created_at DESC`
  ).all<Record<string, unknown>>();

  return json({ ok: true, entries: results.map(rowToEntry) });
}

async function createEntry(request: Request, env: Env) {
  if (!env.DB) return json({ ok: false, error: "D1 DB binding is not configured" }, 503);

  const body = await request.json() as Partial<JournalEntry>;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const entry: JournalEntry = {
    id,
    date: String(body.date || new Date().toISOString().slice(0, 10)),
    vendor: String(body.vendor || "未入力"),
    description: String(body.description || ""),
    amount: Number(body.amount || 0),
    accountTitle: String(body.accountTitle || "雑費"),
    taxCategory: normalizeTaxCategory(body.taxCategory, "未設定"),
    participantCount: Number(body.participantCount || 1),
    confidence: Number(body.confidence || 0),
    riskScore: Number(body.riskScore || 0),
    flags: Array.isArray(body.flags) ? body.flags : [],
    aiComment: String(body.aiComment || ""),
    engine: body.engine === "workers-ai" ? "workers-ai" : "rules",
    model: String(body.model || "local-rule-engine"),
    status: ["draft", "needs_review", "approved", "corrected"].includes(String(body.status))
      ? String(body.status) as EntryStatus
      : "draft",
    createdAt: now
  };

  await env.DB.prepare(
    `INSERT INTO journal_entries
      (id, date, vendor, description, amount, account_title, tax_category,
       participant_count, confidence, risk_score, flags, ai_comment, engine, model, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      entry.id,
      entry.date,
      entry.vendor,
      entry.description,
      entry.amount,
      entry.accountTitle,
      entry.taxCategory,
      entry.participantCount,
      entry.confidence,
      entry.riskScore,
      JSON.stringify(entry.flags),
      entry.aiComment,
      entry.engine,
      entry.model,
      entry.status,
      entry.createdAt
    )
    .run();

  return json({ ok: true, entry }, 201);
}

async function updateEntryStatus(request: Request, env: Env, id: string) {
  if (!env.DB) return json({ ok: false, error: "D1 DB binding is not configured" }, 503);
  const body = await request.json() as { status?: string };
  if (!body.status) return json({ ok: false, error: "status is required" }, 400);

  await env.DB.prepare(`UPDATE journal_entries SET status = ? WHERE id = ?`)
    .bind(body.status, id)
    .run();

  return json({ ok: true });
}

async function deleteEntry(env: Env, id: string) {
  if (!env.DB) return json({ ok: false, error: "D1 DB binding is not configured" }, 503);
  await env.DB.prepare(`DELETE FROM journal_entries WHERE id = ?`).bind(id).run();
  return json({ ok: true });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        app: "Keiri AI Workflow MVP",
        aiReady: Boolean(env.AI),
        dbReady: Boolean(env.DB),
        model: AI_MODEL,
        time: new Date().toISOString()
      });
    }

    if (url.pathname === "/api/analyze" && request.method === "POST") {
      const input = await request.json() as DraftInput;
      const result = await analyzeWithWorkersAI(input, env);
      return json(result);
    }

    if (url.pathname === "/api/entries" && request.method === "GET") {
      return getEntries(env);
    }

    if (url.pathname === "/api/entries" && request.method === "POST") {
      return createEntry(request, env);
    }

    const statusMatch = url.pathname.match(/^\/api\/entries\/([^/]+)\/status$/);
    if (statusMatch && request.method === "PATCH") {
      return updateEntryStatus(request, env, statusMatch[1]);
    }

    const deleteMatch = url.pathname.match(/^\/api\/entries\/([^/]+)$/);
    if (deleteMatch && request.method === "DELETE") {
      return deleteEntry(env, deleteMatch[1]);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return json({ ok: false, error: "Not found" }, 404);
  }
} satisfies ExportedHandler<Env>;
