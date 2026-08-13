"""FastAPI + spaCy service for the controlled FacultyConnect assistant.

The service deliberately uses retrieval and intent matching instead of an
unrestricted generative model. Approved Supabase FAQ entries are preferred;
the bundled workflow answers keep the service useful during local setup.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict, deque
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

import spacy
from fastapi import FastAPI, Header, HTTPException, Request as FastAPIRequest, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from spacy.matcher import PhraseMatcher


def _origins() -> list[str]:
    configured = os.getenv(
        "ALLOWED_ORIGINS",
        (
            "http://localhost:5173,https://clsu-faculty-connect.vercel.app,"
            "https://clsufacultyconnect.com,https://www.clsufacultyconnect.com"
        ),
    )
    return [item.strip().rstrip("/") for item in configured.split(",") if item.strip()]


SUPPORT_CONTACT = os.getenv(
    "OFFICIAL_SUPPORT_CONTACT",
    "the official CLIRDEC or MISO contact channel",
)


API_DOCS_ENABLED = os.getenv("ENABLE_API_DOCS", "").strip().lower() in {"1", "true", "yes"}

app = FastAPI(
    title="CLSU FacultyConnect NLP Assistant",
    description="Source-backed consultation guidance using FastAPI and spaCy.",
    version="1.0.0",
    docs_url="/docs" if API_DOCS_ENABLED else None,
    redoc_url="/redoc" if API_DOCS_ENABLED else None,
    openapi_url="/openapi.json" if API_DOCS_ENABLED else None,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Turnstile-Token"],
)


@app.middleware("http")
async def protect_dynamic_responses(request: FastAPIRequest, call_next):
    """Prevent browsers and intermediary caches from storing API responses."""
    response = await call_next(request)
    if request.url.path.startswith(("/api/", "/chat", "/health", "/knowledge-status")):
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
    return response

nlp = spacy.blank("en")
nlp.add_pipe("sentencizer")
matcher = PhraseMatcher(nlp.vocab, attr="LOWER")

INTENT_PHRASES: dict[str, list[str]] = {
    "booking": [
        "book consultation", "schedule appointment", "request consultation",
        "reserve a slot", "mag book", "magpa schedule", "kumuha ng appointment",
    ],
    "availability": [
        "available time", "faculty availability", "open slot",
        "anong oras", "kailan available", "available ba",
    ],
    "office_hours": [
        "office hours", "office opening hours", "when is the office open",
        "clirdec office hours", "clirdec hours", "what are your office hours",
        "oras ng opisina", "anong oras bukas ang opisina",
        "anong oras bukas ang clirdec", "kailan bukas ang office",
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
    "availability": {"available", "availability", "faculty", "slot", "oras", "kailan"},
    "expertise": {"expert", "expertise", "faculty", "professor", "adviser", "topic", "sinong", "sino"},
    "location": {"where", "location", "room", "online", "link", "platform", "saan"},
    "cancel": {"cancel", "reschedule", "change", "move", "ilipat", "palitan"},
    "status": {"status", "confirmed", "approved", "pending", "declined"},
    "services": {"service", "services", "help", "clirdec", "portal", "offer", "serbisyo"},
    "office_hours": {"clirdec", "office", "hours", "open", "closed", "bukas", "opisina"},
}

SENSITIVE_TERMS = {
    "password", "otp", "grade", "grades", "medical", "diagnosis", "emergency",
    "harassment", "complaint", "disciplinary", "legal", "suicide", "self-harm",
    "unsafe", "abuse", "violence", "assault", "threat", "rape", "bullying",
}

SENSITIVE_PATTERNS = tuple(re.compile(pattern, re.IGNORECASE) for pattern in (
    r"\bharass(?:ment|ed|ing|es)?\b",
    r"\babus(?:e|ed|ing|ive)\b",
    r"\bbull(?:y|ied|ying|ies)\b",
    r"\bassault(?:ed|ing|s)?\b",
    r"\bthreat(?:en|ened|ening|ens|s)?\b",
    r"\b(?:feel|am|i'm)\s+(?:not\s+)?safe\b",
    r"\b(?:hurt|kill)\s+(?:myself|me)\b",
    r"\bself[\s-]?harm(?:ing)?\b",
    r"\bsexual\s+(?:misconduct|harassment|assault)\b",
    r"\b(?:inaabuso|inabuso|binubully|pananakot|sinaktan)\b",
    r"\b(?:ayoko|ayaw\s+ko)\s+nang?\s+mabuhay\b",
))

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
    training_phrases: tuple[str, ...] = ()


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


class ChatSessionStatus(BaseModel):
    trusted: bool
    expires_in_seconds: int = 0


_cache: tuple[float, list[KnowledgeItem], str] = (0.0, [], "bundled")
_cache_lock = asyncio.Lock()
CACHE_TTL_SECONDS = max(30, int(os.getenv("FAQ_CACHE_SECONDS", "300")))
_chat_requests: dict[str, deque[float]] = defaultdict(deque)
_chat_rate_lock = asyncio.Lock()
CHAT_RATE_LIMIT = max(1, int(os.getenv("CHAT_RATE_LIMIT_PER_MINUTE", "20")))
CHAT_TRUST_COOKIE = "fc_chat_trust"
CHAT_TRUST_TTL_SECONDS = min(
    3600,
    max(300, int(os.getenv("CHAT_TRUST_TTL_SECONDS", "1800"))),
)


def _turnstile_required() -> bool:
    configured = os.getenv("REQUIRE_TURNSTILE")
    if configured is not None:
        return configured.strip().lower() in {"1", "true", "yes"}
    return os.getenv("VERCEL_ENV", "").strip().lower() == "production"


def _chat_trust_secret() -> str:
    """Use a dedicated signer when configured, otherwise derive from Turnstile."""
    return os.getenv("CHAT_TRUST_SECRET", "") or os.getenv("TURNSTILE_SECRET_KEY", "")


def _chat_cookie_secure() -> bool:
    return os.getenv("VERCEL_ENV", "").strip().lower() == "production"


def _sign_chat_trust(expiry: int, nonce: str, secret: str) -> str:
    message = f"v1.{expiry}.{nonce}".encode("utf-8")
    signature = hmac.new(
        secret.encode("utf-8"),
        b"facultyconnect-chat-trust:" + message,
        hashlib.sha256,
    ).hexdigest()
    return f"v1.{expiry}.{nonce}.{signature}"


def _new_chat_trust_cookie(secret: str) -> tuple[str, int]:
    expiry = int(time.time()) + CHAT_TRUST_TTL_SECONDS
    return _sign_chat_trust(expiry, secrets.token_urlsafe(18), secret), expiry


def _chat_trust_expiry(value: str | None, secret: str) -> int:
    if not value or not secret:
        return 0
    try:
        version, expiry_text, nonce, signature = value.split(".", 3)
        expiry = int(expiry_text)
    except (TypeError, ValueError):
        return 0
    if version != "v1" or not nonce or expiry <= int(time.time()):
        return 0
    expected = _sign_chat_trust(expiry, nonce, secret).rsplit(".", 1)[-1]
    return expiry if hmac.compare_digest(signature, expected) else 0


def _chat_trust_is_valid(value: str | None, secret: str) -> bool:
    return _chat_trust_expiry(value, secret) > 0


def _set_chat_trust_cookie(response: Response, value: str) -> None:
    response.set_cookie(
        key=CHAT_TRUST_COOKIE,
        value=value,
        max_age=CHAT_TRUST_TTL_SECONDS,
        httponly=True,
        secure=_chat_cookie_secure(),
        samesite="lax",
        path="/",
    )


def _clear_chat_trust_cookie(response: Response) -> None:
    response.delete_cookie(
        key=CHAT_TRUST_COOKIE,
        httponly=True,
        secure=_chat_cookie_secure(),
        samesite="lax",
        path="/",
    )


def _expired_chat_cookie_header() -> str:
    secure = "; Secure" if _chat_cookie_secure() else ""
    return (
        f"{CHAT_TRUST_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=lax{secure}"
    )


def _fetch_json(url: str, headers: dict[str, str], params: dict[str, str]) -> list[dict[str, Any]]:
    parsed = urlparse(url)
    hostname = (parsed.hostname or "").lower()
    is_supabase = parsed.scheme == "https" and hostname.endswith(".supabase.co")
    is_local_development = (
        parsed.scheme == "http"
        and hostname in {"localhost", "127.0.0.1"}
        and os.getenv("VERCEL_ENV", "").strip().lower() != "production"
    )
    if not (is_supabase or is_local_development):
        raise ValueError("SUPABASE_URL must use an approved Supabase HTTPS host")
    request = Request(f"{url}?{urlencode(params)}", headers=headers, method="GET")
    # The URL is restricted to Supabase HTTPS or non-production localhost above.
    with urlopen(request, timeout=5) as response:  # nosec B310
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, list):
        raise ValueError("FAQ response was not a list")
    return payload


def _verify_turnstile_response(secret: str, token: str, remote_ip: str | None) -> bool:
    data = {"secret": secret, "response": token}
    if remote_ip:
        data["remoteip"] = remote_ip
    request = Request(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        data=urlencode(data).encode("utf-8"),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    # This request always targets Cloudflare's fixed HTTPS verification URL.
    with urlopen(request, timeout=5) as response:  # nosec B310
        payload = json.loads(response.read().decode("utf-8"))
    return bool(payload.get("success"))


async def _protect_chat_request(request: FastAPIRequest, token: str | None) -> bool:
    """Rate-limit every request and return True only after a new CAPTCHA pass."""
    client_key = request.client.host if request.client else "unknown"
    now = time.monotonic()
    async with _chat_rate_lock:
        attempts = _chat_requests[client_key]
        while attempts and attempts[0] <= now - 60:
            attempts.popleft()
        if len(attempts) >= CHAT_RATE_LIMIT:
            raise HTTPException(
                status_code=429,
                detail="Too many chatbot requests. Complete a new security check after the cooldown.",
                headers={"Set-Cookie": _expired_chat_cookie_header()},
            )
        attempts.append(now)

    secret = os.getenv("TURNSTILE_SECRET_KEY", "")
    trust_secret = _chat_trust_secret()
    cookies = getattr(request, "cookies", {})
    if _chat_trust_is_valid(cookies.get(CHAT_TRUST_COOKIE), trust_secret):
        return False
    if not secret:
        if _turnstile_required():
            raise HTTPException(
                status_code=503,
                detail="Chat security verification is not configured.",
            )
        return False
    if not token:
        raise HTTPException(
            status_code=403,
            detail="Complete the security check before asking a question.",
            headers={"Set-Cookie": _expired_chat_cookie_header()},
        )
    try:
        valid = await asyncio.to_thread(_verify_turnstile_response, secret, token, client_key)
    except (HTTPError, URLError, TimeoutError, ValueError, TypeError, OSError):
        raise HTTPException(status_code=503, detail="The security check is temporarily unavailable.")
    if not valid:
        raise HTTPException(
            status_code=403,
            detail="The security check was not accepted.",
            headers={"Set-Cookie": _expired_chat_cookie_header()},
        )
    return True


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
        example_phrases = " ".join(item.training_phrases)
        candidate = f"{item.question} {item.category} {example_phrases}"
        candidate_tokens = _tokens(candidate)
        overlap = len(query_tokens & candidate_tokens) / max(1, len(query_tokens | candidate_tokens))
        phrase_candidates = (item.question, *item.training_phrases)
        sequence = max(
            SequenceMatcher(None, normalized, phrase.lower()).ratio()
            for phrase in phrase_candidates
        )
        score = overlap * 0.72 + sequence * 0.28
        if score > best_score:
            best, best_score = item, score
    return best, best_score


def is_sensitive(message: str) -> bool:
    """Detect high-risk topics before FAQ or intent matching runs."""
    lowered_tokens = _tokens(message)
    return bool(
        lowered_tokens & SENSITIVE_TERMS
        or any(pattern.search(message) for pattern in SENSITIVE_PATTERNS)
    )


async def _load_approved_knowledge(authorization: str | None) -> tuple[list[KnowledgeItem], str]:
    """Load approved FAQ entries with a server-only Supabase credential.

    The browser authorization header is deliberately ignored here. Knowledge
    retrieval is an application backend responsibility and must not depend on
    whichever user's request happens to warm a global serverless cache. Only a
    successful database response is cached; missing configuration, database
    errors, and empty results fall back for that request without poisoning
    later authenticated requests.
    """
    global _cache
    expires, cached, source = _cache
    if cached and time.monotonic() < expires:
        return cached, source

    supabase_url = (os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL", "")).rstrip("/")
    server_key = os.getenv("SUPABASE_SECRET_KEY") or ""
    if not supabase_url or not server_key:
        return [], "bundled workflow answers"

    headers = {"apikey": server_key, "Authorization": f"Bearer {server_key}"}
    params = {
        "select": "question,answer,category,source_reference,training_phrases",
        "status": "eq.approved",
        "order": "updated_at.desc",
        "limit": "200",
    }
    async with _cache_lock:
        expires, cached, source = _cache
        if cached and time.monotonic() < expires:
            return cached, source
        try:
            rows = await asyncio.to_thread(
                _fetch_json,
                f"{supabase_url}/rest/v1/faq_entries",
                headers,
                params,
            )
            items = [KnowledgeItem(**row) for row in rows]
            if not items:
                return [], "bundled workflow answers"
            source = "Supabase approved FAQ entries"
            _cache = (time.monotonic() + CACHE_TTL_SECONDS, items, source)
            return items, source
        except (HTTPError, URLError, TimeoutError, ValueError, TypeError, OSError):
            return [], "bundled workflow answers"


def build_response(message: str, knowledge: list[KnowledgeItem]) -> ChatResponse:
    if is_sensitive(message):
        return ChatResponse(
            answer=(
                "I can't handle confidential records, emergencies, complaints, academic decisions, "
                f"or account credentials. Please use {SUPPORT_CONTACT}."
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

    if intent == "office_hours":
        return ChatResponse(
            answer=(
                "A current Product Owner-approved CLIRDEC office-hours entry is not configured. "
                f"Please verify the schedule through {SUPPORT_CONTACT}."
            ),
            intent="office_hours",
            confidence=intent_confidence,
            escalation=True,
            source="Official office-hours source required",
            suggestions=["How do I request a consultation?", "View faculty availability"],
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
            "I'm not confident that I have an approved answer for that question. Please rephrase it "
            "as a booking, availability, faculty expertise, location, cancellation, status, or service question. "
            f"For anything else, use {SUPPORT_CONTACT}."
        ),
        intent="fallback",
        confidence=max(0.15, intent_confidence),
        escalation=True,
        source="Safe fallback and staff-referral rule",
        suggestions=["How do I request a consultation?", "When is a faculty member available?"],
    )


@app.get("/api/health")
@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "nlp": "spaCy", "pipeline": ",".join(nlp.pipe_names)}


@app.get("/knowledge-status", response_model=KnowledgeStatus)
@app.get("/api/knowledge-status", response_model=KnowledgeStatus)
async def knowledge_status(authorization: str | None = Header(default=None)) -> KnowledgeStatus:
    items, source = await _load_approved_knowledge(authorization)
    remaining = max(0, int(_cache[0] - time.monotonic()))
    return KnowledgeStatus(source=source, approved_entries=len(items), cache_seconds_remaining=remaining)


@app.get("/api/chat/session", response_model=ChatSessionStatus)
@app.get("/chat/session", response_model=ChatSessionStatus)
def chat_session_status(http_request: FastAPIRequest, response: Response) -> ChatSessionStatus:
    value = http_request.cookies.get(CHAT_TRUST_COOKIE)
    expiry = _chat_trust_expiry(value, _chat_trust_secret())
    if value and not expiry:
        _clear_chat_trust_cookie(response)
    return ChatSessionStatus(
        trusted=expiry > 0,
        expires_in_seconds=max(0, expiry - int(time.time())),
    )


@app.delete("/api/chat/session", status_code=204)
@app.delete("/chat/session", status_code=204)
def clear_chat_session() -> Response:
    response = Response(status_code=204)
    _clear_chat_trust_cookie(response)
    return response


@app.post("/api/chat", response_model=ChatResponse)
@app.post("/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    http_request: FastAPIRequest,
    response: Response,
    authorization: str | None = Header(default=None),
    x_turnstile_token: str | None = Header(default=None),
) -> ChatResponse:
    newly_verified = await _protect_chat_request(http_request, x_turnstile_token)
    if newly_verified:
        trust_secret = _chat_trust_secret()
        if not trust_secret:
            raise HTTPException(
                status_code=503,
                detail="Chat session signing is not configured.",
            )
        trust_cookie, expiry = _new_chat_trust_cookie(trust_secret)
        _set_chat_trust_cookie(response, trust_cookie)
        response.headers["X-Chat-Trusted-Until"] = str(expiry)
    knowledge, _ = await _load_approved_knowledge(authorization)
    return build_response(request.message, knowledge)


@app.get("/{unknown_path:path}", response_class=HTMLResponse, include_in_schema=False)
def custom_not_found(unknown_path: str) -> HTMLResponse:
    """Return the branded production 404 for routes outside the web application."""
    return HTMLResponse(
        status_code=404,
        content="""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <meta name="theme-color" content="#166534" />
  <title>Page not found | CLSU FacultyConnect</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #122019; background: #f5f8f5; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 15% 15%, #e3f4e9 0, transparent 34%), #f7faf7; }
    header { display: flex; align-items: center; gap: 12px; min-height: 78px; padding: 16px clamp(24px, 6vw, 92px); background: #fff; border-bottom: 1px solid #dce7df; }
    header img { width: 46px; height: 46px; object-fit: contain; }
    header strong { display: block; font-size: 1.08rem; }
    header span { color: #64736b; font-size: .82rem; }
    main { min-height: calc(100vh - 78px); display: grid; place-items: center; padding: 40px 24px; }
    section { width: min(720px, 100%); padding: clamp(32px, 6vw, 64px); border: 1px solid #d8e4dc; border-radius: 28px; background: rgba(255,255,255,.94); box-shadow: 0 24px 60px rgba(19,65,41,.12); text-align: center; }
    .code { margin: 0 0 10px; color: #08783f; font-size: clamp(4rem, 14vw, 7rem); font-weight: 900; line-height: .9; letter-spacing: -.08em; }
    h1 { margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: clamp(2rem, 5vw, 3.4rem); line-height: 1.05; }
    p { max-width: 520px; margin: 18px auto 28px; color: #5e6f65; font-size: 1.06rem; line-height: 1.65; }
    a { display: inline-flex; min-height: 50px; align-items: center; justify-content: center; padding: 0 24px; border-radius: 14px; background: #08783f; color: #fff; font-weight: 800; text-decoration: none; box-shadow: 0 10px 24px rgba(8,120,63,.22); }
    a:hover { background: #056334; transform: translateY(-1px); }
  </style>
</head>
<body>
  <header>
    <img src="/brand/Logo_Black.png" alt="CLSU seal" />
    <div><strong>CLSU FacultyConnect</strong><span>Faculty consultation portal</span></div>
  </header>
  <main>
    <section>
      <p class="code">404</p>
      <h1>This page is not available.</h1>
      <p>The link may be outdated or the page may have moved. Return to the secure portal to continue.</p>
      <a href="/">Return to FacultyConnect</a>
    </section>
  </main>
</body>
</html>""",
    )
