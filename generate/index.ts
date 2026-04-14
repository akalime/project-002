// ================================================================
// generate/index.ts — Studia Generation Pipeline
// SSE streaming — generates all sections server-side
// Client connects once, receives progress events, can navigate freely
// ================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://akalime.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CLAUDE_MODEL_OUTLINE = "claude-haiku-4-5-20251001";
const CLAUDE_MODEL_SECTION = "claude-haiku-4-5-20251001";
const MAX_TOKENS_OUTLINE   = 2000;
const MAX_TOKENS_SECTION   = 4000;

function ok(data: object) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function callClaude(
  claudeApiKey: string, system: string, userMessage: string,
  maxTokens: number, temperature = 0.7, model = CLAUDE_MODEL_SECTION
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": claudeApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, temperature, system,
      messages: [{ role: "user", content: userMessage }] }),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message ?? "Claude API error"); }
  const data = await res.json();
  return data.content?.[0]?.text ?? "";
}

function parseJson(text: string): unknown {
  let clean = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  if (!clean.endsWith('}') && !clean.endsWith(']')) {
    const last = Math.max(clean.lastIndexOf('},'), clean.lastIndexOf('"}'));
    if (last > 0) clean = clean.slice(0, last + 1) + ']}';
  }
  try { return JSON.parse(clean); }
  catch(e) { throw new Error('Invalid JSON from Claude: ' + clean.slice(-200)); }
}

function truncateText(text: string, maxChars = 12000): string {
  return text.length <= maxChars ? text : text.slice(0, maxChars) + "\n\n[Truncated...]";
}

