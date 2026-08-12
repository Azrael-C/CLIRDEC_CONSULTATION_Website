import unittest

from app import KnowledgeItem, build_response, classify_intent, is_sensitive


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


if __name__ == "__main__":
    unittest.main()
