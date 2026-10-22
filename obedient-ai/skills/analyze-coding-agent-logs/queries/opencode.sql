-- OpenCode adapter. Creates view `t`, then runs the six analyses.
-- Edit the WHERE clause in `t`: pin a literal cutoff for before/after runs.
-- Usage: duckdb -box < opencode.sql

LOAD sqlite;
ATTACH '/Users/vijay/.local/share/opencode/opencode.db' AS oc (TYPE sqlite);

CREATE OR REPLACE VIEW raw_tools AS
  SELECT
    m.session_id,
    m.time_created AS msg_created,
    to_timestamp(m.time_created/1000) AS ts,
    json_extract_string(c.value,'$.name') AS tool,
    json_extract_string(c.value,'$.state.status') AS status,
    json_extract(c.value,'$.state.input') AS input,
    json_extract_string(c.value,'$.state.input.path') AS path,
    json_extract_string(c.value,'$.state.input.filePath') AS file_path,
    json_extract_string(c.value,'$.state.input.command') AS command,
    COALESCE(CAST(json_extract(c.value,'$.time.start') AS BIGINT),
             CAST(json_extract(c.value,'$.time.created') AS BIGINT)) AS t_start,
    COALESCE(CAST(json_extract(c.value,'$.time.end') AS BIGINT),
             CAST(json_extract(c.value,'$.time.completed') AS BIGINT)) AS t_end,
    length(json_extract_string(c.value,'$.state.output')) AS out_len_legacy,
    length(json_extract_string(c.value,'$.state.content[0].text')) AS out_len,
    json_extract_string(c.value,'$.state.error.message') AS error,
    json_extract_string(c.value,'$.state.metadata.exit') AS exit_code
  FROM oc.session_message m,
       json_each(json_extract(m.data,'$.content')) c
  WHERE m.type='assistant'
    AND json_extract_string(c.value,'$.type')='tool';

CREATE OR REPLACE VIEW t AS
  SELECT *, coalesce(file_path, path) AS fp,
         (t_end - t_start)/1000.0 AS dur,
         coalesce(out_len, out_len_legacy) AS olen
  FROM raw_tools
  WHERE ts >= now() - INTERVAL 15 DAY;

-- 1. Call mix and latency.
SELECT tool, count(*) n,
  round(100.0*count(*)/sum(count(*)) OVER (),1) pct,
  round(quantile_cont(dur,0.5),2) p50_s,
  round(quantile_cont(dur,0.95),2) p95_s,
  sum(CASE WHEN status<>'completed' THEN 1 ELSE 0 END) errs
FROM t GROUP BY 1 ORDER BY n DESC;

-- 2. Error classes.
SELECT tool,
  CASE
    WHEN error LIKE '%No tool named%' THEN 'tool_name_guess'
    WHEN error LIKE '%identical%' THEN 'edit_noop'
    WHEN error LIKE '%Could not find oldString%' THEN 'edit_anchor_miss'
    WHEN error LIKE '%File not found%' THEN 'path_guess'
    ELSE 'other'
  END AS klass,
  count(*) n
FROM t WHERE status<>'completed' GROUP BY 1,2 HAVING n>0 ORDER BY n DESC;

-- 3. Repetition: same session + same input.
SELECT tool, count(*) dup_groups, sum(n) calls, sum(n-1) wasted
FROM (SELECT tool, session_id, input::VARCHAR ip, count(*) n
      FROM t WHERE input IS NOT NULL AND tool<>'question'
      GROUP BY 1,2,3 HAVING count(*)>1)
GROUP BY 1 ORDER BY wasted DESC;

-- 3b. Duplicates inside one turn (dispatched in parallel).
SELECT count(*) turns, sum(n-1) wasted
FROM (SELECT msg_created, session_id, tool, input::VARCHAR ip, count(*) n
      FROM t WHERE input IS NOT NULL
      GROUP BY 1,2,3,4 HAVING count(*)>1);

-- 5. Silent failures: non-zero exit reported as completed.
SELECT tool, exit_code, count(*) n, round(sum(dur)/60,1) mins
FROM t WHERE tool='shell' AND exit_code IS NOT NULL AND exit_code<>'0'
GROUP BY 1,2 ORDER BY n DESC;

-- 6. Context weight per tool.
SELECT tool, round(sum(olen)/1048576.0,2) total_mb,
  round(avg(olen)/1024.0,0) avg_kb, max(olen)/1024 max_kb
FROM t GROUP BY 1 ORDER BY total_mb DESC;