function sseEvent(controller: ReadableStreamDefaultController, event: string, data: object) {
  controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

type SectionMeta = { number: number; title: string; description: string; difficulty: string; minutes: number; key_topics: string[] };
type Outline = { title: string; description: string; category: string; difficulty: string; icon: string; color: string; sections: SectionMeta[] };

async function buildOutline(claudeApiKey: string, title: string, author: string, sourceType: string, rawText: string, temperature: number): Promise<Outline> {
  const match = rawText.match(/Number of sections:\s*(\d+)/);
  const n = match ? parseInt(match[1]) : 8;

  const system = `You are an expert curriculum designer. Return ONLY valid JSON — no markdown:
{
  "title": "string",
  "description": "2-3 sentences",
  "category": "Science|Technology|History|Medicine|Mathematics|Humanities|Business|Arts|Other",
  "difficulty": "beginner|intermediate|advanced",
  "icon": "single emoji",
  "color": "#hexcolor",
  "sections": [{"number":1,"title":"string","description":"1-2 sentences","difficulty":"beginner|intermediate|advanced","minutes":8,"key_topics":["t1","t2"]}]
}
Create EXACTLY ${n} sections. Progress logically from foundational to advanced.`;

  const prompt = `Design a course with EXACTLY ${n} sections.
TITLE: ${title ?? "Unknown"}
AUTHOR: ${author ?? "Unknown"}
SOURCE: ${sourceType ?? "other"}
CONTENT:
${truncateText(rawText, 3000)}`;

  const raw = await callClaude(claudeApiKey, system, prompt, MAX_TOKENS_OUTLINE, Math.min(0.9, Math.max(0.3, temperature * 0.7)), CLAUDE_MODEL_OUTLINE);
  const outline = parseJson(raw) as Outline;
  if (!outline.sections?.length) throw new Error("Failed to generate outline");
  return outline;
}

async function buildSection(claudeApiKey: string, outline: Outline, idx: number, rawText: string, temperature: number) {
  const meta = outline.sections[idx];
  const total = outline.sections.length;
  const chunkSize = Math.floor(12000 / total);
  const start = idx * chunkSize;
  const chunk = rawText.slice(Math.max(0, start - 500), start + chunkSize + 500);

  const system = `You are an expert educational content writer. Return ONLY valid JSON:
{
  "content": [
    {"type":"heading","text":"string"},
    {"type":"body","text":"string with **bold** and \`code\`"},
    {"type":"callout","text":"key insight"},
    {"type":"code","text":"code","lang":"python"}
  ],
  "knowledge_check": {
    "questions": [
      {"type":"mc","question":"?","options":["A. ","B. ","C. ","D. "],"answer":"A","explanation":"why"},
      {"type":"tf","question":"?","answer":true,"explanation":"why"},
      {"type":"sa","question":"?","sample_answer":"answer","key_points":["p1","p2"]}
    ]
  },
  "ai_context": "1-2 sentence summary for AI tutor"
}
Rules: 4-8 content blocks, 3-5 KC questions mixing mc/tf/sa, 2-4 sentences per body paragraph.`;

  const prompt = `Generate section ${meta.number} of ${total}.
COURSE: ${outline.title}
SECTION: ${meta.title}
DESCRIPTION: ${meta.description}
KEY TOPICS: ${meta.key_topics?.join(", ") ?? ""}
DIFFICULTY: ${meta.difficulty}
DURATION: ${meta.minutes} min
SOURCE:
${chunk}`;

  const raw = await callClaude(claudeApiKey, system, prompt, MAX_TOKENS_SECTION, Math.min(1.0, Math.max(0.1, temperature)));
  return parseJson(raw) as { content: unknown[]; knowledge_check: unknown; ai_context: string };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return err("Unauthorized", 401);

    const jwt = authHeader.replace("Bearer ", "");
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !user) return err("Unauthorized", 401);

    const claudeApiKey = Deno.env.get("CLAUDE_API_KEY");
    if (!claudeApiKey) return err("Server configuration error", 500);

    const body = await req.json();
    const { action } = body;

    // ── GENERATE_STREAM — SSE full pipeline ──────────────────────
    if (action === "generate_stream") {
      const { title, author, source_type, source_url, raw_text, temperature = 0.7 } = body;
      if (!raw_text || raw_text.trim().length < 100) return err("Source text too short");

      const stream = new ReadableStream({
        async start(controller) {
          try {
            sseEvent(controller, "started", { message: "Building outline..." });

            // Source dedup
            let sourceId: string | undefined;
            if (source_url) {
              const { data: ex } = await supabase.from("sources").select("id").eq("source_url", source_url).single();
              if (ex) sourceId = ex.id;
            }
            if (!sourceId) {
              const { data: ns, error: se } = await supabase.from("sources").insert({
                user_id: user.id, title: title ?? "Untitled", author: author ?? null,
                source_type: source_type ?? "other", source_url: source_url ?? null,
                raw_text, word_count: raw_text.split(/\s+/).length,
              }).select("id").single();
              if (se) throw se;
              sourceId = ns.id;
            }

            const outline = await buildOutline(claudeApiKey, title, author, source_type, raw_text, temperature);

            const { data: course, error: ce } = await supabase.from("courses").insert({
              user_id: user.id, source_id: sourceId, title: outline.title,
              description: outline.description, category: outline.category,
              difficulty: outline.difficulty, icon: outline.icon, color: outline.color,
              section_count: outline.sections.length, status: "generating",
            }).select("id").single();
            if (ce) throw ce;

            sseEvent(controller, "outline", {
              course_id: course.id, source_id: sourceId,
              outline, section_count: outline.sections.length,
            });

            const total = outline.sections.length;
            for (let i = 0; i < total; i++) {
              sseEvent(controller, "section_start", {
                section_index: i, section_number: outline.sections[i].number,
                title: outline.sections[i].title, sections_total: total,
              });

              const sectionData = await buildSection(claudeApiKey, outline, i, raw_text, temperature);

              const { data: sec, error: sece } = await supabase.from("sections").insert({
                course_id: course.id, user_id: user.id,
                section_number: outline.sections[i].number, title: outline.sections[i].title,
                description: outline.sections[i].description, difficulty: outline.sections[i].difficulty,
                minutes: outline.sections[i].minutes, content_json: sectionData.content,
                knowledge_check_json: sectionData.knowledge_check, ai_context: sectionData.ai_context,
                status: "ready",
              }).select("id").single();
              if (sece) throw sece;

              const pct = Math.round(((i + 1) / total) * 100);
              sseEvent(controller, "section_done", {
                section_id: sec.id, section_index: i,
                section_number: outline.sections[i].number, title: outline.sections[i].title,
                pct, done: i === total - 1, sections_done: i + 1, sections_total: total,
              });
            }

            await supabase.from("courses").update({ status: "ready", updated_at: new Date().toISOString() }).eq("id", course.id);
            sseEvent(controller, "complete", { course_id: course.id, title: outline.title });

          } catch(e) {
            sseEvent(controller, "error", { message: e.message });
          } finally {
            controller.close();
          }
        }
      });

      return new Response(stream, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    // ── REGENERATE_COURSE — SSE pipeline reusing stored source ───
    if (action === "regenerate_course") {
      const { course_id, temperature = 0.7 } = body;
      if (!course_id) return err("course_id required");

      const { data: course, error: ce } = await supabase.from("courses")
        .select("id, source_id, title")
        .eq("id", course_id).eq("user_id", user.id).single();
      if (ce || !course) return err("Course not found", 404);

      const { data: source, error: se } = await supabase.from("sources")
        .select("raw_text, title, author, source_type, source_url")
        .eq("id", course.source_id).single();
      if (se || !source) return err("Source not found", 404);

      const { raw_text, title, author, source_type, source_url } = source;

      const stream = new ReadableStream({
        async start(controller) {
          try {
            // Wipe existing sections and progress, reset status
            await supabase.from("sections").delete().eq("course_id", course_id).eq("user_id", user.id);
            await supabase.from("progress").delete().eq("course_id", course_id).eq("user_id", user.id);
            await supabase.from("courses").update({ status: "generating" }).eq("id", course_id);

            sseEvent(controller, "started", { message: "Rebuilding outline..." });

            const outline = await buildOutline(claudeApiKey, title, author, source_type, raw_text, temperature);

            await supabase.from("courses").update({
              title: outline.title,
              description: outline.description,
              category: outline.category,
              difficulty: outline.difficulty,
              icon: outline.icon,
              color: outline.color,
              section_count: outline.sections.length,
            }).eq("id", course_id);

            sseEvent(controller, "outline", {
              course_id, source_id: course.source_id,
              outline, section_count: outline.sections.length,
            });

            const total = outline.sections.length;
            for (let i = 0; i < total; i++) {
              sseEvent(controller, "section_start", {
                section_index: i, section_number: outline.sections[i].number,
                title: outline.sections[i].title, sections_total: total,
              });

              const sectionData = await buildSection(claudeApiKey, outline, i, raw_text, temperature);

              const { data: sec, error: sece } = await supabase.from("sections").insert({
                course_id, user_id: user.id,
                section_number: outline.sections[i].number, title: outline.sections[i].title,
                description: outline.sections[i].description, difficulty: outline.sections[i].difficulty,
                minutes: outline.sections[i].minutes, content_json: sectionData.content,
                knowledge_check_json: sectionData.knowledge_check, ai_context: sectionData.ai_context,
                status: "ready",
              }).select("id").single();
              if (sece) throw sece;

              const pct = Math.round(((i + 1) / total) * 100);
              sseEvent(controller, "section_done", {
                section_id: sec.id, section_index: i,
                section_number: outline.sections[i].number, title: outline.sections[i].title,
                pct, done: i === total - 1, sections_done: i + 1, sections_total: total,
              });
            }

            await supabase.from("courses").update({ status: "ready", updated_at: new Date().toISOString() }).eq("id", course_id);
            sseEvent(controller, "complete", { course_id, title: outline.title });

          } catch(e) {
            sseEvent(controller, "error", { message: e.message });
          } finally {
            controller.close();
          }
        }
      });

      return new Response(stream, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    // ── INIT (compatibility) ─────────────────────────────────────
    if (action === "init") {
      const { title, author, source_type, source_url, raw_text, temperature = 0.7 } = body;
      if (!raw_text || raw_text.trim().length < 100) return err("Source text too short");
      let sourceId: string | undefined;
      if (source_url) {
        const { data: ex } = await supabase.from("sources").select("id").eq("source_url", source_url).single();
        if (ex) sourceId = ex.id;
      }
      if (!sourceId) {
        const { data: ns, error: se } = await supabase.from("sources").insert({
          user_id: user.id, title: title ?? "Untitled", author: author ?? null,
          source_type: source_type ?? "other", source_url: source_url ?? null,
          raw_text, word_count: raw_text.split(/\s+/).length,
        }).select("id").single();
        if (se) throw se;
        sourceId = ns.id;
      }
      const outline = await buildOutline(claudeApiKey, title, author, source_type, raw_text, temperature);
      const { data: course, error: ce } = await supabase.from("courses").insert({
        user_id: user.id, source_id: sourceId, title: outline.title,
        description: outline.description, category: outline.category,
        difficulty: outline.difficulty, icon: outline.icon, color: outline.color,
        section_count: outline.sections.length, status: "generating",
      }).select("id").single();
      if (ce) throw ce;
      return ok({ course_id: course.id, source_id: sourceId, outline, section_count: outline.sections.length });
    }

    // ── SECTION (compatibility) ──────────────────────────────────
    if (action === "section") {
      const { course_id, section_index, outline, raw_text, temperature = 0.7 } = body;
      if (!course_id || section_index === undefined || !outline || !raw_text) return err("Missing required fields");
      const meta = outline.sections[section_index];
      if (!meta) return err("Section index out of range");
      const sectionData = await buildSection(claudeApiKey, outline, section_index, raw_text, temperature);
      const total = outline.sections.length;
      const { data: sec, error: se } = await supabase.from("sections").insert({
        course_id, user_id: user.id, section_number: meta.number, title: meta.title,
        description: meta.description, difficulty: meta.difficulty, minutes: meta.minutes,
        content_json: sectionData.content, knowledge_check_json: sectionData.knowledge_check,
        ai_context: sectionData.ai_context, status: "ready",
      }).select("id").single();
      if (se) throw se;
      const isLast = section_index === total - 1;
      if (isLast) await supabase.from("courses").update({ status: "ready", updated_at: new Date().toISOString() }).eq("id", course_id);
      return ok({ section_id: sec.id, section_number: meta.number, title: meta.title, done: isLast, sections_done: section_index + 1, sections_total: total });
    }

    // ── FROM_UPLOAD ──────────────────────────────────────────────
    if (action === "from_upload") {
      const { file_path, title, temperature = 0.7 } = body;
      if (!file_path) return err("file_path required");
      const { data: fd, error: fe } = await supabase.storage.from("project002-docs").download(file_path);
      if (fe) throw fe;
      const raw_text = await fd.text();
      const { data: ns, error: se } = await supabase.from("sources").insert({
        user_id: user.id, title: title ?? file_path.split("/").pop() ?? "Uploaded Document",
        source_type: "upload", file_path, raw_text, word_count: raw_text.split(/\s+/).length,
      }).select("id").single();
      if (se) throw se;
      const outline = await buildOutline(claudeApiKey, title, "Upload", "upload", raw_text, temperature);
      const { data: course, error: ce } = await supabase.from("courses").insert({
        user_id: user.id, source_id: ns.id, title: outline.title, description: outline.description,
        category: outline.category, difficulty: outline.difficulty, icon: outline.icon, color: outline.color,
        section_count: outline.sections.length, status: "generating",
      }).select("id").single();
      if (ce) throw ce;
      return ok({ course_id: course.id, source_id: ns.id, outline, section_count: outline.sections.length });
    }

    // ── STATUS ───────────────────────────────────────────────────
    if (action === "status") {
      const { course_id } = body;
      if (!course_id) return err("course_id required");
      const { data: course, error: ce } = await supabase.from("courses")
        .select("id, title, status, section_count, updated_at").eq("id", course_id).eq("user_id", user.id).single();
      if (ce) throw ce;
      const { data: sections } = await supabase.from("sections")
        .select("id, section_number, title, status").eq("course_id", course_id).order("section_number");
      const readyCount = sections?.filter(s => s.status === "ready").length ?? 0;
      return ok({ course, sections: sections ?? [], ready_count: readyCount, total_count: course.section_count,
        pct: course.section_count > 0 ? Math.round((readyCount / course.section_count) * 100) : 0 });
    }

    // ── GET_COURSE ───────────────────────────────────────────────
    if (action === "get_course") {
      const { course_id } = body;
      if (!course_id) return err("course_id required");
      const { data: course, error: ce } = await supabase.from("courses").select("*").eq("id", course_id).single();
      if (ce) throw ce;
      if (course.user_id !== user.id && !course.is_public) return err("Forbidden", 403);
      const { data: sections } = await supabase.from("sections").select("*")
        .eq("course_id", course_id).eq("status", "ready").order("section_number");
      return ok({ course, sections: sections ?? [] });
    }

    // ── GET_MY_COURSES ───────────────────────────────────────────
    if (action === "get_my_courses") {
      const { data: courses, error } = await supabase.from("courses")
        .select("id, title, description, category, difficulty, icon, color, section_count, status, created_at, updated_at")
        .eq("user_id", user.id).order("created_at", { ascending: false });
      if (error) throw error;
      return ok({ courses: courses ?? [] });
    }

    // ── SAVE_PROGRESS ────────────────────────────────────────────
    if (action === "save_progress") {
      const { section_id, course_id, read, kc_score } = body;
      if (!section_id || !course_id) return err("section_id and course_id required");
      const { error } = await supabase.from("progress").upsert({
        user_id: user.id, section_id, course_id, read: read ?? false,
        kc_score: kc_score ?? null, kc_attempts: kc_score !== undefined ? 1 : 0,
        completed_at: (read || kc_score !== undefined) ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,section_id" });
      if (error) throw error;
      return ok({ saved: true });
    }

    // ── DELETE_COURSE ────────────────────────────────────────────
    if (action === "delete_course") {
      const { course_id } = body;
      if (!course_id) return err("course_id required");
      await supabase.from("sections").delete().eq("course_id", course_id).eq("user_id", user.id);
      await supabase.from("progress").delete().eq("course_id", course_id).eq("user_id", user.id);
      const { error } = await supabase.from("courses").delete().eq("id", course_id).eq("user_id", user.id);
      if (error) throw error;
      return ok({ deleted: true });
    }

    return err("Unknown action: " + action);

  } catch(e) {
    console.error("[generate]", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
