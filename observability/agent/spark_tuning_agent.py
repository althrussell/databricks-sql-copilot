"""
Spark Tuning Agent — MLflow ResponsesAgent for interactive Spark performance analysis.

Deploy this agent to a Databricks Model Serving endpoint. It uses UC functions
(sqlmetrics, photonmetrics, getslowestjobs, getsloweststages) for live SHS data
and Claude Sonnet 4.5 for analysis.

Usage:
  1. Set environment variables: USER_PAT_OVERRIDE, USER_CP_URL_OVERRIDE
  2. Log with mlflow.models.set_model(agent)
  3. Deploy via agents.deploy()
"""

import json
import os
import warnings
from typing import Any, Callable, Generator
from uuid import uuid4

import mlflow
from mlflow.entities import SpanType
from mlflow.pyfunc import ResponsesAgent
from mlflow.types.responses import (
    ResponsesAgentRequest,
    ResponsesAgentResponse,
    ResponsesAgentStreamEvent,
    output_to_responses_items_stream,
    to_chat_completions_input,
)
from openai import OpenAI
from pydantic import BaseModel
from databricks.sdk import WorkspaceClient
from unitycatalog.ai.core.databricks import DatabricksFunctionClient

LLM_ENDPOINT = "databricks-claude-sonnet-4-5"
MAX_TOKENS = 125000
CATALOG = os.getenv("UC_CATALOG", "main")
SCHEMA = os.getenv("UC_SCHEMA", "unified_observability")

SYSTEM_PROMPT = """You are a senior Spark performance engineer with deep expertise in Databricks.
You have access to tools that fetch live Spark History Server metrics for any cluster.

When a user asks about tuning a Spark job:
1. Use the available tools to fetch the cluster's metrics
2. Analyze execution plans, stage durations, shuffle patterns, spill, and resource utilization
3. Provide specific, actionable recommendations ranked by expected impact
4. When asked about Photon, analyze which operators are Photon-compatible vs incompatible

Always explain your reasoning and provide evidence from the metrics data."""


class ToolInfo(BaseModel):
    name: str
    spec: dict
    exec_fn: Callable


