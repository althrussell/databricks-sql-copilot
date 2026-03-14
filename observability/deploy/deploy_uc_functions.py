# Databricks notebook source
# Deploy UC connections, upstream functions, and LLM tools for Framework 1.
# Run this notebook on any Databricks cluster with access to the `shscreds` secret scope.

CATALOG = "main"
SCHEMA = "unified_observability"

spark.sql(f"CREATE SCHEMA IF NOT EXISTS {CATALOG}.{SCHEMA}")
spark.sql(f"USE CATALOG {CATALOG}")
spark.sql(f"USE SCHEMA {SCHEMA}")

# ── HTTP Connections ─────────────────────────────────────────────────

spark.sql("""
CREATE CONNECTION IF NOT EXISTS clusterapi
  TYPE HTTP
  OPTIONS (
    host secret("shscreds", "wsurl"),
    port '443',
    base_path '/',
    bearer_token secret("shscreds", "token")
  )
""")

spark.sql("""
CREATE CONNECTION IF NOT EXISTS shsjobs
  TYPE HTTP
  OPTIONS (
    host secret("shscreds", "dpurl"),
    port '443',
    base_path '/',
    bearer_token secret("shscreds", "token")
  )
""")

print("Connections created: clusterapi, shsjobs")

# ── Upstream Functions (raw SHS access) ──────────────────────────────

spark.sql("""
CREATE OR REPLACE FUNCTION clustermetrics(clusterid STRING)
RETURNS STRING
COMMENT 'Fetches cluster config from Databricks REST API'
RETURN (
  http_request(
    conn => 'clusterapi',
    method => 'GET',
    path => format_string("api/2.1/clusters/get?cluster_id=%s", clusterid)
  )
).text
""")

spark.sql("""
CREATE OR REPLACE FUNCTION listappsraw(clusterid STRING)
RETURNS STRING
COMMENT 'Lists Spark applications from SHS for a cluster'
RETURN (
  http_request(
    conn => 'shsjobs',
    method => 'GET',
    path => format_string(
      "sparkui/%s/driver-%s/api/v1/applications",
      clusterid,
      clustermetrics(clusterid):spark_context_id
    ),
    headers => map('Cookie', format_string("DATAPLANE_DOMAIN_DBAUTH=%s", secret("shscreds", "cookies")))
  )
).text
""")

spark.sql("""
CREATE OR REPLACE FUNCTION getappid(clusterid STRING)
RETURNS STRING
COMMENT 'Gets the application ID for a cluster'
RETURN try_parse_json(listappsraw(clusterid))::array<struct<id:string>>[0]["id"]
""")

spark.sql("""
CREATE OR REPLACE FUNCTION listshsjobsraw(clusterid STRING)
RETURNS STRING
COMMENT 'Raw SHS jobs list'
RETURN (
  http_request(
    conn => 'shsjobs',
    method => 'GET',
    path => format_string(
      "sparkui/%s/driver-%s/api/v1/applications/%s/jobs",
      clusterid, clustermetrics(clusterid):spark_context_id, getappid(clusterid)
    ),
    headers => map('Cookie', format_string("DATAPLANE_DOMAIN_DBAUTH=%s", secret("shscreds", "cookies")))
  )
).text
""")

spark.sql("""
CREATE OR REPLACE FUNCTION listshsstagesraw(clusterid STRING)
RETURNS STRING
COMMENT 'Raw SHS stages list'
RETURN (
  http_request(
    conn => 'shsjobs',
    method => 'GET',
    path => format_string(
      "sparkui/%s/driver-%s/api/v1/applications/%s/stages",
      clusterid, clustermetrics(clusterid):spark_context_id, getappid(clusterid)
    ),
    headers => map('Cookie', format_string("DATAPLANE_DOMAIN_DBAUTH=%s", secret("shscreds", "cookies")))
  )
).text
""")

