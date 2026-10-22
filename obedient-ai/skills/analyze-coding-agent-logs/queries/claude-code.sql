-- Claude Code adapter. Creates view `t` from JSONL transcripts.
-- Also works for any harness that stores tool calls as message.content[] with
-- tool_use / tool_result pairs. Adjust the glob and the field paths in `calls`/`results`.
-- Usage: duckdb -box < claude-code.sql

CREATE OR REPLACE VIEW calls AS
  SELECT
    json_extract_string(m.json,'$.sessionId') AS session,
    json_extract_string(c.value,'$.id') AS call_id,
    json_extract_string(c.value,'$.name') AS tool,
    CAST(json_extract_string(m.json,'$.timestamp') AS TIMESTAMPTZ) AS ts,
    json_extract(c.value,'$.input') AS input,
    json_extract_string(c.value,'$.input.file_path') AS fp,
    json_extract_string(c.value,'$.input.command') AS command
  FROM read_json_auto('/Users/vijay/.claude/projects/*/*.jsonl', union_by_name=true) m,
       json_each(json_extract(m.json,'$.message.content')) c
  WHERE json_extract_string(c.value,'$.type')='tool_use';

CREATE OR REPLACE VIEW results AS
  SELECT
    json_extract_string(c.value,'$.tool_use_id') AS call_id,
    CAST(json_extract_string(m.json,'$.timestamp') AS TIMESTAMPTZ) AS ts,
    json_extract_string(c.value,'$.is_error') AS is_error,
    json_extract_string(c.value,'$.content')    AS content
  FROM read_json_auto('/Users/vijay/.claude/projects/*/*.jsonl', union_by_name=true) m,
       json_each(json_extract(m.json,'$.message.content')) c
  WHERE json_extract_string(c.value,'$.type')='tool_result';

CREATE OR REPLACE VIEW t AS
  SELECT c.session, c.ts, c.tool, c.input, c.fp, c.command,
    CASE WHEN r.is_error IN ('true','1') THEN 'error' ELSE 'completed' END AS status,
    epoch_ms(r.ts) - epoch_ms(c.ts) AS dur_ms,
    CASE WHEN r.is_error IN ('true','1') THEN left(r.content, 200) END AS error
  FROM calls c LEFT JOIN results r USING (call_id)
  WHERE c.ts >= now() - INTERVAL 15 DAY;

-- 1. Call mix and latency.
SELECT tool, count(*) n,
  round(100.0*count(*)/sum(count(*)) OVER (),1) pct,
  round(quantile_cont(dur_ms/1000.0,0.5),2) p50_s,
  round(quantile_cont(dur_ms/1000.0,0.95),2) p95_s,
  sum(CASE WHEN status='error' THEN 1 ELSE 0 END) errs
FROM t GROUP BY 1 ORDER BY n DESC;

-- 2. Error classes.
SELECT tool,
  CASE
    WHEN error LIKE '%does not exist%' OR error LIKE '%No such tool%' THEN 'tool_name_guess'
    WHEN error LIKE '%old_string%' OR error LIKE '%String to replace not found%' THEN 'edit_anchor_miss'
    WHEN error LIKE '%No such file%' OR error LIKE '%does not exist%' THEN 'path_guess'
    ELSE 'other'
  END AS klass,
  count(*) n
FROM t WHERE status='error' GROUP BY 1,2 HAVING n>0 ORDER BY n DESC;

-- 3. Repetition: same session + same input.
SELECT tool, count(*) dup_groups, sum(n) calls, sum(n-1) wasted
FROM (SELECT tool, session, input::VARCHAR ip, count(*) n
      FROM t WHERE input IS NOT NULL AND tool<>'Question'
      GROUP BY 1,2,3 HAVING count(*)>1)
GROUP BY 1 ORDER BY wasted DESC;

-- 3b. Duplicates inside one turn: Claude Code writes one line per turn, so
-- group by the truncated timestamp second as a proxy.
SELECT count(*) clusters, sum(n-1) wasted
FROM (SELECT session, date_trunc('second', ts) turn, tool, input::VARCHAR ip, count(*) n
      FROM t WHERE input IS NOT NULL
      GROUP BY 1,2,3,4 HAVING count(*)>1);

-- 5. Silent failures: Bash non-zero exit surfaced in the result text.
SELECT tool, count(*) n
FROM t WHERE tool='Bash' AND status='completed'
  AND (error LIKE '%exit code%' OR error LIKE '%Exit code%')
GROUP BY 1;
