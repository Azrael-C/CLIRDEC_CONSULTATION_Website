"""FastAPI + spaCy service for the controlled FacultyConnect assistant.

The service deliberately uses retrieval and intent matching instead of an
unrestricted generative model. Approved Supabase FAQ entries are preferred;
the bundled workflow answers keep the service useful during local setup.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import spacy
from fastapi import FastAPI, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from spacy.matcher import PhraseMatcher


def _origins() -> list[str]:
    configured = os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:5173,https://clsu-faculty-connect.vercel.app",
    )
    return [item.strip().rstrip("/") for item in configured.split(",") if item.strip()]


app = FastAPI(
    title="CLSU FacultyConnect NLP Assistant",
    description="Source-backed consultation guidance using FastAPI and spaCy.",
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

nlp = spacy.blank("en")
nlp.add_pipe("sentencizer")
matcher = PhraseMatcher(nlp.vocab, attr="LOWER")

INTENT_PHRASES: dict[str, list[str]] = {
    "booking": [
        "book consultation", "schedule appointment", "request consultation",
        "reserve a slot", "mag book", "magpa schedule", "kumuha ng appointment",
    ],
    "availability": [
        "available time", "faculty availability", "office hours", "open slot",
        "anong oras", "kailan available", "available ba",
    ],
    "expertise": [
        "faculty expertise", "find faculty", "appropriate professor", "research adviser",
        "sinong faculty", "sino ang expert", "anong faculty",
    ],
    "location": [
        "consultation location", "where is the meeting", "online meeting", "consultation room",
        "saan ang consultation", "meeting link",
    ],
    "cancel": [
        "cancel appointment", "reschedule consultation", "change schedule", "move appointment",
        "mag cancel", "ilipat ang schedule", "palitan ang oras",
    ],
    "status": [
        "appointment status", "request status", "is it confirmed", "faculty approval",
        "approved na ba", "confirmed na ba", "status ng request",
    ],
    "services": [
        "clirdec services", "portal services", "what can you do", "how can clirdec help",
        "anong serbisyo", "ano ang clirdec",
    ],
}

for intent_name, phrases in INTENT_PHRASES.items():
    matcher.add(intent_name, [nlp.make_doc(phrase) for phrase in phrases])

INTENT_KEYWORDS: dict[str, set[str]] = {
    "booking": {"book", "booking", "schedule", "appointment", "consultation", "reserve"},
    "availability": {"available", "availability", "hours", "open", "slot", "oras", "kailan"},
    "expertise": {"expert", "expertise", "faculty", "professor", "adviser", "topic", "sinong", "sino"},
    "location": {"where", "location", "room", "online", "link", "platform", "saan"},
    "cancel": {"cancel", "reschedule", "change", "move", "ilipat", "palitan"},
    "status": {"status", "confirmed", "approved", "pending", "declined"},
    "services": {"service", "services", "help", "clirdec", "portal", "offer", "serbisyo"},
}

SENSITIVE_TERMS = {
    "password", "otp", "grade", "grades", "medical", "diagnosis", "emergency",
    "harassment", "complaint", "disciplinary", "legal", "suicide", "self-harm",
}

DEFAULT_ANSWERS = {
    "booking": (
        "Open Faculty availability, choose a faculty-published time, describe your concern, "
        "and submit the request. The request remains pending until the faculty member approves it.",
        "FacultyConnect approved consultation workflow",
    ),
    "availability": (
        "The portal shows future Monday-to-Friday times published by faculty. A time closes "
        "atomically when a student requests it, preventing another active booking.",
        "Faculty-maintained availability schedule",
    ),
    "expertise": (
        "Search the faculty availability page by faculty name or approved expertise category. "
        "The portal helps you find options but does not automatically assign a faculty member.",
        "Faculty directory and verified expertise profiles",
    ),
    "location": (
        "The faculty member provides the CLIRDEC room or approved online platform when publishing "
        "the time. Confirmed request details show the final location.",
        "Faculty-maintained availability schedule",
    ),
    "cancel": (
        "Open My requests and choose Cancel or Choose another time. Rescheduling keeps the old "
        "request active until the replacement time is reserved successfully.",
        "FacultyConnect consultation workflow",
    ),
    "status": (
        "Open My requests to see whether the request is pending, confirmed, declined, cancelled, "
        "or completed. Important changes also queue an email notification.",
        "FacultyConnect appointment status rules",
    ),
    "services": (
        "FacultyConnect provides verified FAQ guidance, faculty discovery, published availability, "
        "consultation requests, status tracking, and email notifications for important events.",
        "FacultyConnect MVP scope",
    ),
}


@dataclass(frozen=True)
class KnowledgeItem:
    question: str
    answer: str
    category: str
    source_reference: str


class ChatRequest(BaseModel):
    message: str = Field(min_length=2, max_length=500)


class ChatResponse(BaseModel):
    answer: str
    intent: str
    confidence: float = Field(ge=0, le=1)
    escalation: bool
    source: str | None = None
    suggestions: list[str] = Field(default_factory=list)


class KnowledgeStatus(BaseModel):
    source: str
    approved_entries: int
    cache_seconds_remaining: int


_cache: tuple[float, list[KnowledgeItem], str] = (0.0, [], "bundled")
CACHE_TTL_SECONDS = max(30, int(os.getenv("FAQ_CACHE_SECONDS", "300")))


def _fetch_json(url: str, headers: dict[str, str], params: dict[str, str]) -> list[dict[str, Any]]:
    request = Request(f"{url}?{urlencode(params)}", headers=headers, method="GET")
    with urlopen(request, timeout=5) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, list):
        raise ValueError("FAQ response was not a list")
    return payload


def _tokens(text: str) -> set[str]:
    return {
        token.lower_
        for token in nlp(text)
        if token.is_alpha and not token.is_stop and len(token.text) > 1
    }


def classify_intent(message: str) -> tuple[str, float]:
    doc = nlp(message)
    scores = {name: 0.0 for name in INTENT_PHRASES}
    for match_id, start, end in matcher(doc):
        intent = nlp.vocab.strings[match_id]
        scores[intent] += 2.5 + (end - start) * 0.25
    tokens = _tokens(message)
    for intent, keywords in INTENT_KEYWORDS.items():
        scores[intent] += len(tokens & keywords)
    intent, score = max(scores.items(), key=lambda item: item[1])
    if score <= 0:
        return "fallback", 0.15
    return intent, min(0.96, 0.48 + score * 0.09)


def _rank_knowledge(message: str, items: list[KnowledgeItem]) -> tuple[KnowledgeItem | None, float]:
    query_tokens = _tokens(message)
    best: KnowledgeItem | None = None
    best_score = 0.0
    normalized = " ".join(message.lower().split())
    for item in items:
        candidate = f"{item.question} {item.category}"
        candidate_tokens = _tokens(candidate)
        overlap = len(query_tokens & candidate_tokens) / max(1, len(query_tokens | candidate_tokens))
        sequence = SequenceMatcher(None, normalized, item.question.lower()).ratio()
        score = overlap * 0.72 + sequence * 0.28
        if score > best_score:
            best, best_score = item, score
    return best, best_score


async def _load_approved_knowledge(authorization: str | None) -> tuple[list[KnowledgeItem], str]:
    global _cache
    expires, cached, source = _cache
    if cached and time.monotonic() < expires:
        return cached, source

    supabase_url = os.getenv("SUPABASE_URL", "").rstrip("/")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    anon_key = os.getenv("SUPABASE_ANON_KEY", "")
    api_key = service_key or anon_key
    bearer = service_key or (authorization.removeprefix("Bearer ").strip() if authorization else "")
    if not supabase_url or not api_key or not bearer:
        _cache = (time.monotonic() + CACHE_TTL_SECONDS, [], "bundled workflow answers")
        return [], "bundled workflow answers"

    headers = {"apikey": api_key, "Authorization": f"Bearer {bearer}"}
    params = {
        "select": "question,answer,category,source_reference",
        "status": "eq.approved",
        "order": "updated_at.desc",
        "limit": "200",
    }
    try:
        rows = await asyncio.to_thread(
            _fetch_json,
            f"{supabase_url}/rest/v1/faq_entries",
            headers,
            params,
        )
        items = [KnowledgeItem(**row) for row in rows]
        _cache = (time.monotonic() + CACHE_TTL_SECONDS, items, "Supabase approved FAQ entries")
        return items, "Supabase approved FAQ entries"
    except (HTTPError, URLError, TimeoutError, ValueError, TypeError, OSError):
        _cache = (time.monotonic() + 60, [], "bundled workflow answers")
        return [], "bundled workflow answers"


def build_response(message: str, knowledge: list[KnowledgeItem]) -> ChatResponse:
    lowered_tokens = _tokens(message)
    if lowered_tokens & SENSITIVE_TERMS:
        return ChatResponse(
            answer=(
                "I canâ€™t handle confidential records, emergencies, complaints, academic decisions, "
                "or account credentials. Please contact the appropriate CLSU or CLIRDEC office through "
                "an official channel."
            ),
            intent="sensitive_referral",
            confidence=0.99,
            escalation=True,
            source="CLSU privacy and safe-referral rule",
            suggestions=["Ask about consultation booking", "View faculty availability"],
        )

    matched_item, faq_score = _rank_knowledge(message, knowledge)
    intent, intent_confidence = classify_intent(message)
    if matched_item and faq_score >= 0.27:
        return ChatResponse(
            answer=matched_item.answer,
            intent=intent if intent != "fallback" else "approved_faq",
            confidence=min(0.98, 0.62 + faq_score * 0.36),
            escalation=False,
            source=matched_item.source_reference,
        )

    if intent in DEFAULT_ANSWERS and intent_confidence >= 0.55:
        answer, source = DEFAULT_ANSWERS[intent]
        return ChatResponse(
            answer=answer,
            intent=intent,
            confidence=intent_confidence,
            escalation=False,
            source=source,
        )

    return ChatResponse(
        answer=(
            "Iâ€™m not confident that I have an approved answer for that question. Please rephrase it "
            "as a booking, availability, faculty expertise, location, cancellation, status, or service question. "
            "For anything else, contact authorized CLIRDEC staff."
        ),
        intent="fallback",
        confidence=max(0.15, intent_confidence),
        escalation=True,
        source="Safe fallback and staff-referral rule",
        suggestions=["How do I request a consultation?", "When is a faculty member available?"],
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "nlp": "spaCy", "pipeline": ",".join(nlp.pipe_names)}


@app.get("/knowledge-status", response_model=KnowledgeStatus)
async def knowledge_status(authorization: str | None = Header(default=None)) -> KnowledgeStatus:
    items, source = await _load_approved_knowledge(authorization)
    remaining = max(0, int(_cache[0] - time.monotonic()))
    return KnowledgeStatus(source=source, approved_entries=len(items), cache_seconds_remaining=remaining)


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest, authorization: str | None = Header(default=None)) -> ChatResponse:
    knowledge, _ = await _load_approved_knowledge(authorization)
    return build_response(request.message, knowledge)