spark.sql("""
CREATE OR REPLACE FUNCTION listshssqlraw(clusterid STRING)
RETURNS STRING
COMMENT 'Raw SHS SQL queries list'
RETURN (
  http_request(
    conn => 'shsjobs',
    method => 'GET',
    path => format_string(
      "sparkui/%s/driver-%s/api/v1/applications/%s/sql",
      clusterid, clustermetrics(clusterid):spark_context_id, getappid(clusterid)
    ),
    headers => map('Cookie', format_string("DATAPLANE_DOMAIN_DBAUTH=%s", secret("shscreds", "cookies")))
  )
).text
""")

spark.sql("""
CREATE OR REPLACE FUNCTION listshsexecutorsraw(clusterid STRING)
RETURNS STRING
COMMENT 'Raw SHS executors list'
RETURN (
  http_request(
    conn => 'shsjobs',
    method => 'GET',
    path => format_string(
      "sparkui/%s/driver-%s/api/v1/applications/%s/allexecutors",
      clusterid, clustermetrics(clusterid):spark_context_id, getappid(clusterid)
    ),
    headers => map('Cookie', format_string("DATAPLANE_DOMAIN_DBAUTH=%s", secret("shscreds", "cookies")))
  )
).text
""")

print("Upstream functions created: clustermetrics, listappsraw, getappid, listshsjobsraw, listshsstagesraw, listshssqlraw, listshsexecutorsraw")

# ── Table-Valued Functions (parsed SHS data) ─────────────────────────

spark.sql("""
CREATE OR REPLACE FUNCTION getslowestjobs(clusterid STRING)
RETURNS TABLE (
  jobId STRING, name STRING, description STRING, submissionTime STRING,
  completionTime STRING, stageIds STRING, status STRING, numTasks DOUBLE,
  numCompletedTasks DOUBLE, numSkippedTasks DOUBLE, numFailedTasks DOUBLE,
  numCompletedStages DOUBLE, numSkippedStages DOUBLE, numFailedStages DOUBLE,
  runtimesec LONG
)
COMMENT 'Slowest Spark jobs by runtime'
RETURN
WITH raw AS (
  SELECT try_parse_json(listshsjobsraw(clusterid))::array<struct<
    jobId:string, name:string, description:string, submissionTime:string,
    completionTime:string, stageIds:string, status:string, numTasks:double,
    numCompletedTasks:double, numSkippedTasks:double, numFailedTasks:double,
    numCompletedStages:double, numSkippedStages:double, numFailedStages:double
  >> AS jobmetrics
),
explode AS (SELECT explode(jobmetrics) AS j FROM raw)
SELECT j.*,
  timestampdiff(second, to_timestamp(j.submissionTime), to_timestamp(j.completionTime)) AS runtimesec
FROM explode
ORDER BY runtimesec DESC
""")

spark.sql("""
CREATE OR REPLACE FUNCTION getsloweststages(clusterid STRING)
RETURNS TABLE (
  stageId STRING, attemptId STRING, name STRING, description STRING,
  submissionTime STRING, completionTime STRING, status STRING,
  numTasks DOUBLE, numCompletedTasks DOUBLE, numSkippedTasks DOUBLE,
  numFailedTasks DOUBLE, memoryBytesSpilled LONG, diskBytesSpilled LONG,
  inputBytes LONG, inputRecords LONG, outputBytes LONG, outputRecords LONG,
  shuffleReadBytes LONG, shuffleReadRecords LONG,
  shuffleWriteBytes LONG, shuffleWriteRecords LONG, runtimesec LONG
)
COMMENT 'Slowest Spark stages by runtime'
RETURN
WITH raw AS (
  SELECT try_parse_json(listshsstagesraw(clusterid))::array<struct<
    stageId:string, attemptId:string, name:string, description:string,
    submissionTime:string, completionTime:string, status:string,
    numTasks:double, numCompletedTasks:double, numSkippedTasks:double,
    numFailedTasks:double, memoryBytesSpilled:long, diskBytesSpilled:long,
    inputBytes:long, inputRecords:long, outputBytes:long, outputRecords:long,
    shuffleReadBytes:long, shuffleReadRecords:long,
    shuffleWriteBytes:long, shuffleWriteRecords:long
  >> AS stagemetrics
),
explode AS (SELECT explode(stagemetrics) AS s FROM raw)
SELECT s.*,
  timestampdiff(second, to_timestamp(s.submissionTime), to_timestamp(s.completionTime)) AS runtimesec
FROM explode
ORDER BY runtimesec DESC
""")

