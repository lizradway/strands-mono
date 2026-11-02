"""Context-manager knob sweep for Harbor's strands-custom harness.

One class per arm. Each builds Harbor's strandsharness agent (the wrapper below is copied
from strands-agents/harbor, harbor-runner/strands-infra-runner/agents/strandsharness/agent.py)
and differs only in the ``context_manager=`` passed to ``create_harness``.

Every arm runs without the ``web_fetch`` tool and is told not to look up the upstream fix:
ContextBench tasks are real, publicly fixed bugs, and fetching the fix inflates coverage
independently of the context manager. The shell keeps network access for build dependencies.

Utilization values assume Sonnet 4.6's 1M-token window: 0.04 is about 40K tokens, 0.08 about
80K. Every arm ends with the SDK's emergency truncate, which ContextManager always appends.
"""

import os

from strands import Agent
from strands.experimental.context_manager import Offload
from strands.tools.executors import SequentialToolExecutor
from strands_harness import create_harness

_MANTLE_ROUTE_PREFIX = "openai."
_MANTLE_OPENAI_VENDOR_PREFIX = "openai.gpt"
_MANTLE_HOST = "bedrock-mantle."
_MANTLE_ANTHROPIC_BUILTIN_TOOLS = {"web_search": False}
_NO_LOOKUP = (
    "Do not look up this bug's fix online: no GitHub issues, pull requests, commits or diffs for "
    "this repository, by any tool. Downloading build dependencies is fine."
)


def _task_instructions(task_workdir: str | None) -> str:
    if not task_workdir:
        return _NO_LOOKUP
    return (
        f"You are working inside a benchmark task container. The task root is {task_workdir}. "
        "Run `pwd` before acting, resolve task files relative to that root, and use absolute paths "
        "when writing or editing files. " + _NO_LOOKUP
    )


def _mantle_endpoint_model_id(model_id: str) -> str:
    if model_id.startswith(_MANTLE_OPENAI_VENDOR_PREFIX):
        return model_id
    return model_id.removeprefix(_MANTLE_ROUTE_PREFIX)


def _resolve_model():
    model_id = os.environ.get("STRANDS_MODEL")
    if not model_id:
        return None
    if model_id.startswith(_MANTLE_ROUTE_PREFIX):
        mantle_config = {"region": os.environ.get("AWS_REGION", "us-east-1")}
        if "gpt-5" in model_id:
            from strands.models.openai_responses import OpenAIResponsesModel

            return OpenAIResponsesModel(model_id=model_id, bedrock_mantle_config=mantle_config)
        else:
            from strands.models.openai import OpenAIModel

            return OpenAIModel(
                model_id=_mantle_endpoint_model_id(model_id), bedrock_mantle_config=mantle_config
            )
    return model_id


def _on_mantle_anthropic_endpoint() -> bool:
    return _MANTLE_HOST in os.environ.get("ANTHROPIC_BASE_URL", "")


def _tool_executor():
    if not os.environ.get("STRANDSHARNESS_SEQUENTIAL_TOOLS"):
        return None
    return SequentialToolExecutor()


def _build(context_manager) -> Agent:
    task_workdir = os.environ.get("HARBOR_TASK_WORKDIR")
    if task_workdir:
        os.chdir(task_workdir)
    executor = _tool_executor()
    builtin_tools = {"web_fetch": False}
    if _on_mantle_anthropic_endpoint():
        builtin_tools.update(_MANTLE_ANTHROPIC_BUILTIN_TOOLS)
    kwargs = {
        "model": _resolve_model(),
        **({"tool_executor": executor} if executor is not None else {}),
        "builtin_tools": builtin_tools,
        **({"effort": os.environ["HARBOR_REASONING_EFFORT"]} if os.environ.get("HARBOR_REASONING_EFFORT") else {}),
        "instructions": _task_instructions(task_workdir),
        "context_manager": context_manager,
    }
    return create_harness(**kwargs)


def _lead_truncate(threshold: int = 1500, preview_tokens: int = 750):
    return Offload.truncate("tool_results", {"preview_tokens": preview_tokens}).when(threshold=threshold)


def _compact_summarize(utilization: float = 0.85, preserve_recent: int = 4):
    return Offload.summarize("*").when(utilization=utilization, preserve_recent=preserve_recent)


def _pipeline(*strategies) -> dict:
    return {"strategies": list(strategies)}


