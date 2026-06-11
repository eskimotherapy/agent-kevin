#!/usr/bin/env python3
"""List Claude Code sessions active in the last N hours across all projects.

Scans ~/.claude/projects/*/*.jsonl, extracts per-session metadata, and prints
JSON sorted by last activity (most recent first). Read-only, no network.
"""
import argparse
import json
import os
import re
import sys
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

PROJECTS_DIR = Path.home() / ".claude" / "projects"
USER_SNIPPET = 400
ASSISTANT_SNIPPET = 1500


def is_real_user_text(text):
    t = text.strip()
    if not t or t.startswith("<") or t.startswith("[Request interrupted"):
        return False
    return not t.startswith("Base directory for this skill:")  # injected skill payloads


def user_texts(record):
    content = record.get("message", {}).get("content")
    if isinstance(content, str):
        return [content] if is_real_user_text(content) else []
    if isinstance(content, list):
        return [
            block["text"]
            for block in content
            if isinstance(block, dict) and block.get("type") == "text" and is_real_user_text(block["text"])
        ]
    return []


def assistant_texts(record):
    content = record.get("message", {}).get("content")
    if not isinstance(content, list):
        return []
    return [
        block["text"]
        for block in content
        if isinstance(block, dict) and block.get("type") == "text" and block["text"].strip()
    ]


def parse_session(path):
    info = {
        "session_id": path.stem,
        "file": str(path),
        "title": None,
        "cwd": None,
        "git_branch": None,
        "first_user_msg": None,
        "recent_user_msgs": None,
        "last_assistant_text": None,
        "user_turns": 0,
        "started": None,
        "last_timestamp": None,
    }
    recent_user = deque(maxlen=3)
    tail_assistant = deque(maxlen=2)
    with open(path, errors="replace") as handle:
        for line in handle:
            try:
                record = json.loads(line)
            except (json.JSONDecodeError, ValueError):
                continue
            rtype = record.get("type")
            if rtype == "ai-title":
                info["title"] = record.get("aiTitle") or info["title"]
                continue
            if record.get("isSidechain"):
                continue
            ts = record.get("timestamp")
            if ts:
                info["started"] = info["started"] or ts
                info["last_timestamp"] = ts
            info["cwd"] = record.get("cwd") or info["cwd"]
            info["git_branch"] = record.get("gitBranch") or info["git_branch"]
            if rtype == "user":
                texts = user_texts(record)
                if texts:
                    info["user_turns"] += 1
                    info["first_user_msg"] = info["first_user_msg"] or texts[0][:USER_SNIPPET]
                    recent_user.append(texts[-1][:USER_SNIPPET])
            elif rtype == "assistant":
                for text in assistant_texts(record):
                    tail_assistant.append(text)
    info["recent_user_msgs"] = list(recent_user)
    if tail_assistant:
        info["last_assistant_text"] = tail_assistant[-1][:ASSISTANT_SNIPPET]
    return info


def in_scope(project_dirname, scope):
    # transcript dirs encode the launch cwd with non-alphanumerics flattened to "-"
    encoded = re.sub(r"[^A-Za-z0-9-]", "-", scope)
    return project_dirname == encoded or project_dirname.startswith(encoded + "-")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--hours", type=float, default=12)
    parser.add_argument("--scope", default=os.getcwd(),
                        help="only sessions launched under this path; 'all' disables scoping")
    args = parser.parse_args()

    cutoff = time.time() - args.hours * 3600
    scope = None if args.scope == "all" else str(Path(args.scope).resolve())
    sessions = []
    for path in PROJECTS_DIR.glob("*/*.jsonl"):
        if path.name.startswith("agent-"):  # subagent sidechain transcripts
            continue
        if scope and not in_scope(path.parent.name, scope):
            continue
        mtime = path.stat().st_mtime
        if mtime < cutoff:
            continue
        info = parse_session(path)
        if info["user_turns"] == 0:  # hook-only / empty shells, nothing to resume
            continue
        info["last_active"] = datetime.fromtimestamp(mtime, tz=timezone.utc).astimezone().isoformat(timespec="minutes")
        info["minutes_ago"] = int((time.time() - mtime) / 60)
        sessions.append(info)

    sessions.sort(key=lambda s: s["minutes_ago"])
    json.dump({"generated_at": datetime.now().astimezone().isoformat(timespec="minutes"),
               "scope": scope or "all",
               "window_hours": args.hours,
               "count": len(sessions),
               "sessions": sessions}, sys.stdout, indent=1)


if __name__ == "__main__":
    main()
