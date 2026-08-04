
from typing import Literal
import spacy
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(title="Faculty Consultation NLP Assistant", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_methods=["POST", "GET"], allow_headers=["*"])
nlp = spacy.blank("en")

INTENTS = {
    "booking": {"book", "schedule", "appointment", "consultation", "reserve"},
    "availability": {"available", "availability", "hours", "schedule", "open"},
    "expertise": {"expert", "expertise", "faculty", "professor", "topic", "research"},
    "services": {"service", "help", "clirdec", "portal", "offer"},
    "cancel": {"cancel", "reschedule", "change", "move"},
}
ANSWERS = {
    "booking": "Open an available consultation, review the date and faculty expertise, then select Book consultation. You will receive a status update after faculty confirmation.",
    "availability": "Available time slots are shown on the student dashboard in your local time. Slots disappear once booked to prevent double booking.",
    "expertise": "Search by your concern or topic. The portal matches it with faculty expertise; the CLIRDEC pilot initially uses the approved faculty directory.",
    "services": "The portal provides faculty discovery, consultation scheduling, appointment status, and answers to approved frequently asked questions.",
    "cancel": "Open your appointment and select Cancel or Reschedule. Changes should be made before the department's cutoff period.",
    "fallback": "I’m not certain about that yet. Please rephrase your question or contact the CLIRDEC coordinator for an approved answer.",
}

class ChatRequest(BaseModel): message: str = Field(min_length=2, max_length=500)
class ChatResponse(BaseModel): answer: str; intent: str; confidence: float; escalation: bool

def classify(message: str) -> tuple[str, float]:
    tokens = {t.lemma_.lower() if t.lemma_ else t.lower_ for t in nlp(message) if t.is_alpha}
    scores = {name: len(tokens & words) for name, words in INTENTS.items()}
    intent, score = max(scores.items(), key=lambda item: item[1])
    return (intent, min(0.95, 0.55 + score * 0.15)) if score else ("fallback", 0.2)

@app.get("/health")
def health(): return {"status": "ok", "nlp": "spacy"}

@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest):
    intent, confidence = classify(request.message)
    return ChatResponse(answer=ANSWERS[intent], intent=intent, confidence=confidence, escalation=intent == "fallback")