class AutoAgent:
    """Control: the literal "auto" preset."""

    def create_agent(self) -> Agent:
        return _build("auto")


class AutoRepAgent(AutoAgent):
    """Second run of auto, for the run-to-run noise floor."""


class U1Agent:
    def create_agent(self) -> Agent:
        return _build(_pipeline(_lead_truncate(), _compact_summarize(utilization=0.08)))


class U2Agent:
    def create_agent(self) -> Agent:
        return _build(_pipeline(_lead_truncate(), _compact_summarize(utilization=0.04)))


class U3Agent:
    def create_agent(self) -> Agent:
        return _build(_pipeline(_lead_truncate(), _compact_summarize(utilization=0.04, preserve_recent=12)))


class U5Agent:
    def create_agent(self) -> Agent:
        return _build(_pipeline(_lead_truncate(), Offload.truncate("*").when(utilization=0.04, preserve_recent=4)))


class T1Agent:
    def create_agent(self) -> Agent:
        return _build(_pipeline(_lead_truncate(threshold=750, preview_tokens=375), _compact_summarize()))


class T2Agent:
    def create_agent(self) -> Agent:
        return _build(_pipeline(_lead_truncate(threshold=3000), _compact_summarize()))


class A1Agent:
    def create_agent(self) -> Agent:
        return _build(
            _pipeline(
                _lead_truncate(),
                Offload.drop("tool_result_errors").when(preserve_recent=2),
                _compact_summarize(),
            )
        )


class A2Agent:
    def create_agent(self) -> Agent:
        return _build(
            _pipeline(
                _lead_truncate(),
                Offload.truncate("tool_results", {"preview_tokens": 150}).when(threshold=300, preserve_recent=12),
                _compact_summarize(),
            )
        )


class A3Agent:
    def create_agent(self) -> Agent:
        return _build(
            _pipeline(
                _lead_truncate(),
                Offload.truncate("assistant_text", {"preview_tokens": 200}).when(threshold=400, preserve_recent=4),
                _compact_summarize(),
            )
        )


class A4Agent:
    def create_agent(self) -> Agent:
        return _build(
            _pipeline(
                _lead_truncate(),
                Offload.truncate("tool_result_errors", {"preview_tokens": 100}).when(threshold=200, preserve_recent=2),
                _compact_summarize(),
            )
        )


class A5Agent:
    """Model-written summaries of very large tool results, ahead of the truncate step."""

    def create_agent(self) -> Agent:
        return _build(
            _pipeline(
                Offload.summarize("tool_results").when(threshold=4000),
                _lead_truncate(),
                _compact_summarize(),
            )
        )


class A6Agent:
    def create_agent(self) -> Agent:
        return _build(
            _pipeline(
                _lead_truncate(),
                Offload.drop("tool_results").when(preserve_recent=30),
                _compact_summarize(),
            )
        )


def _shell_tail(threshold: int = 600, preview_tokens: int = 300):
    return Offload.truncate(["tool::shell"], {"preview_tokens": preview_tokens, "preview": "tail"}).when(
        threshold=threshold
    )


class E1Agent:
    """Shell output keeps a shorter tail preview: build and test logs end with the result."""

    def create_agent(self) -> Agent:
        return _build(_pipeline(_shell_tail(), _lead_truncate(), _compact_summarize()))


class E2Agent:
    """T1 plus E1."""

    def create_agent(self) -> Agent:
        return _build(
            _pipeline(_shell_tail(), _lead_truncate(threshold=750, preview_tokens=375), _compact_summarize())
        )


class L1Agent:
    """At about 80K tokens, drops older turns whose tool result is still over 500 tokens.

    The threshold sits below the lead truncate's 750-token preview, which runs first on arrival.
    """

    def create_agent(self) -> Agent:
        return _build(
            _pipeline(
                _lead_truncate(),
                Offload.drop("tool_results").when(threshold=500, utilization=0.08, preserve_recent=8),
                _compact_summarize(),
            )
        )


class L2Agent:
    """At about 80K tokens, drops the older half of read and shell turns; edits and writes stay."""

    def create_agent(self) -> Agent:
        return _build(
            _pipeline(
                _lead_truncate(),
                Offload.drop(["tool::read", "tool::shell"]).when(utilization=0.08, preserve_recent=0.5),
                _compact_summarize(),
            )
        )
