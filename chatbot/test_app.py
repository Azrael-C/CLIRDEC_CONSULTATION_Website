import asyncio
import os
import unittest
from unittest.mock import patch

import app
from fastapi import HTTPException
from app import FacultyDirectoryItem, KnowledgeItem, build_response, classify_intent, is_sensitive


class AssistantTests(unittest.TestCase):
    def test_booking_intent_supports_english(self):
        intent, confidence = classify_intent("How can I book a consultation appointment?")
        self.assertEqual(intent, "booking")
        self.assertGreaterEqual(confidence, 0.55)

    def test_booking_intent_supports_filipino(self):
        intent, confidence = classify_intent("Paano ako mag book ng consultation?")
        self.assertEqual(intent, "booking")
        self.assertGreaterEqual(confidence, 0.55)

    def test_approved_faq_wins_and_includes_source(self):
        response = build_response(
            "When is the office open?",
            [KnowledgeItem(
                question="What are the CLIRDEC office hours?",
                answer="The approved office hours are listed in the current advisory.",
                category="Office hours and contacts",
                source_reference="CLIRDEC Office Advisory 2026-08",
            )],
        )
        self.assertFalse(response.escalation)
        self.assertEqual(response.source, "CLIRDEC Office Advisory 2026-08")

    def test_admin_training_phrase_improves_retrieval(self):
        response = build_response(
            "Saan ko makikita ang Zoom link?",
            [KnowledgeItem(
                question="Where can a student find the online consultation link?",
                answer="Open the confirmed request to view the approved meeting link.",
                category="Consultation location",
                source_reference="FacultyConnect consultation procedure",
                training_phrases=(
                    "Where is my online meeting link?",
                    "Saan ko makikita ang Zoom link?",
                ),
            )],
        )
        self.assertFalse(response.escalation)
        self.assertEqual(response.source, "FacultyConnect consultation procedure")
        self.assertIn("confirmed request", response.answer)

    def test_live_faculty_subject_match_uses_verified_database_fields(self):
        response = build_response(
            "Who can help me with database management?",
            [],
            [FacultyDirectoryItem(
                user_id="faculty-1",
                full_name="Dr. Maria Santos",
                department="College of Engineering",
                expertise=("Information Systems",),
                subjects=("Database Management", "Web Systems"),
                consultation_topics=("Database design",),
                research_interests=("Educational technology",),
                office_location="MISO Building",
            )],
        )
        self.assertEqual(response.intent, "expertise")
        self.assertIn("Dr. Maria Santos", response.answer)
        self.assertIn("Database Management", response.answer)
        self.assertEqual(response.source, "Live CLSU faculty profiles and published availability")

    def test_live_availability_never_invents_an_open_time(self):
        response = build_response(
            "When is Dr. Maria Santos available?",
            [],
            [FacultyDirectoryItem(
                user_id="faculty-1",
                full_name="Dr. Maria Santos",
                department="College of Engineering",
                expertise=("Information Systems",),
                subjects=("Database Management",),
                consultation_topics=("Database design",),
                research_interests=(),
                office_location="MISO Building",
                next_slots=(),
            )],
        )
        self.assertEqual(response.intent, "availability")
        self.assertIn("could not find", response.answer)

    def test_subject_only_question_can_trigger_faculty_discovery(self):
        response = build_response(
            "Database Management",
            [],
            [FacultyDirectoryItem(
                user_id="faculty-1",
                full_name="Dr. Maria Santos",
                department="College of Engineering",
                expertise=("Information Systems",),
                subjects=("Database Management",),
                consultation_topics=("Database design",),
                research_interests=(),
                office_location="MISO Building",
            )],
        )
        self.assertEqual(response.intent, "expertise")
        self.assertIn("Dr. Maria Santos", response.answer)

    def test_sensitive_question_is_escalated(self):
        response = build_response("Can you show my grades and password?", [])
        self.assertTrue(response.escalation)
        self.assertEqual(response.intent, "sensitive_referral")

    def test_office_hours_without_approved_faq_is_escalated(self):
        response = build_response("What are the CLIRDEC office hours?", [])
        self.assertTrue(response.escalation)
        self.assertEqual(response.intent, "office_hours")
        self.assertEqual(response.source, "Official office-hours source required")

    def test_harassment_word_variants_are_escalated(self):
        for message in (
            "My professor is harassing me and I feel unsafe",
            "I was harassed during a consultation",
            "A student keeps threatening me",
        ):
            with self.subTest(message=message):
                self.assertTrue(is_sensitive(message))
                self.assertEqual(build_response(message, []).intent, "sensitive_referral")

    def test_filipino_safety_phrases_are_escalated(self):
        for message in ("Inaabuso ako", "Binubully ako", "Ayaw ko nang mabuhay"):
            with self.subTest(message=message):
                self.assertTrue(is_sensitive(message))
                self.assertTrue(build_response(message, []).escalation)

    def test_unknown_question_uses_safe_fallback(self):
        response = build_response("What is the meaning of life?", [])
        self.assertTrue(response.escalation)
        self.assertEqual(response.intent, "fallback")

    def test_failed_or_unconfigured_knowledge_load_does_not_cache_fallback(self):
        app._cache = (0.0, [], "bundled")
        with patch.dict(os.environ, {}, clear=True):
            items, source = asyncio.run(app._load_approved_knowledge("Bearer browser-token"))
        self.assertEqual(items, [])
        self.assertEqual(source, "bundled workflow answers")
        self.assertEqual(app._cache, (0.0, [], "bundled"))

    def test_successful_server_side_knowledge_load_is_cached(self):
        app._cache = (0.0, [], "bundled")
        rows = [{
            "question": "How do I book?",
            "answer": "Choose an available time.",
            "category": "Booking",
            "source_reference": "Approved workflow",
            "training_phrases": ["Schedule a consultation"],
        }]
        environment = {
            "SUPABASE_URL": "https://project.supabase.co",
            "SUPABASE_SECRET_KEY": "server-secret",
        }
        with patch.dict(os.environ, environment, clear=True), patch.object(app, "_fetch_json", return_value=rows) as fetch:
            first = asyncio.run(app._load_approved_knowledge(None))
            second = asyncio.run(app._load_approved_knowledge("Bearer ignored-browser-token"))
        self.assertEqual(first[1], "Supabase approved FAQ entries")
        self.assertEqual(second[0][0].question, "How do I book?")
        self.assertEqual(fetch.call_count, 1)
        headers = fetch.call_args.args[1]
        self.assertEqual(headers["apikey"], "server-secret")
        self.assertEqual(headers["Authorization"], "Bearer server-secret")

    def test_knowledge_fetch_rejects_unapproved_hosts(self):
        with self.assertRaises(ValueError):
            app._fetch_json("https://attacker.example/faq", {}, {})

    def test_chat_requires_turnstile_token_when_secret_is_configured(self):
        request = type("Request", (), {"client": type("Client", (), {"host": "203.0.113.9"})()})()
        app._chat_requests.clear()
        with patch.dict(os.environ, {"TURNSTILE_SECRET_KEY": "server-secret"}, clear=True):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(app._protect_chat_request(request, None))
        self.assertEqual(raised.exception.status_code, 403)

    def test_production_chat_fails_closed_without_turnstile_secret(self):
        request = type("Request", (), {"client": type("Client", (), {"host": "203.0.113.10"})()})()
        app._chat_requests.clear()
        with patch.dict(os.environ, {"VERCEL_ENV": "production"}, clear=True):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(app._protect_chat_request(request, None))
        self.assertEqual(raised.exception.status_code, 503)

    def test_first_turnstile_pass_creates_trusted_chat_window(self):
        request = type(
            "Request",
            (),
            {
                "client": type("Client", (), {"host": "203.0.113.11"})(),
                "cookies": {},
            },
        )()
        app._chat_requests.clear()
        with patch.dict(os.environ, {"TURNSTILE_SECRET_KEY": "server-secret"}, clear=True), patch.object(
            app,
            "_verify_turnstile_response",
            return_value=True,
        ):
            newly_verified = asyncio.run(app._protect_chat_request(request, "valid-token"))
            cookie, expiry = app._new_chat_trust_cookie("server-secret")
        self.assertTrue(newly_verified)
        self.assertGreater(expiry, int(app.time.time()))
        self.assertTrue(app._chat_trust_is_valid(cookie, "server-secret"))

    def test_trusted_chat_window_skips_repeat_turnstile_but_keeps_rate_limit(self):
        cookie, _ = app._new_chat_trust_cookie("server-secret")
        request = type(
            "Request",
            (),
            {
                "client": type("Client", (), {"host": "203.0.113.12"})(),
                "cookies": {app.CHAT_TRUST_COOKIE: cookie},
            },
        )()
        app._chat_requests.clear()
        with patch.dict(os.environ, {"TURNSTILE_SECRET_KEY": "server-secret"}, clear=True), patch.object(
            app,
            "_verify_turnstile_response",
        ) as verify:
            newly_verified = asyncio.run(app._protect_chat_request(request, None))
        self.assertFalse(newly_verified)
        verify.assert_not_called()
        self.assertEqual(len(app._chat_requests[app._client_rate_key(request)]), 1)

    def test_edge_forwarded_client_ip_is_used_and_hashed(self):
        request = type(
            "Request",
            (),
            {
                "client": type("Client", (), {"host": "127.0.0.1"})(),
                "headers": {"x-vercel-forwarded-for": "203.0.113.21, 10.0.0.1"},
            },
        )()
        self.assertEqual(app._client_ip(request), "203.0.113.21")
        self.assertNotIn("203.0.113.21", app._client_rate_key(request))

    def test_chat_burst_limit_returns_retry_after(self):
        cookie, _ = app._new_chat_trust_cookie("server-secret")
        request = type(
            "Request",
            (),
            {
                "client": type("Client", (), {"host": "203.0.113.22"})(),
                "cookies": {app.CHAT_TRUST_COOKIE: cookie},
            },
        )()
        app._chat_requests.clear()
        with patch.dict(os.environ, {"TURNSTILE_SECRET_KEY": "server-secret"}, clear=True), patch.object(
            app,
            "CHAT_BURST_LIMIT",
            1,
        ):
            self.assertFalse(asyncio.run(app._protect_chat_request(request, None)))
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(app._protect_chat_request(request, None))
        self.assertEqual(raised.exception.status_code, 429)
        self.assertEqual(raised.exception.headers["Retry-After"], str(app.CHAT_BURST_WINDOW_SECONDS))

    def test_rate_limit_revokes_trusted_chat_window(self):
        cookie, _ = app._new_chat_trust_cookie("server-secret")
        request = type(
            "Request",
            (),
            {
                "client": type("Client", (), {"host": "203.0.113.13"})(),
                "cookies": {app.CHAT_TRUST_COOKIE: cookie},
            },
        )()
        app._chat_requests.clear()
        with patch.dict(os.environ, {"TURNSTILE_SECRET_KEY": "server-secret"}, clear=True), patch.object(
            app,
            "CHAT_RATE_LIMIT",
            1,
        ):
            self.assertFalse(asyncio.run(app._protect_chat_request(request, None)))
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(app._protect_chat_request(request, None))
        self.assertEqual(raised.exception.status_code, 429)
        self.assertIn("Max-Age=0", raised.exception.headers["Set-Cookie"])

    def test_consultation_services_question_uses_services_intent(self):
        intent, confidence = classify_intent(
            "What faculty consultation services are available?"
        )
    
        self.assertEqual(intent, "services")
        self.assertGreaterEqual(confidence, 0.55)
    
        response = build_response(
            "What faculty consultation services are available?",
            [],
        )
    
        self.assertEqual(response.intent, "services")
        self.assertEqual(response.source, "FacultyConnect MVP scope")
        self.assertIn("verified FAQ guidance", response.answer)

if __name__ == "__main__":
    unittest.main()