spark.sql("""
CREATE OR REPLACE FUNCTION getslowestsql(clusterid STRING)
RETURNS TABLE (
  id LONG, status STRING, description STRING, planDescription STRING,
  submissionTime STRING, duration LONG, successJobIds STRING,
  failedJobIds STRING
)
COMMENT 'Slowest Spark SQL queries by duration'
RETURN
WITH raw AS (
  SELECT try_parse_json(listshssqlraw(clusterid))::array<struct<
    id:long, status:string, description:string, planDescription:string,
    submissionTime:string, duration:long, successJobIds:string, failedJobIds:string
  >> AS sqlmetrics
),
explode AS (SELECT explode(sqlmetrics) AS sq FROM raw)
SELECT sq.*
FROM explode
ORDER BY sq.duration DESC
""")

print("Table-valued functions created: getslowestjobs, getsloweststages, getslowestsql")

# ── LLM Tool Functions ───────────────────────────────────────────────

spark.sql("""
CREATE OR REPLACE FUNCTION sqlmetrics(
  clusterid STRING, lim DOUBLE DEFAULT 20000, ranking DOUBLE DEFAULT 0
)
RETURNS TABLE (nodestring STRING, successJobIds ARRAY<STRING>, stringlength STRING, rank DOUBLE)
COMMENT 'SQL node execution metrics for LLM analysis'
RETURN
WITH raw AS (
  SELECT try_parse_json(listshssqlraw(clusterid))::array<struct<
    id:long, status:string, description:string, planDescription:string,
    submissionTime:string, duration:long, successJobIds:array<string>,
    failedJobIds:string,
    nodes:array<struct<nodeId:INT, nodeName:STRING, metrics:array<struct<name:STRING, value:STRING>>>>
  >> AS sqlmetrics
),
explode AS (SELECT explode(sqlmetrics) AS sq FROM raw),
pu AS (
  SELECT to_json(sq.nodes) AS nodestring, sq.successJobIds,
    len(to_binary(to_json(sq.nodes), "UTF-8")) AS stringlength,
    rank() OVER (ORDER BY len(to_binary(to_json(sq.nodes), "UTF-8")) DESC) AS rank
  FROM explode
)
SELECT nodestring, successJobIds, stringlength, rank
FROM pu
WHERE stringlength < lim
  AND IF(ranking = 0, 1 = 1, rank = ranking)
ORDER BY stringlength DESC
""")

spark.sql("""
CREATE OR REPLACE FUNCTION photonmetrics(clusterid STRING)
RETURNS DOUBLE
COMMENT 'Estimates percentage of Spark workload eligible for Photon acceleration'
RETURN
WITH raw AS (
  SELECT try_parse_json(listshssqlraw(clusterid))::array<struct<
    id:long, status:string, description:string, planDescription:string,
    submissionTime:string, duration:long, successJobIds:string, failedJobIds:string,
    nodes:array<struct<nodeId:INT, nodeName:STRING, metrics:array<struct<name:STRING, value:STRING>>>>
  >> AS sqlmetrics
),
firstexplode AS (SELECT explode(sqlmetrics) AS sq FROM raw),
secexplode AS (
  SELECT sq.*, nodemetrics
  FROM firstexplode
  LATERAL VIEW explode(sq.nodes) AS nodemetrics
),
photoncheck AS (
  SELECT *,
    CASE
      WHEN nodemetrics.nodeName IN ('MapElements','MapPartitions','Scan csv','Scan json',
        'PythonUDF','ScalaUDF','FlatMapGroupsInPandas','DeserializeToObject','SerializeFromObject') THEN 0
      ELSE 1
    END AS photonbinary
  FROM secexplode
),
jobcheck AS (
  SELECT try_divide(sum(photonbinary), count(*)) AS jobphotonperc
  FROM photoncheck
  GROUP BY ALL
)
SELECT jobphotonperc FROM jobcheck
""")

print("LLM tool functions created: sqlmetrics, photonmetrics")
print("\\nAll UC functions deployed successfully to main.unified_observability")