class SparkTuningAgent(ResponsesAgent):
    def __init__(self):
        self.workspace_client = WorkspaceClient()
        self.model_serving_client: OpenAI = (
            self.workspace_client.serving_endpoints.get_open_ai_client()
        )
        self._tools_dict = self._load_tools()

    def _load_tools(self) -> dict[str, ToolInfo]:
        tools: dict[str, ToolInfo] = {}

        tool_defs = [
            {
                "name": "get_slowest_jobs",
                "uc_func": f"{CATALOG}.{SCHEMA}.getslowestjobs",
                "desc": "Get the slowest Spark jobs for a cluster, sorted by runtime",
                "params": {"cluster_id": {"type": "string", "description": "Databricks cluster ID"}},
            },
            {
                "name": "get_slowest_stages",
                "uc_func": f"{CATALOG}.{SCHEMA}.getsloweststages",
                "desc": "Get the slowest Spark stages for a cluster, with spill and shuffle metrics",
                "params": {"cluster_id": {"type": "string", "description": "Databricks cluster ID"}},
            },
            {
                "name": "get_sql_metrics",
                "uc_func": f"{CATALOG}.{SCHEMA}.sqlmetrics",
                "desc": "Get Spark SQL execution plan node metrics for deep analysis",
                "params": {"cluster_id": {"type": "string", "description": "Databricks cluster ID"}},
            },
            {
                "name": "get_photon_estimate",
                "uc_func": f"{CATALOG}.{SCHEMA}.photonmetrics",
                "desc": "Estimate what percentage of the Spark workload is Photon-eligible",
                "params": {"cluster_id": {"type": "string", "description": "Databricks cluster ID"}},
            },
        ]

        for td in tool_defs:
            spec = {
                "type": "function",
                "function": {
                    "name": td["name"],
                    "description": td["desc"],
                    "parameters": {
                        "type": "object",
                        "properties": td["params"],
                        "required": list(td["params"].keys()),
                    },
                },
            }

            uc_func_name = td["uc_func"]

            def make_exec(fname: str) -> Callable:
                def exec_fn(**kwargs: Any) -> str:
                    pat = os.environ.get("USER_PAT_OVERRIDE", "")
                    cp_url = os.environ.get("USER_CP_URL_OVERRIDE", "")
                    if not pat or not cp_url:
                        return json.dumps({"error": "Missing USER_PAT_OVERRIDE or USER_CP_URL_OVERRIDE"})
                    try:
                        client = DatabricksFunctionClient(
                            client=WorkspaceClient(host=cp_url, token=pat)
                        )
                        res = client.execute_function(fname, kwargs)
                        if res.error:
                            return f"Error: {res.error}"
                        val = res.value
                        return json.dumps(val) if not isinstance(val, str) else val
                    except Exception as e:
                        return f"Exception: {str(e)}"
                return exec_fn

            tools[td["name"]] = ToolInfo(
                name=td["name"],
                spec=spec,
                exec_fn=make_exec(uc_func_name),
            )

        return tools

    def get_tool_specs(self) -> list[dict]:
        return [t.spec for t in self._tools_dict.values()]

    @mlflow.trace(span_type=SpanType.TOOL)
    def execute_tool(self, tool_name: str, args: dict) -> Any:
        return self._tools_dict[tool_name].exec_fn(**args)

    def call_llm(self, messages: list[dict[str, Any]]) -> Generator[dict[str, Any], None, None]:
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", message="PydanticSerializationUnexpectedValue")
            for chunk in self.model_serving_client.chat.completions.create(
                model=LLM_ENDPOINT,
                messages=to_chat_completions_input(messages),
                tools=self.get_tool_specs(),
                stream=True,
                max_tokens=MAX_TOKENS,
            ):
                chunk_dict = chunk.to_dict()
                if len(chunk_dict.get("choices", [])) > 0:
                    yield chunk_dict

    def handle_tool_call(
        self, tool_call: dict[str, Any], messages: list[dict[str, Any]]
    ) -> ResponsesAgentStreamEvent:
        try:
            args = json.loads(tool_call.get("arguments", "{}"))
        except Exception:
            args = {}
        result = str(self.execute_tool(tool_name=tool_call["name"], args=args))
        output = self.create_function_call_output_item(tool_call["call_id"], result)
        messages.append(output)
        return ResponsesAgentStreamEvent(type="response.output_item.done", item=output)

    def call_and_run_tools(
        self, messages: list[dict[str, Any]], max_iter: int = 10
    ) -> Generator[ResponsesAgentStreamEvent, None, None]:
        for _ in range(max_iter):
            last_msg = messages[-1]
            if last_msg.get("role") == "assistant":
                return
            elif last_msg.get("type") == "function_call":
                yield self.handle_tool_call(last_msg, messages)
            else:
                yield from output_to_responses_items_stream(
                    chunks=self.call_llm(messages), aggregator=messages
                )
        yield ResponsesAgentStreamEvent(
            type="response.output_item.done",
            item=self.create_text_output_item("Max iterations reached.", str(uuid4())),
        )

    def predict(self, request: ResponsesAgentRequest) -> ResponsesAgentResponse:
        outputs = [
            event.item
            for event in self.predict_stream(request)
            if event.type == "response.output_item.done"
        ]
        return ResponsesAgentResponse(output=outputs, custom_outputs=request.custom_inputs)

    def predict_stream(
        self, request: ResponsesAgentRequest
    ) -> Generator[ResponsesAgentStreamEvent, None, None]:
        messages = to_chat_completions_input([i.model_dump() for i in request.input])
        messages.insert(0, {"role": "system", "content": SYSTEM_PROMPT})
        yield from self.call_and_run_tools(messages=messages)


AGENT = SparkTuningAgent()
mlflow.models.set_model(AGENT)
